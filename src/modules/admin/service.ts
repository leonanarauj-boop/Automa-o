import { z } from "zod";
import { withService, type Db } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { recompute } from "@/modules/billing/service";

/**
 * Painel da plataforma. Regras de privacidade:
 * - NUNCA consulta conteúdo de mensagens, contatos, notas ou base de conhecimento dos clientes;
 *   apenas contagens e metadados operacionais/financeiros.
 * - Toda ação é registrada em admin_audit E no registro de auditoria da própria empresa (visível a ela).
 */
export class AdminError extends Error {}

export async function isPlatformAdmin(userId: string) {
  return withService(async (db) => !!(await db.query("select 1 from platform_admins where user_id = $1", [userId])).rowCount);
}

async function logAdmin(db: Db, adminId: string, action: string, orgId: string | null, metadata?: Record<string, unknown>) {
  await db.query("insert into admin_audit (admin_user_id, action, organization_id, metadata) values ($1,$2,$3,$4)", [adminId, action, orgId, metadata ? JSON.stringify(metadata) : null]);
  if (orgId) await audit(db, { orgId, actorType: "platform_admin", actorId: adminId, action: `platform.${action}`, metadata });
}

export async function overview() {
  return withService(async (db) => {
    const r = (await db.query<Record<string, string | null>>(
      `select
        (select count(*) from organizations) orgs,
        (select count(*) from organizations where status = 'trial') trial,
        (select count(*) from organizations where status = 'active') active,
        (select count(*) from organizations where status = 'past_due') past_due,
        (select count(*) from organizations where status in ('suspended','canceled')) restricted,
        (select count(*) from organizations where created_at > now() - interval '7 days') new7,
        (select count(*) from organizations where created_at > now() - interval '30 days') new30,
        (select count(*) from organizations where status = 'trial' and trial_ends_at between now() and now() + interval '3 days') trials_ending,
        (select coalesce(sum(price_cents), 0) from subscriptions where status in ('active','past_due')) mrr,
        (select count(*) from subscriptions where status in ('active','past_due')) paying,
        (select coalesce(sum(cost_micros), 0) from ai_calls where created_at > now() - interval '30 days') ai_cost,
        (select count(*) from messages where direction = 'outbound' and created_at > now() - interval '24 hours') sent24,
        (select count(*) from messages where direction = 'inbound' and created_at > now() - interval '24 hours') received24,
        (select count(*) from jobs where status = 'failed') failed_jobs,
        (select count(*) from jobs where status = 'queued' and run_at < now() - interval '5 minutes') late_jobs,
        (select count(*) from webhook_events where error is not null and received_at > now() - interval '7 days') wh_errors,
        (select count(*) from billing_events where error is not null and received_at > now() - interval '7 days') billing_errors,
        (select count(*) from email_log where status <> 'sent' and created_at > now() - interval '7 days') email_issues,
        (select extract(epoch from now() - max(last_seen_at))::int from worker_heartbeats) worker_age`)).rows[0];
    const byPlan = (await db.query<{ plan: string; n: string }>("select plan, count(*) n from organizations group by plan order by plan")).rows;
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      orgs: n("orgs"), trial: n("trial"), active: n("active"), pastDue: n("past_due"), restricted: n("restricted"), new7: n("new7"), new30: n("new30"),
      trialsEnding: n("trials_ending"), mrrCents: n("mrr"), paying: n("paying"), aiCostUsd30: n("ai_cost") / 1e6, sent24: n("sent24"), received24: n("received24"),
      failedJobs: n("failed_jobs"), lateJobs: n("late_jobs"), webhookErrors: n("wh_errors"), billingErrors: n("billing_errors"), emailIssues: n("email_issues"),
      byPlan: byPlan.map((x) => ({ plan: x.plan, n: Number(x.n) })),
      workerAgeSeconds: r.worker_age === null ? null : Number(r.worker_age),
    };
  });
}

