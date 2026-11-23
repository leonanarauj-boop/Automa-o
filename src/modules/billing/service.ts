import { z } from "zod";
import { withService, type Db } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { applyCoupon, getPlan, GRACE_DAYS, PLAN_ORDER, PLANS, type PlanKey } from "./plans";
import { isValidDocument, onlyDigits } from "./document";
import { billingProvider } from "./asaas";
import { BillingProviderError, type BillingType, type GatewayPayment } from "./provider";

export class BillingError extends Error {}

// ---------------------------------------------------------------------------------------------
// Status da organização (função pura: independe da ordem de chegada dos eventos)
// ---------------------------------------------------------------------------------------------
export type OrgStatus = "trial" | "active" | "past_due" | "suspended" | "canceled";

export function computeOrgStatus(i: {
  trialEndsAt: Date;
  subscription: { status: string; currentPeriodEnd: Date | null } | null;
  hasPaidInvoice: boolean;
  oldestOverdueDueDate: Date | null;
}, now = new Date()): OrgStatus {
  const s = i.subscription;
  if (s?.status === "canceled") return s.currentPeriodEnd && s.currentPeriodEnd > now ? "active" : "canceled";
  if (s && i.oldestOverdueDueDate) {
    return i.oldestOverdueDueDate.getTime() + GRACE_DAYS * 86400_000 > now.getTime() ? "past_due" : "suspended";
  }
  if (s && i.hasPaidInvoice) return "active";
  return i.trialEndsAt > now ? "trial" : "suspended";
}

/** Recalcula status, plano efetivo e créditos de IA da organização. */
export async function recompute(db: Db, orgId: string, now = new Date()) {
  const o = (await db.query<{ trial_ends_at: Date; status: string; plan: string; ai_credits_override: number | null; admin_blocked_reason: string | null }>(
    "select trial_ends_at, status, plan, ai_credits_override, admin_blocked_reason from organizations where id = $1 for update", [orgId])).rows[0];
  const sub = (await db.query<{ status: string; current_period_end: Date | null; plan_key: string; pending_plan_key: string | null }>(
    "select status, current_period_end, plan_key, pending_plan_key from subscriptions where organization_id = $1", [orgId])).rows[0] ?? null;
  const inv = (await db.query<{ paid: boolean; overdue: Date | null }>(
    `select exists(select 1 from invoices where organization_id = $1 and status = 'paid') paid,
            (select min(due_date)::timestamptz from invoices where organization_id = $1 and status in ('overdue','chargeback')) overdue`, [orgId])).rows[0];
  const computed = computeOrgStatus({
    trialEndsAt: o.trial_ends_at, subscription: sub ? { status: sub.status, currentPeriodEnd: sub.current_period_end } : null,
    hasPaidInvoice: inv.paid, oldestOverdueDueDate: inv.overdue,
  }, now);
  const status: OrgStatus = o.admin_blocked_reason ? "suspended" : computed; // bloqueio manual da plataforma prevalece
  if (sub && sub.status !== "canceled") {
    const subStatus = inv.overdue ? "past_due" : inv.paid ? "active" : "pending";
    if (subStatus !== sub.status) await db.query("update subscriptions set status = $2, updated_at = now() where organization_id = $1", [orgId, subStatus]);
  }
  const plan: PlanKey = (status === "active" || status === "past_due") && sub ? (sub.plan_key as PlanKey) : "trial";
  await db.query("update organizations set status = $2, plan = $3, ai_monthly_credits = $4, updated_at = now() where id = $1",
    [orgId, status, plan, o.ai_credits_override ?? getPlan(plan).limits.aiCredits]);
  if (status !== o.status) {
    await audit(db, { orgId, actorType: "system", action: `billing.status.${status}`, metadata: { from: o.status } });
  }
  return { status, plan };
}

// ---------------------------------------------------------------------------------------------
// Direitos do plano
// ---------------------------------------------------------------------------------------------
export async function entitlements(db: Db, orgId: string) {
  const o = (await db.query<{ plan: string; status: OrgStatus; trial_ends_at: Date }>("select plan, status, trial_ends_at from organizations where id = $1", [orgId])).rows[0];
  const plan = getPlan(o.plan);
  return { plan, status: o.status, trialEndsAt: o.trial_ends_at, canOperate: ["trial", "active", "past_due"].includes(o.status) };
}

