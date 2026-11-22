import type { Db } from "@/lib/db";
import { evaluateRadar, type RadarRow, type RuleKind } from "./rules";

/**
 * Recalcula os sinais do Radar de uma organização. Funciona tanto no contexto do tenant (RLS)
 * quanto no de serviço (worker), pois todas as consultas filtram por organization_id.
 */
export async function refreshRadar(db: Db, orgId: string, now = new Date()) {
  const rules = await db.query<{ kind: RuleKind; threshold_hours: number }>(
    "select kind, threshold_hours from opportunity_rules where organization_id = $1 and active",
    [orgId],
  );
  const thresholds = Object.fromEntries(rules.rows.map((r) => [r.kind, r.threshold_hours]));

  const avg = await db.query<{ avg: string | null }>(
    "select avg(value_cents)::bigint as avg from deals where organization_id = $1 and status = 'won' and value_cents > 0",
    [orgId],
  );
  const avgTicket = avg.rows[0].avg ? Number(avg.rows[0].avg) : null;

  const rows = await db.query<RadarRow>(
    `select c.id as "contactId", c.display_name as "contactName",
            c.last_inbound_at as "lastInboundAt", c.last_outbound_at as "lastOutboundAt",
            (select max(cv.service_window_expires_at) from conversations cv where cv.contact_id = c.id) as "windowExpiresAt",
            d.id as "dealId", d.value_cents::float8 as "dealValueCents", s.name as "dealStageName", d.last_activity_at as "dealLastActivityAt"
     from contacts c
     left join lateral (
       select * from deals d where d.contact_id = c.id and d.status = 'open' order by d.value_cents desc, d.created_at limit 1
     ) d on true
     left join pipeline_stages s on s.id = d.stage_id
     where c.organization_id = $1 and c.deleted_at is null
       and (c.last_inbound_at is not null or d.id is not null)`,
    [orgId],
  );

  const candidates = evaluateRadar(rows.rows, thresholds, avgTicket, now);
  const keep: string[] = [];
  for (const c of candidates) {
    const r = await db.query<{ id: string }>(
      `insert into opportunity_signals (organization_id, rule_kind, contact_id, deal_id, potential_value_cents, value_basis, reason, recommended_action)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (organization_id, rule_kind, contact_id, coalesce(deal_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open'
       do update set potential_value_cents = excluded.potential_value_cents, value_basis = excluded.value_basis,
                     reason = excluded.reason, recommended_action = excluded.recommended_action
       returning id`,
      [orgId, c.ruleKind, c.contactId, c.dealId, c.potentialValueCents, c.valueBasis, c.reason, c.recommendedAction],
    );
    keep.push(r.rows[0].id);
  }
  // Sinais abertos cuja condição deixou de existir são resolvidos automaticamente.
  await db.query(
    `update opportunity_signals set status = 'resolved', resolved_at = now()
     where organization_id = $1 and status = 'open' and not (id = any($2::uuid[]))`,
    [orgId, keep],
  );
  return { open: keep.length };
}

/** Chamado quando um negócio é ganho: sinais abertos dele (ou do contato) viram receita RECUPERADA. */
export async function markRecovered(db: Db, orgId: string, dealId: string) {
  await db.query(
    `update opportunity_signals s set status = 'recovered', resolved_at = now(), recovered_value_cents = d.value_cents
     from deals d
     where d.id = $2 and s.organization_id = $1 and s.status = 'open'
       and (s.deal_id = d.id or (s.deal_id is null and s.contact_id = d.contact_id))`,
    [orgId, dealId],
  );
}

export async function radarSummary(db: Db, orgId: string) {
  const r = await db.query<{
    open_count: string; potential_deal: string | null; potential_estimated: string | null; unknown_count: string;
    recovered_month: string | null; recovered_count_month: string;
  }>(
    `select
       count(*) filter (where status = 'open') as open_count,
       sum(potential_value_cents) filter (where status = 'open' and value_basis = 'deal_value') as potential_deal,
       sum(potential_value_cents) filter (where status = 'open' and value_basis = 'avg_ticket') as potential_estimated,
       count(*) filter (where status = 'open' and value_basis = 'unknown') as unknown_count,
       sum(recovered_value_cents) filter (where status = 'recovered' and resolved_at >= date_trunc('month', now())) as recovered_month,
       count(*) filter (where status = 'recovered' and resolved_at >= date_trunc('month', now())) as recovered_count_month
     from opportunity_signals where organization_id = $1`,
    [orgId],
  );
  const x = r.rows[0];
  return {
    openCount: Number(x.open_count),
    potentialFromDeals: Number(x.potential_deal ?? 0),
    potentialEstimated: Number(x.potential_estimated ?? 0),
    unknownValueCount: Number(x.unknown_count),
    recoveredThisMonth: Number(x.recovered_month ?? 0),
    recoveredCountThisMonth: Number(x.recovered_count_month),
  };
}
