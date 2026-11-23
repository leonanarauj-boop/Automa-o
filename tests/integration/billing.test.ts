import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers";
import { closePool, withService, withTenant } from "@/lib/db";
import { signup } from "@/modules/auth/service";
import { setBillingProvider } from "@/modules/billing/asaas";
import type { BillingProvider, GatewayPayment } from "@/modules/billing/provider";
import { BillingError, cancelSubscription, changePlan, checkout, entitlements, runLifecycle } from "@/modules/billing/service";
import { createContact } from "@/modules/crm/service";
import { createAutomation, setAutomationStatus, AutomationError } from "@/modules/automations/service";
import { runOnce } from "@/worker/handlers";
import { POST } from "@/app/api/webhooks/billing/route";

process.env.ASAAS_WEBHOOK_TOKEN = "token-de-webhook-com-mais-de-32-caracteres-123";
const subs = new Map<string, { customer: string; value: number; nextDueDate: string; deleted?: boolean; payments: GatewayPayment[] }>();
let n = 0;
const fake: BillingProvider = {
  name: "fake", available: () => true,
  async createCustomer() { return { id: `cus_${++n}` }; },
  async createSubscription(i) {
    const id = `sub_${++n}`;
    subs.set(id, { customer: i.customerId, value: i.valueCents, nextDueDate: i.nextDueDate,
      payments: [{ id: `pay_${++n}`, subscriptionId: id, valueCents: i.valueCents, status: "PENDING", billingType: i.billingType, dueDate: i.nextDueDate, paymentDate: null, invoiceUrl: `https://pagamento.exemplo/${id}` }] });
    return { id };
  },
  async listSubscriptionPayments(id) { return subs.get(id)?.payments ?? []; },
  async deleteSubscription(id) { const s = subs.get(id); if (s) s.deleted = true; },
};

let A: { userId: string; orgId: string };
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withService((db) => db.query<T>(sql, p)).then((r) => r.rows);
const CUSTOMER = { name: "Clínica A Ltda", document: "11.222.333/0001-81", email: "fin@a.com" };

async function webhook(event: string, payment: Partial<GatewayPayment> & { id: string; subscription: string; status: string; value: number; dueDate: string }, eventId = `evt_${++n}`, token = process.env.ASAAS_WEBHOOK_TOKEN) {
  const body = JSON.stringify({ id: eventId, event, dateCreated: "2026-01-01 00:00:00", payment: { object: "payment", invoiceUrl: "https://pagamento.exemplo/x", ...payment } });
  const res = await POST(new NextRequest("http://x/api/webhooks/billing", { method: "POST", body, headers: { "asaas-access-token": token ?? "" } }));
  while ((await runOnce(50)) > 0) { /* processa */ }
  return res;
}
const orgRow = async () => (await q<{ status: string; plan: string; ai_monthly_credits: number }>("select status, plan, ai_monthly_credits from organizations where id = $1", [A.orgId]))[0];
const subRow = async () => (await q<{ status: string; plan_key: string; gateway_subscription_id: string; pending_plan_key: string | null; price_cents: string; current_period_end: Date | null; coupon_months_left: number | null }>("select * from subscriptions where organization_id = $1", [A.orgId]))[0];

beforeAll(async () => {
  await resetDb();
  const { resetEnvCache } = await import("@/lib/env");
  resetEnvCache();
  setBillingProvider(fake);
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
});
afterAll(async () => { setBillingProvider(null); await closePool(); });
beforeEach(() => { /* nada */ });