export async function assertCanOperate(db: Db, orgId: string) {
  const e = await entitlements(db, orgId);
  if (!e.canOperate) throw new BillingError("Sua conta está com o acesso restrito. Regularize a assinatura para voltar a enviar mensagens.");
  return e;
}

export async function assertFeature(db: Db, orgId: string, feature: keyof (typeof PLANS)["trial"]["features"]) {
  const e = await assertCanOperate(db, orgId);
  if (!e.plan.features[feature]) throw new BillingError(`Seu plano (${e.plan.name}) não inclui este recurso. Faça upgrade em Assinatura.`);
  return e;
}

// ---------------------------------------------------------------------------------------------
// Faturas
// ---------------------------------------------------------------------------------------------
export function invoiceStatus(gatewayStatus: string, deleted = false): string {
  if (deleted) return "canceled";
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(gatewayStatus)) return "paid";
  if (gatewayStatus === "OVERDUE") return "overdue";
  if (gatewayStatus.startsWith("REFUND")) return "refunded";
  if (gatewayStatus.includes("CHARGEBACK")) return "chargeback";
  return "pending";
}

const STATUS_RANK: Record<string, number> = { pending: 0, overdue: 1, paid: 2, chargeback: 3, refunded: 3, canceled: 3 };

async function upsertInvoice(db: Db, orgId: string, p: GatewayPayment, status: string) {
  await db.query(
    `insert into invoices (organization_id, gateway_payment_id, gateway_subscription_id, amount_cents, status, billing_type, due_date, paid_at, invoice_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (gateway_payment_id) do update set
       amount_cents = excluded.amount_cents, billing_type = excluded.billing_type, due_date = excluded.due_date, invoice_url = coalesce(excluded.invoice_url, invoices.invoice_url),
       paid_at = coalesce(excluded.paid_at, invoices.paid_at), updated_at = now(),
       -- eventos fora de ordem não fazem uma fatura paga voltar a "vencida"
       status = case when $10 >= (case invoices.status ${Object.entries(STATUS_RANK).map(([k, v]) => `when '${k}' then ${v}`).join(" ")} else 0 end) then excluded.status else invoices.status end`,
    [orgId, p.id, p.subscriptionId, p.valueCents, status, p.billingType, p.dueDate, status === "paid" ? (p.paymentDate ? new Date(`${p.paymentDate}T12:00:00-03:00`) : new Date()) : null, p.invoiceUrl, STATUS_RANK[status] ?? 0]);
}

// ---------------------------------------------------------------------------------------------
// Contratação
// ---------------------------------------------------------------------------------------------
export const checkoutSchema = z.object({
  planKey: z.enum(["starter", "professional", "business"]),
  name: z.string().trim().min(3, "Informe o nome ou razão social").max(150),
  document: z.string().refine(isValidDocument, "CPF ou CNPJ inválido").transform(onlyDigits),
  email: z.string().trim().email("E-mail inválido").max(200),
  billingType: z.enum(["UNDEFINED", "PIX", "BOLETO", "CREDIT_CARD"]).default("UNDEFINED"),
  couponCode: z.string().trim().toUpperCase().max(40).optional().transform((v) => v || null),
});

function ymd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

async function findCoupon(db: Db, code: string | null) {
  if (!code) return null;
  const c = (await db.query<{ code: string; percent_off: number; duration_months: number | null }>(
    `select code, percent_off, duration_months from coupons where code = $1 and active and (valid_until is null or valid_until > now())
       and (max_redemptions is null or redeemed_count < max_redemptions) for update`, [code])).rows[0];
  if (!c) throw new BillingError("Cupom inválido ou expirado.");
  return c;
}

/** Busca as cobranças no gateway e grava as faturas; devolve o link da próxima fatura em aberto. */
async function syncPayments(orgId: string, subscriptionId: string) {
  const payments = await billingProvider().listSubscriptionPayments(subscriptionId);
  await withService(async (db) => { for (const p of payments) await upsertInvoice(db, orgId, p, invoiceStatus(p.status)); });
  return payments.filter((p) => invoiceStatus(p.status) === "pending" || invoiceStatus(p.status) === "overdue").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.invoiceUrl ?? null;
}

