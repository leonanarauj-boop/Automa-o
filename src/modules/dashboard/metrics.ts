import type { Db } from "@/lib/db";

/** Indicadores essenciais do painel, calculados a partir de dados reais da organização. */
export async function dashboardMetrics(db: Db, orgId: string, days = 30) {
  const r = await db.query<{
    new_contacts: string; prev_contacts: string; open_deals: string; open_value: string | null;
    won_count: string; won_value: string | null; lost_count: string; awaiting: string; tasks_due: string;
    avg_first_response_min: string | null; demo_contacts: string;
  }>(
    `with p as (select now() - make_interval(days => $2::int) as start, now() - make_interval(days => $2::int * 2) as prev_start)
     select
       (select count(*) from contacts, p where organization_id = $1 and deleted_at is null and created_at >= p.start) as new_contacts,
       (select count(*) from contacts, p where organization_id = $1 and deleted_at is null and created_at >= p.prev_start and created_at < p.start) as prev_contacts,
       (select count(*) from deals where organization_id = $1 and status = 'open') as open_deals,
       (select sum(value_cents) from deals where organization_id = $1 and status = 'open') as open_value,
       (select count(*) from deals, p where organization_id = $1 and status = 'won' and won_at >= p.start) as won_count,
       (select sum(value_cents) from deals, p where organization_id = $1 and status = 'won' and won_at >= p.start) as won_value,
       (select count(*) from deals, p where organization_id = $1 and status = 'lost' and updated_at >= p.start) as lost_count,
       (select count(*) from contacts where organization_id = $1 and deleted_at is null and last_inbound_at is not null
          and (last_outbound_at is null or last_outbound_at < last_inbound_at)) as awaiting,
       (select count(*) from tasks where organization_id = $1 and status = 'open' and due_at < now() + interval '1 day') as tasks_due,
       (select round(avg(extract(epoch from (fo.sent_at - fi.sent_at)) / 60)::numeric, 0)
          from conversations c, p,
          lateral (select min(sent_at) sent_at from messages where conversation_id = c.id and direction = 'inbound') fi,
          lateral (select min(sent_at) sent_at from messages where conversation_id = c.id and direction = 'outbound' and sent_at > fi.sent_at) fo
          where c.organization_id = $1 and fi.sent_at >= p.start and fo.sent_at is not null) as avg_first_response_min,
       (select count(*) from contacts where organization_id = $1 and is_demo and deleted_at is null) as demo_contacts`,
    [orgId, days],
  );
  const x = r.rows[0];
  const won = Number(x.won_count);
  const lost = Number(x.lost_count);
  return {
    days,
    newContacts: Number(x.new_contacts),
    prevContacts: Number(x.prev_contacts),
    openDeals: Number(x.open_deals),
    openValue: Number(x.open_value ?? 0),
    wonCount: won,
    wonValue: Number(x.won_value ?? 0),
    avgTicket: won ? Math.round(Number(x.won_value ?? 0) / won) : null,
    winRate: won + lost ? won / (won + lost) : null,
    awaitingReply: Number(x.awaiting),
    tasksDue: Number(x.tasks_due),
    avgFirstResponseMin: x.avg_first_response_min === null ? null : Number(x.avg_first_response_min),
    demoContacts: Number(x.demo_contacts),
  };
}

export async function stageFunnel(db: Db) {
  const r = await db.query<{ name: string; kind: string; count: string; value: string | null }>(
    `select s.name, s.kind, count(d.id) as count, sum(d.value_cents) as value
     from pipeline_stages s join pipelines p on p.id = s.pipeline_id and p.is_default
     left join deals d on d.stage_id = s.id and (d.status = 'open' or d.updated_at > now() - interval '30 days')
     group by s.id order by s.position`,
  );
  return r.rows.map((x) => ({ name: x.name, kind: x.kind, count: Number(x.count), value: Number(x.value ?? 0) }));
}