export async function listOrgs(opts: { q?: string; status?: string; page?: number }) {
  const page = Math.max(0, opts.page ?? 0);
  return withService(async (db) => (await db.query<{
    id: string; name: string; segment: string; status: string; plan: string; created_at: Date; trial_ends_at: Date; members: string; contacts: string; mrr: string | null; last_message: Date | null; total: string;
  }>(
    `select o.id, o.name, o.segment, o.status, o.plan, o.created_at, o.trial_ends_at,
       (select count(*) from memberships m where m.organization_id = o.id and m.status = 'active') members,
       (select count(*) from contacts c where c.organization_id = o.id and c.deleted_at is null and not c.is_demo) contacts,
       (select price_cents from subscriptions s where s.organization_id = o.id and s.status in ('active','past_due')) mrr,
       (select max(created_at) from messages m where m.organization_id = o.id) last_message,
       count(*) over() total
     from organizations o
     where ($1::text is null or o.name ilike $1 or o.id::text = $2) and ($3::text is null or o.status = $3)
     order by o.created_at desc limit 50 offset $4`,
    [opts.q ? `%${opts.q.replace(/[%_]/g, "\\$&")}%` : null, opts.q ?? "", opts.status || null, page * 50])).rows);
}

export async function orgDetail(orgId: string) {
  return withService(async (db) => {
    const org = (await db.query<{ id: string; name: string; segment: string; status: string; plan: string; created_at: Date; trial_ends_at: Date; ai_monthly_credits: number; ai_credits_override: number | null; admin_blocked_reason: string | null; require_mfa: boolean }>(
      "select id, name, segment, status, plan, created_at, trial_ends_at, ai_monthly_credits, ai_credits_override, admin_blocked_reason, require_mfa from organizations where id = $1", [orgId])).rows[0];
    if (!org) return null;
    const sub = (await db.query<{ plan_key: string; status: string; price_cents: string; current_period_end: Date | null; pending_plan_key: string | null; coupon_code: string | null; gateway_subscription_id: string | null; canceled_at: Date | null }>(
      "select plan_key, status, price_cents, current_period_end, pending_plan_key, coupon_code, gateway_subscription_id, canceled_at from subscriptions where organization_id = $1", [orgId])).rows[0] ?? null;
    const invoices = (await db.query<{ amount_cents: string; status: string; due_date: string; paid_at: Date | null }>(
      "select amount_cents, status, to_char(due_date,'DD/MM/YYYY') due_date, paid_at from invoices where organization_id = $1 order by due_date desc limit 12", [orgId])).rows;
    const usage = (await db.query<Record<string, string>>(
      `select (select count(*) from contacts where organization_id = $1 and deleted_at is null and not is_demo) contacts,
              (select count(*) from messages where organization_id = $1 and created_at > now() - interval '30 days' and direction = 'outbound') sent30,
              (select count(*) from messages where organization_id = $1 and created_at > now() - interval '30 days' and direction = 'inbound') received30,
              (select count(*) from ai_calls where organization_id = $1 and created_at >= date_trunc('month', now()) and status <> 'error') ai_month,
              (select coalesce(sum(cost_micros),0) from ai_calls where organization_id = $1 and created_at >= date_trunc('month', now())) ai_cost,
              (select count(*) from automations where organization_id = $1 and status = 'active') automations,
              (select count(*) from campaigns where organization_id = $1) campaigns,
              (select count(*) from channel_accounts where organization_id = $1 and status = 'active') channels`, [orgId])).rows[0];
    const members = (await db.query<{ full_name: string; email: string; role: string; status: string; mfa: boolean }>(
      "select u.full_name, u.email, m.role, m.status, u.mfa_enabled_at is not null as mfa from memberships m join users u on u.id = m.user_id where m.organization_id = $1 order by m.created_at", [orgId])).rows;
    const auditRows = (await db.query<{ action: string; actor_type: string; created_at: Date }>(
      "select action, actor_type, created_at from audit_logs where organization_id = $1 order by created_at desc limit 30", [orgId])).rows;
    return { org, sub, invoices, usage, members, audit: auditRows };
  });
}

export async function extendTrial(adminId: string, orgId: string, days: number) {
  const d = z.number().int().min(1).max(60).parse(days);
  await withService(async (db) => {
    const r = await db.query("update organizations set trial_ends_at = greatest(trial_ends_at, now()) + make_interval(days => $2) where id = $1", [orgId, d]);
    if (!r.rowCount) throw new AdminError("Empresa não encontrada.");
    await logAdmin(db, adminId, "trial_extended", orgId, { days: d });
    await recompute(db, orgId);
  });
}