export async function checkout(orgId: string, userId: string, input: z.input<typeof checkoutSchema>) {
  const d = checkoutSchema.parse(input);
  if (!billingProvider().available()) throw new BillingError("Os pagamentos ainda não foram configurados pelo administrador da plataforma.");
  const plan = PLANS[d.planKey];
  const state = await withService(async (db) => {
    const sub = (await db.query<{ status: string; gateway_customer_id: string | null; gateway_subscription_id: string | null }>(
      "select status, gateway_customer_id, gateway_subscription_id from subscriptions where organization_id = $1", [orgId])).rows[0];
    if (sub && sub.status !== "canceled" && sub.gateway_subscription_id) throw new BillingError("Já existe uma assinatura. Use a troca de plano.");
    const coupon = await findCoupon(db, d.couponCode);
    const org = (await db.query<{ trial_ends_at: Date }>("select trial_ends_at from organizations where id = $1", [orgId])).rows[0];
    return { customerId: sub?.gateway_customer_id ?? null, coupon, trialEndsAt: org.trial_ends_at };
  });
  const gw = billingProvider();
  try {
    const customerId = state.customerId ?? (await gw.createCustomer({ name: d.name, cpfCnpj: d.document, email: d.email, externalReference: orgId })).id;
    // Quem ainda está no teste só é cobrado quando o teste acaba (pode pagar antes, se quiser).
    const due = state.trialEndsAt > new Date() ? state.trialEndsAt : new Date();
    const price = applyCoupon(plan.priceCents, state.coupon?.percent_off);
    const subscription = await gw.createSubscription({
      customerId, billingType: d.billingType as BillingType, valueCents: price, nextDueDate: ymd(due),
      description: `Retoma — plano ${plan.name}`, externalReference: orgId,
    });
    await withService(async (db) => {
      await db.query(
        `insert into subscriptions (organization_id, plan_key, status, gateway_customer_id, gateway_subscription_id, billing_type, price_cents, coupon_code, coupon_months_left, customer_name, customer_document, customer_email, canceled_at, current_period_end, pending_plan_key)
         values ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,null,null,null)
         on conflict (organization_id) do update set plan_key = excluded.plan_key, status = 'pending', gateway_customer_id = excluded.gateway_customer_id,
           gateway_subscription_id = excluded.gateway_subscription_id, billing_type = excluded.billing_type, price_cents = excluded.price_cents,
           coupon_code = excluded.coupon_code, coupon_months_left = excluded.coupon_months_left, customer_name = excluded.customer_name,
           customer_document = excluded.customer_document, customer_email = excluded.customer_email, canceled_at = null, current_period_end = null, pending_plan_key = null, updated_at = now()`,
        [orgId, plan.key, customerId, subscription.id, d.billingType, price, state.coupon?.code ?? null, state.coupon?.duration_months ?? null, d.name, d.document, d.email]);
      if (state.coupon) await db.query("update coupons set redeemed_count = redeemed_count + 1 where code = $1", [state.coupon.code]);
      await audit(db, { orgId, actorType: "user", actorId: userId, action: "billing.subscribed", metadata: { plan: plan.key, price, coupon: state.coupon?.code ?? null } });
    });
    return { invoiceUrl: await syncPayments(orgId, subscription.id) };
  } catch (e) {
    if (e instanceof BillingProviderError) throw new BillingError(`Não foi possível criar a assinatura: ${e.message}`);
    throw e;
  }
}

/**
 * Troca de plano. A API do gateway não altera o valor de assinaturas existentes, então a troca
 * encerra a assinatura atual e cria outra com o primeiro vencimento no fim do período já pago
 * (sem cobrança em duplicidade e sem proporcional). Upgrade libera os recursos na hora;
 * downgrade vale a partir do próximo ciclo.
 */