describe("contratação e pagamento", () => {
  it("valida documento e cupom", async () => {
    await expect(checkout(A.orgId, A.userId, { planKey: "professional", ...CUSTOMER, document: "123" })).rejects.toThrow(/CPF ou CNPJ/);
    await expect(checkout(A.orgId, A.userId, { planKey: "professional", ...CUSTOMER, couponCode: "NAOEXISTE" })).rejects.toThrow(/Cupom/);
  });

  it("assina com cupom; durante o teste, o 1º vencimento é no fim do teste", async () => {
    await q("insert into coupons (code, percent_off, duration_months, max_redemptions) values ('FUNDADOR', 50, 2, 10)");
    const r = await checkout(A.orgId, A.userId, { planKey: "professional", ...CUSTOMER, couponCode: "fundador" });
    expect(r.invoiceUrl).toMatch(/^https:\/\/pagamento\.exemplo\//);
    const s = await subRow();
    expect(s).toMatchObject({ status: "pending", plan_key: "professional", coupon_months_left: 2 });
    expect(Number(s.price_cents)).toBe(17450);
    const trialEnd = (await q<{ d: string }>("select to_char(trial_ends_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') d from organizations where id = $1", [A.orgId]))[0].d;
    expect(subs.get(s.gateway_subscription_id)!.nextDueDate).toBe(trialEnd);
    expect((await orgRow()).status).toBe("trial");
    expect((await q<{ redeemed_count: number }>("select redeemed_count from coupons where code = 'FUNDADOR'"))[0].redeemed_count).toBe(1);
    await expect(checkout(A.orgId, A.userId, { planKey: "starter", ...CUSTOMER })).rejects.toThrow(/Já existe/);
  });

  it("webhook com token errado é recusado", async () => {
    const s = await subRow();
    const res = await webhook("PAYMENT_RECEIVED", { id: "pay_x", subscription: s.gateway_subscription_id, status: "RECEIVED", value: 174.5, dueDate: "2026-12-01" }, "evt_fake", "errado");
    expect(res.status).toBe(401);
    expect(await q("select * from billing_events")).toHaveLength(0);
  });

  it("pagamento confirmado ativa o plano (idempotente)", async () => {
    const s = await subRow();
    const pay = subs.get(s.gateway_subscription_id)!.payments[0];
    const p = { id: pay.id, subscription: s.gateway_subscription_id, status: "CONFIRMED", value: 174.5, dueDate: pay.dueDate };
    await webhook("PAYMENT_CONFIRMED", p, "evt_pay1");
    await webhook("PAYMENT_CONFIRMED", p, "evt_pay1"); // repetido
    expect(await orgRow()).toMatchObject({ status: "active", plan: "professional", ai_monthly_credits: 1500 });
    const s2 = await subRow();
    expect(s2.status).toBe("active");
    expect(s2.coupon_months_left).toBe(1);
    expect(s2.current_period_end).not.toBeNull();
    expect(await q("select * from invoices where status = 'paid'")).toHaveLength(1);
  });

  it("evento fora de ordem não faz fatura paga voltar a vencida", async () => {
    const s = await subRow();
    const pay = subs.get(s.gateway_subscription_id)!.payments[0];
    await webhook("PAYMENT_OVERDUE", { id: pay.id, subscription: s.gateway_subscription_id, status: "OVERDUE", value: 174.5, dueDate: pay.dueDate });
    expect((await q<{ status: string }>("select status from invoices where gateway_payment_id = $1", [pay.id]))[0].status).toBe("paid");
    expect((await orgRow()).status).toBe("active");
  });
});

describe("troca de plano", () => {
  it("upgrade: libera na hora; nova assinatura vence no fim do período pago; antiga removida", async () => {
    const before = await subRow();
    const r = await changePlan(A.orgId, A.userId, "business");
    expect(r.upgrade).toBe(true);
    const s = await subRow();
    expect(s.plan_key).toBe("business");
    expect(subs.get(before.gateway_subscription_id)!.deleted).toBe(true);
    const ns = subs.get(s.gateway_subscription_id)!;
    expect(ns.nextDueDate).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(before.current_period_end!));
    expect(ns.value).toBe(39950); // cupom de 50% ainda vale por 1 mês
    expect(await orgRow()).toMatchObject({ plan: "business", ai_monthly_credits: 5000 });
  });

  it("downgrade agendado só vale no fim do período; bloqueado se o uso não couber", async () => {
    for (let i = 0; i < 4; i++) {
      const id = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, `A${i}`, { trigger: { type: "contact.created" }, steps: [{ type: "create_task", title: "x", dueHours: 1 }] }));
      await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"));
    }
    await expect(changePlan(A.orgId, A.userId, "starter")).rejects.toThrow(/4 automações ativas \(limite 3\)/);
    await q("update automations set status = 'paused' where organization_id = $1 and name = 'A3'", [A.orgId]);
    const r = await changePlan(A.orgId, A.userId, "starter");
    expect(r.upgrade).toBe(false);
    expect(await subRow()).toMatchObject({ plan_key: "business", pending_plan_key: "starter" });
    expect((await orgRow()).plan).toBe("business");
    // fim do período
    await q("update subscriptions set current_period_end = now() - interval '1 minute' where organization_id = $1", [A.orgId]);
    await q("update invoices set status = 'paid' where organization_id = $1", [A.orgId]);
    await runLifecycle();
    expect(await subRow()).toMatchObject({ plan_key: "starter", pending_plan_key: null });
    expect(await orgRow()).toMatchObject({ plan: "starter", ai_monthly_credits: 0 });
  });

  it("limites do plano Essencial: sem IA, sem campanhas, 3 automações", async () => {
    const e = await withTenant(A, (db) => entitlements(db, A.orgId));
    expect(e.plan.features.ai).toBe(false);
    const id = (await q<{ id: string }>("select id from automations where name = 'A3'"))[0].id;
    await expect(withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"))).rejects.toThrow(AutomationError);
    const { reserveCredit } = await import("@/modules/ai/usage");
    await expect(reserveCredit(A.orgId, A.userId, "reply")).rejects.toThrow(/não inclui o copiloto/);
  });
});