export async function setAiOverride(adminId: string, orgId: string, credits: number | null) {
  const c = credits === null ? null : z.number().int().min(0).max(1_000_000).parse(credits);
  await withService(async (db) => {
    await db.query("update organizations set ai_credits_override = $2 where id = $1", [orgId, c]);
    await logAdmin(db, adminId, "ai_credits_override", orgId, { credits: c });
    await recompute(db, orgId);
  });
}

export async function setBlocked(adminId: string, orgId: string, reason: string | null) {
  const r = reason === null ? null : z.string().trim().min(5, "Descreva o motivo do bloqueio").max(300).parse(reason);
  await withService(async (db) => {
    await db.query("update organizations set admin_blocked_reason = $2 where id = $1", [orgId, r]);
    await logAdmin(db, adminId, r ? "blocked" : "unblocked", orgId, r ? { reason: r } : undefined);
    await recompute(db, orgId);
  });
}

export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, "Use 3 a 40 letras, números, - ou _"),
  percentOff: z.coerce.number().int().min(1).max(100),
  durationMonths: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v > 0 && v <= 36), "Meses inválidos"),
  maxRedemptions: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v > 0), "Limite inválido"),
  validUntil: z.string().optional().transform((v) => (v ? new Date(`${v}T23:59:59-03:00`) : null)),
});

export async function createCoupon(adminId: string, input: z.input<typeof couponSchema>) {
  const d = couponSchema.parse(input);
  await withService(async (db) => {
    try {
      await db.query("insert into coupons (code, percent_off, duration_months, max_redemptions, valid_until) values ($1,$2,$3,$4,$5)", [d.code, d.percentOff, d.durationMonths, d.maxRedemptions, d.validUntil]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AdminError("Já existe um cupom com este código.");
      throw e;
    }
    await logAdmin(db, adminId, "coupon_created", null, { code: d.code, percentOff: d.percentOff });
  });
}

export async function setCouponActive(adminId: string, code: string, active: boolean) {
  await withService(async (db) => {
    await db.query("update coupons set active = $2 where code = $1", [code, active]);
    await logAdmin(db, adminId, active ? "coupon_activated" : "coupon_deactivated", null, { code });
  });
}

export async function health() {
  return withService(async (db) => ({
    failedJobs: (await db.query<{ id: string; type: string; attempts: number; last_error: string | null; created_at: Date; org: string | null }>(
      "select id, type, attempts, last_error, created_at, payload->>'orgId' as org from jobs where status = 'failed' order by created_at desc limit 50")).rows,
    webhookErrors: (await db.query<{ id: string; error: string; received_at: Date }>(
      "select id, error, received_at from webhook_events where error is not null order by received_at desc limit 30")).rows,
    billingErrors: (await db.query<{ id: string; type: string; error: string; received_at: Date }>(
      "select id, type, error, received_at from billing_events where error is not null order by received_at desc limit 30")).rows,
    emails: (await db.query<{ template: string; status: string; error: string | null; created_at: Date }>(
      "select template, status, error, created_at from email_log where status <> 'sent' order by created_at desc limit 30")).rows,
    adminLog: (await db.query<{ action: string; created_at: Date; admin: string | null; org: string | null }>(
      "select a.action, a.created_at, u.email as admin, o.name as org from admin_audit a left join users u on u.id = a.admin_user_id left join organizations o on o.id = a.organization_id order by a.created_at desc limit 30")).rows,
  }));
}

/** Recoloca um job com falha na fila. Envios já marcados como falhos não são reenviados (só mensagens pendentes saem). */
export async function retryJob(adminId: string, jobId: string) {
  await withService(async (db) => {
    const r = await db.query<{ type: string }>("update jobs set status = 'queued', attempts = 0, run_at = now(), last_error = null where id = $1 and status = 'failed' returning type", [jobId]);
    if (!r.rowCount) throw new AdminError("Job não encontrado ou não está com falha.");
    await logAdmin(db, adminId, "job_retried", null, { jobId, type: r.rows[0].type });
  });
}