export async function changePlan(orgId: string, userId: string, newPlanKey: PlanKey) {
  const newPlan = PLANS[newPlanKey];
  if (!newPlan || newPlanKey === "trial") throw new BillingError("Plano inválido.");
  const sub = await withService(async (db) => (await db.query<{
    status: string; plan_key: PlanKey; gateway_customer_id: string; gateway_subscription_id: string; billing_type: BillingType;
    coupon_code: string | null; coupon_months_left: number | null; current_period_end: Date | null;
  }>("select * from subscriptions where organization_id = $1", [orgId])).rows[0]);
  if (!sub || sub.status === "canceled" || !sub.gateway_subscription_id) throw new BillingError("Nenhuma assinatura ativa para trocar.");
  if (sub.status === "past_due") throw new BillingError("Regularize a fatura em aberto antes de trocar de plano.");
  if (sub.plan_key === newPlanKey) throw new BillingError("Você já está neste plano.");
  const upgrade = PLAN_ORDER.indexOf(newPlanKey) > PLAN_ORDER.indexOf(sub.plan_key);
  if (!upgrade) await withService((db) => assertFitsPlan(db, orgId, newPlanKey));

  const coupon = sub.coupon_code && (sub.coupon_months_left === null || sub.coupon_months_left > 0)
    ? (await withService((db) => db.query<{ percent_off: number }>("select percent_off from coupons where code = $1", [sub.coupon_code]))).rows[0] : undefined;
  const price = applyCoupon(newPlan.priceCents, coupon?.percent_off);
  const due = sub.status === "active" && sub.current_period_end && sub.current_period_end > new Date() ? sub.current_period_end : new Date();
  const gw = billingProvider();
  try {
    const created = await gw.createSubscription({
      customerId: sub.gateway_customer_id, billingType: sub.billing_type, valueCents: price, nextDueDate: ymd(due),
      description: `Retoma — plano ${newPlan.name}`, externalReference: orgId,
    });
    await gw.deleteSubscription(sub.gateway_subscription_id);
    await withService(async (db) => {
      // pendente (nunca pago): troca direta; ativo: upgrade imediato, downgrade agendado
      const entitled = sub.status === "pending" || upgrade ? newPlanKey : sub.plan_key;
      await db.query("update subscriptions set gateway_subscription_id = $2, price_cents = $3, plan_key = $4, pending_plan_key = $5, updated_at = now() where organization_id = $1",
        [orgId, created.id, price, entitled, entitled === newPlanKey ? null : newPlanKey]);
      await db.query("update invoices set status = 'canceled', updated_at = now() where organization_id = $1 and gateway_subscription_id = $2 and status = 'pending'", [orgId, sub.gateway_subscription_id]);
      await audit(db, { orgId, actorType: "user", actorId: userId, action: upgrade ? "billing.upgraded" : "billing.downgrade_scheduled", metadata: { from: sub.plan_key, to: newPlanKey, oldSubscription: sub.gateway_subscription_id, newSubscription: created.id } });
      await recompute(db, orgId);
    });
    await syncPayments(orgId, created.id);
    return { upgrade, effectiveAt: upgrade || sub.status === "pending" ? null : due };
  } catch (e) {
    if (e instanceof BillingProviderError) throw new BillingError(`Não foi possível trocar o plano: ${e.message}`);
    throw e;
  }
}

/** Confere se o uso atual cabe no plano menor (evita downgrade que quebraria a operação). */
export async function assertFitsPlan(db: Db, orgId: string, planKey: PlanKey) {
  const p = PLANS[planKey];
  const u = (await db.query<{ contacts: string; automations: string; users: string }>(
    `select (select count(*) from contacts where organization_id = $1 and deleted_at is null and not is_demo) contacts,
            (select count(*) from automations where organization_id = $1 and status = 'active') automations,
            (select count(*) from memberships where organization_id = $1 and status = 'active') users`, [orgId])).rows[0];
  const problems: string[] = [];
  if (Number(u.contacts) > p.limits.contacts) problems.push(`${u.contacts} contatos (limite ${p.limits.contacts})`);
  if (Number(u.automations) > p.limits.activeAutomations) problems.push(`${u.automations} automações ativas (limite ${p.limits.activeAutomations})`);
  if (Number(u.users) > p.limits.users) problems.push(`${u.users} usuários (limite ${p.limits.users})`);
  if (problems.length) throw new BillingError(`O plano ${p.name} não comporta o uso atual: ${problems.join(", ")}.`);
}

