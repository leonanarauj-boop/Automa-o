import { withService } from "@/lib/db";
import { estimateCostMicros, type AIUsage } from "./provider";

export class AILimitError extends Error {}

/**
 * Reserva 1 crédito de IA antes da chamada (linha 'pending' em ai_calls), com a linha da organização
 * travada — impede que requisições simultâneas ultrapassem o limite mensal.
 */
export async function reserveCredit(orgId: string, userId: string | null, feature: string): Promise<string> {
  return withService(async (db) => {
    const org = await db.query<{ ai_enabled: boolean; ai_monthly_credits: number; status: string; plan: string }>(
      "select ai_enabled, ai_monthly_credits, status, plan from organizations where id = $1 for update", [orgId]);
    const o = org.rows[0];
    if (!o) throw new AILimitError("Organização não encontrada.");
    if (!o.ai_enabled) throw new AILimitError("A IA está desativada nas configurações da conta.");
    if (o.status === "suspended" || o.status === "canceled") throw new AILimitError("Conta com acesso restrito. Regularize a assinatura para usar a IA.");
    const { getPlan } = await import("@/modules/billing/plans");
    if (!getPlan(o.plan).features.ai) throw new AILimitError(`Seu plano (${getPlan(o.plan).name}) não inclui o copiloto de IA. Faça upgrade em Assinatura.`);
    const used = await db.query<{ n: string }>(
      `select count(*) n from ai_calls where organization_id = $1 and created_at >= date_trunc('month', now())
         and status in ('pending','ok','refused','blocked')`, [orgId]);
    if (Number(used.rows[0].n) >= o.ai_monthly_credits) {
      throw new AILimitError(`Limite mensal de ${o.ai_monthly_credits} usos de IA atingido. O limite renova no início do próximo mês.`);
    }
    const r = await db.query<{ id: string }>(
      "insert into ai_calls (organization_id, user_id, feature, status) values ($1,$2,$3,'pending') returning id", [orgId, userId, feature]);
    return r.rows[0].id;
  });
}

export async function finishCall(callId: string, orgId: string, res: {
  status: "ok" | "refused" | "blocked" | "error"; provider: string; model?: string; usage?: AIUsage; latencyMs: number; error?: string;
}) {
  await withService((db) => db.query(
    `update ai_calls set status=$3, provider=$4, model=$5, input_tokens=$6, output_tokens=$7, cache_read_tokens=$8, cache_write_tokens=$9,
       cost_micros=$10, latency_ms=$11, error=$12 where id=$1 and organization_id=$2`,
    [callId, orgId, res.status, res.provider, res.model ?? null, res.usage?.inputTokens ?? null, res.usage?.outputTokens ?? null,
     res.usage?.cacheReadTokens ?? null, res.usage?.cacheWriteTokens ?? null,
     res.model && res.usage ? estimateCostMicros(res.model, res.usage) : null, res.latencyMs, res.error?.slice(0, 500) ?? null],
  ));
}

export async function usageThisMonth(db: import("@/lib/db").Db) {
  const r = await db.query<{ calls: string; cost: string | null; ok: string; blocked: string; refused: string; errors: string }>(
    `select count(*) filter (where status <> 'error') calls, sum(cost_micros) cost,
            count(*) filter (where status='ok') ok, count(*) filter (where status='blocked') blocked,
            count(*) filter (where status='refused') refused, count(*) filter (where status='error') errors
     from ai_calls where created_at >= date_trunc('month', now())`);
  const acc = await db.query<{ total: string; accepted: string; edited: string }>(
    `select count(*) filter (where kind='reply' and status in ('accepted','accepted_edited','rejected')) total,
            count(*) filter (where kind='reply' and status='accepted') accepted,
            count(*) filter (where kind='reply' and status='accepted_edited') edited
     from ai_suggestions where created_at >= date_trunc('month', now())`);
  const x = r.rows[0];
  const a = acc.rows[0];
  return {
    calls: Number(x.calls), costUsd: Number(x.cost ?? 0) / 1_000_000, ok: Number(x.ok), blocked: Number(x.blocked), refused: Number(x.refused), errors: Number(x.errors),
    repliesDecided: Number(a.total), repliesAccepted: Number(a.accepted), repliesEdited: Number(a.edited),
  };
}
