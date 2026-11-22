import Link from "next/link";
import { tenant } from "@/lib/session";
import { radarSummary } from "@/modules/radar/service";
import { RULE_LABELS, type RuleKind } from "@/modules/radar/rules";
import { money, relative } from "@/lib/format";
import { Badge, Card, DemoBadge, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { dismissSignalAction, refreshRadarAction } from "../actions";

export const metadata = { title: "Radar de oportunidades" };

export default async function Radar() {
  const { summary, signals, recovered } = await tenant(async (db, s) => ({
    summary: await radarSummary(db, s.orgId),
    signals: (await db.query<{
      id: string; rule_kind: RuleKind; reason: string; recommended_action: string; potential_value_cents: string | null; value_basis: string;
      detected_at: Date; contact_id: string; display_name: string; is_demo: boolean; conversation_id: string | null; owner: string | null;
    }>(
      `select s.id, s.rule_kind, s.reason, s.recommended_action, s.potential_value_cents, s.value_basis, s.detected_at,
              c.id as contact_id, c.display_name, c.is_demo, u.full_name as owner,
              (select id from conversations cv where cv.contact_id = c.id order by last_message_at desc nulls last limit 1) as conversation_id
       from opportunity_signals s join contacts c on c.id = s.contact_id left join users u on u.id = c.owner_user_id
       where s.status = 'open'
       order by case s.rule_kind when 'awaiting_reply' then 0 else 1 end, s.potential_value_cents desc nulls last, s.detected_at`,
    )).rows,
    recovered: (await db.query<{ id: string; display_name: string; recovered_value_cents: string; resolved_at: Date }>(
      `select s.id, c.display_name, s.recovered_value_cents, s.resolved_at from opportunity_signals s join contacts c on c.id = s.contact_id
       where s.status = 'recovered' order by s.resolved_at desc limit 10`,
    )).rows,
  }));

  return (
    <>
      <PageHeader title="Radar de oportunidades" description="Clientes e negócios que precisam de ação agora, com o valor em jogo."
        action={<form action={refreshRadarAction}><button className={buttonClass("secondary")}>Recalcular agora</button></form>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted">Valor em negócios parados</p>
          <p className="mt-1 text-2xl font-semibold text-money tabular-nums">{money(summary.potentialFromDeals)}</p>
          <p className="mt-1 text-xs text-muted">Soma do valor cadastrado nos negócios. É potencial, não venda.</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted">Estimativa adicional</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(summary.potentialEstimated)}</p>
          <p className="mt-1 text-xs text-muted">Oportunidades sem valor cadastrado, estimadas pelo seu ticket médio. {summary.unknownValueCount > 0 && `${summary.unknownValueCount} sem base para estimar.`}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted">Recuperado este mês</p>
          <p className="mt-1 text-2xl font-semibold text-success tabular-nums">{money(summary.recoveredThisMonth)}</p>
          <p className="mt-1 text-xs text-muted">{summary.recoveredCountThisMonth} negócio(s) ganho(s) depois de um alerta. Valor real registrado.</p>
        </Card>
      </div>

      <Card>
        {signals.length === 0 ? (
          <EmptyState title="Nenhuma oportunidade esquecida agora">O Radar verifica sua base a cada 15 minutos. Ajuste os prazos em <Link href="/app/settings#radar" className="text-primary underline">Configurações</Link>.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {signals.map((s) => (
              <li key={s.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/app/contacts/${s.contact_id}`} className="font-medium hover:underline">{s.display_name}</Link>
                    {s.is_demo && <DemoBadge />}
                    <Badge tone={s.rule_kind === "awaiting_reply" ? "danger" : "money"}>{RULE_LABELS[s.rule_kind]}</Badge>
                    <span className="text-xs text-muted">detectado {relative(s.detected_at)}{s.owner ? ` · responsável: ${s.owner}` : ""}</span>
                  </div>
                  <p className="mt-1 text-sm">{s.reason}</p>
                  <p className="mt-1 text-sm text-muted"><span className="font-medium text-text">Próxima ação:</span> {s.recommended_action}</p>
                </div>
                <div className="flex items-center gap-3 md:flex-col md:items-end">
                  <p className="text-right">
                    <span className="block font-semibold tabular-nums">{s.potential_value_cents ? money(s.potential_value_cents) : "—"}</span>
                    <span className="text-xs text-muted">{s.value_basis === "deal_value" ? "valor do negócio" : s.value_basis === "avg_ticket" ? "estimado (ticket médio)" : "sem valor"}</span>
                  </p>
                  <div className="flex gap-2">
                    {s.conversation_id && <Link href={`/app/inbox?c=${s.conversation_id}`} className={buttonClass("primary", "sm")}>Agir</Link>}
                    <form action={dismissSignalAction}><input type="hidden" name="signalId" value={s.id} /><button className={buttonClass("ghost", "sm")}>Dispensar</button></form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {recovered.length > 0 && (
        <Card className="mt-6">
          <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Recuperações recentes</h2></div>
          <ul className="divide-y divide-border text-sm">
            {recovered.map((r) => <li key={r.id} className="flex justify-between px-5 py-3"><span>{r.display_name}</span><span className="text-success tabular-nums">{money(r.recovered_value_cents)} · {relative(r.resolved_at)}</span></li>)}
          </ul>
        </Card>
      )}
    </>
  );
}