export async function cancelSubscription(orgId: string, userId: string) {
  const sub = await withService(async (db) => (await db.query<{ status: string; gateway_subscription_id: string | null }>(
    "select status, gateway_subscription_id from subscriptions where organization_id = $1", [orgId])).rows[0]);
  if (!sub || sub.status === "canceled") throw new BillingError("Nenhuma assinatura ativa.");
  try {
    if (sub.gateway_subscription_id) await billingProvider().deleteSubscription(sub.gateway_subscription_id);
  } catch (e) {
    if (e instanceof BillingProviderError) throw new BillingError(`Não foi possível cancelar no gateway: ${e.message}`);
    throw e;
  }
  await withService(async (db) => {
    await db.query("update subscriptions set status = 'canceled', canceled_at = now(), pending_plan_key = null, updated_at = now() where organization_id = $1", [orgId]);
    await db.query("update invoices set status = 'canceled', updated_at = now() where organization_id = $1 and status = 'pending'", [orgId]);
    await audit(db, { orgId, actorType: "user", actorId: userId, action: "billing.canceled" });
    await recompute(db, orgId);
  });
}

// ---------------------------------------------------------------------------------------------
// Webhook do gateway (processado no worker)
// ---------------------------------------------------------------------------------------------
const PAID_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);

export async function processBillingEvent(db: Db, eventId: string) {
  const ev = (await db.query<{ type: string; payload: { payment?: Record<string, unknown> }; processed_at: Date | null }>(
    "select type, payload, processed_at from billing_events where id = $1 for update", [eventId])).rows[0];
  if (!ev || ev.processed_at) return;
  const raw = ev.payload.payment as (Record<string, unknown> & { externalReference?: string }) | undefined;
  if (!raw) { await db.query("update billing_events set processed_at = now(), error = 'evento sem cobrança' where id = $1", [eventId]); return; }
  const { mapAsaasPayment } = await import("./asaas");
  const p = mapAsaasPayment(raw as never);
  const sub = p.subscriptionId ? (await db.query<{ organization_id: string; coupon_months_left: number | null; current_period_end: Date | null }>(
    "select organization_id, coupon_months_left, current_period_end from subscriptions where gateway_subscription_id = $1", [p.subscriptionId])).rows[0] : undefined;
  const orgId = sub?.organization_id
    ?? (await db.query<{ organization_id: string }>("select organization_id from invoices where gateway_payment_id = $1", [p.id])).rows[0]?.organization_id
    ?? (typeof raw.externalReference === "string" && /^[0-9a-f-]{36}$/.test(raw.externalReference)
      ? (await db.query<{ id: string }>("select id from organizations where id = $1", [raw.externalReference])).rows[0]?.id : undefined);
  if (!orgId) { await db.query("update billing_events set processed_at = now(), error = 'cobrança não reconhecida' where id = $1", [eventId]); return; }

  const status = invoiceStatus(p.status, ev.type === "PAYMENT_DELETED");
  await upsertInvoice(db, orgId, p, PAID_EVENTS.has(ev.type) ? "paid" : status);
  if (PAID_EVENTS.has(ev.type) && sub) {
    const periodEnd = new Date(`${p.dueDate}T12:00:00-03:00`);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await db.query(
      `update subscriptions set current_period_end = greatest(coalesce(current_period_end, $2), $2),
         coupon_months_left = case when coupon_months_left is null then null else greatest(coupon_months_left - 1, 0) end, updated_at = now()
       where organization_id = $1`, [orgId, periodEnd]);
  }
  await recompute(db, orgId);
  await db.query("update billing_events set processed_at = now() where id = $1", [eventId]);
}