describe("inadimplência e cancelamento", () => {
  it("vencida: carência; depois de 7 dias, acesso restrito; pagamento regulariza", async () => {
    const s = await subRow();
    const due = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
    await webhook("PAYMENT_OVERDUE", { id: "pay_late", subscription: s.gateway_subscription_id, status: "OVERDUE", value: 149, dueDate: due });
    expect((await orgRow()).status).toBe("past_due");
    await q("update invoices set due_date = current_date - 8 where gateway_payment_id = 'pay_late'");
    await runLifecycle();
    expect((await orgRow()).status).toBe("suspended");
    await expect(withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "X", { trigger: { type: "contact.created" }, steps: [{ type: "create_task", title: "x", dueHours: 1 }] }))
      .then((id) => withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active")))).rejects.toThrow(/acesso restrito/);
    await webhook("PAYMENT_RECEIVED", { id: "pay_late", subscription: s.gateway_subscription_id, status: "RECEIVED", value: 149, dueDate: due });
    expect((await orgRow()).status).toBe("active");
  });

  it("limite de contatos vale para cadastro manual", async () => {
    await q("update organizations set plan = 'starter' where id = $1", [A.orgId]);
    await q(`insert into contacts (organization_id, display_name) select $1, 'C' || g from generate_series(1, 2000) g`, [A.orgId]);
    await expect(withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Excedente" }))).rejects.toThrow(/2\.000 contatos/);
  });

  it("cancelamento: remove no gateway, mantém acesso até o fim do período", async () => {
    const s = await subRow();
    await q("update subscriptions set current_period_end = now() + interval '10 days' where organization_id = $1", [A.orgId]);
    await cancelSubscription(A.orgId, A.userId);
    expect(subs.get(s.gateway_subscription_id)!.deleted).toBe(true);
    expect((await orgRow()).status).toBe("active");
    await q("update subscriptions set current_period_end = now() - interval '1 minute' where organization_id = $1", [A.orgId]);
    await runLifecycle();
    expect((await orgRow()).status).toBe("canceled");
    await expect(cancelSubscription(A.orgId, A.userId)).rejects.toThrow(BillingError);
  });
});