// ---------------------------------------------------------------------------------------------
// Ciclo de vida (job periódico)
// ---------------------------------------------------------------------------------------------
export async function runLifecycle(now = new Date()) {
  // 1) status dependentes do tempo (fim do teste, carência de inadimplência, fim do período cancelado)
  const orgs = await withService((db) => db.query<{ id: string }>(
    `select o.id from organizations o left join subscriptions s on s.organization_id = o.id
     where (o.status = 'trial' and o.trial_ends_at <= $1) or o.status = 'past_due'
        or (s.status = 'canceled' and o.status <> 'canceled') or (s.pending_plan_key is not null and s.current_period_end <= $1)`, [now]));
  for (const o of orgs.rows) {
    await withService(async (db) => {
      // 2) downgrade agendado entra em vigor no fim do período pago
      await db.query("update subscriptions set plan_key = pending_plan_key, pending_plan_key = null, updated_at = now() where organization_id = $1 and pending_plan_key is not null and current_period_end <= $2", [o.id, now]);
      await recompute(db, o.id, now);
    });
  }
  // 3) cupom com prazo encerrado: nova assinatura com preço cheio a partir do próximo vencimento
  const expired = await withService((db) => db.query<{ organization_id: string; plan_key: PlanKey; pending_plan_key: PlanKey | null }>(
    "select organization_id, plan_key, pending_plan_key from subscriptions where status = 'active' and coupon_code is not null and coupon_months_left = 0"));
  for (const s of expired.rows) {
    await withService((db) => db.query("update subscriptions set coupon_code = null, coupon_months_left = null where organization_id = $1", [s.organization_id]));
    await replaceAtFullPrice(s.organization_id, s.pending_plan_key ?? s.plan_key).catch(async (e) => {
      await withService((db) => audit(db, { orgId: s.organization_id, actorType: "system", action: "billing.coupon_expiry_failed", metadata: { error: (e as Error).message } }));
    });
  }
  return { checked: orgs.rowCount, couponsExpired: expired.rowCount };
}

async function replaceAtFullPrice(orgId: string, planKey: PlanKey) {
  const sub = await withService(async (db) => (await db.query<{ gateway_customer_id: string; gateway_subscription_id: string; billing_type: BillingType; current_period_end: Date | null }>(
    "select gateway_customer_id, gateway_subscription_id, billing_type, current_period_end from subscriptions where organization_id = $1", [orgId])).rows[0]);
  const plan = PLANS[planKey];
  const gw = billingProvider();
  const created = await gw.createSubscription({
    customerId: sub.gateway_customer_id, billingType: sub.billing_type, valueCents: plan.priceCents,
    nextDueDate: ymd(sub.current_period_end && sub.current_period_end > new Date() ? sub.current_period_end : new Date()),
    description: `Retoma — plano ${plan.name}`, externalReference: orgId,
  });
  await gw.deleteSubscription(sub.gateway_subscription_id);
  await withService(async (db) => {
    await db.query("update subscriptions set gateway_subscription_id = $2, price_cents = $3, updated_at = now() where organization_id = $1", [orgId, created.id, plan.priceCents]);
    await db.query("update invoices set status = 'canceled' where organization_id = $1 and gateway_subscription_id = $2 and status = 'pending'", [orgId, sub.gateway_subscription_id]);
    await audit(db, { orgId, actorType: "system", action: "billing.coupon_expired", metadata: { newSubscription: created.id } });
  });
  await syncPayments(orgId, created.id);
}

export async function refreshInvoices(orgId: string) {
  const sub = await withService(async (db) => (await db.query<{ gateway_subscription_id: string | null }>("select gateway_subscription_id from subscriptions where organization_id = $1", [orgId])).rows[0]);
  if (!sub?.gateway_subscription_id) return null;
  return syncPayments(orgId, sub.gateway_subscription_id);
}

export async function usage(db: Db, orgId: string) {
  const r = (await db.query<{ contacts: string; automations: string; users: string; ai: string }>(
    `select (select count(*) from contacts where organization_id = $1 and deleted_at is null and not is_demo) contacts,
            (select count(*) from automations where organization_id = $1 and status = 'active') automations,
            (select count(*) from memberships where organization_id = $1 and status = 'active') users,
            (select count(*) from ai_calls where organization_id = $1 and created_at >= date_trunc('month', now()) and status in ('pending','ok','refused','blocked')) ai`, [orgId])).rows[0];
  return { contacts: Number(r.contacts), automations: Number(r.automations), users: Number(r.users), aiCalls: Number(r.ai) };
}
