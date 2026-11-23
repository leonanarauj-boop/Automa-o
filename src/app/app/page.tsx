import Link from "next/link";
import { tenant } from "@/lib/session";
import { dashboardMetrics, stageFunnel } from "@/modules/dashboard/metrics";
import { radarSummary } from "@/modules/radar/service";
import { money } from "@/lib/format";
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, buttonClass } from "@/components/ui";
import { removeDemoAction, seedDemoAction } from "./actions";

export const metadata = { title: "Painel" };

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "money" | "success" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "money" ? "text-money" : tone === "success" ? "text-success" : ""}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ bemvindo?: string }> }) {
  const sp = await searchParams;
  const { m, funnel, radar, channel, role } = await tenant(async (db, s) => ({
    m: await dashboardMetrics(db, s.orgId),
    funnel: await stageFunnel(db),
    radar: await radarSummary(db, s.orgId),
    channel: (await db.query("select 1 from channel_accounts where status = 'active' limit 1")).rowCount! > 0,
    role: s.role,
  }));
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));
  const delta = m.prevContacts ? Math.round(((m.newContacts - m.prevContacts) / m.prevContacts) * 100) : null;
  const empty = m.newContacts === 0 && m.openDeals === 0 && m.demoContacts === 0;

  return (
    <>
      <PageHeader title="Painel" description={`Últimos ${m.days} dias · dados reais da sua conta`} />

      {sp.bemvindo && <div className="mb-6"><Notice tone="success">Conta criada! Seu funil, etiquetas e alertas do Radar já foram configurados para o seu segmento.</Notice></div>}

      {(!channel || empty || m.demoContacts > 0) && (
        <Card className="mb-6">
          <CardHeader title="Primeiros passos" description="Complete para começar a receber e organizar clientes automaticamente." />
          <ol className="divide-y divide-border text-sm">
            <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span>{channel ? "✓ " : "1. "}Conectar o WhatsApp oficial (Cloud API)</span>
              {channel ? <Badge tone="success">Conectado</Badge> : <LinkButton href="/app/settings#whatsapp" size="sm">Conectar</LinkButton>}
            </li>
            <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span>2. Conhecer o sistema com dados de demonstração <span className="text-muted">(marcados como DEMO, removíveis)</span></span>
              {role !== "agent" && (m.demoContacts > 0
                ? <form action={removeDemoAction}><button className={buttonClass("secondary", "sm")}>Remover dados de demonstração</button></form>
                : <form action={seedDemoAction}><button className={buttonClass("secondary", "sm")}>Carregar demonstração</button></form>)}
            </li>
          </ol>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Novos contatos" value={String(m.newContacts)} hint={delta === null ? "sem período anterior para comparar" : `${delta >= 0 ? "+" : ""}${delta}% vs. período anterior`} />
        <Kpi label="Vendas concluídas" value={money(m.wonValue)} hint={`${m.wonCount} venda(s)${m.avgTicket ? ` · ticket médio ${money(m.avgTicket)}` : ""}`} tone="success" />
        <Kpi label="Em negociação" value={money(m.openValue)} hint={`${m.openDeals} negócio(s) abertos`} />
        <Kpi label="1ª resposta (média)" value={m.avgFirstResponseMin === null ? "—" : m.avgFirstResponseMin < 60 ? `${m.avgFirstResponseMin} min` : `${Math.round(m.avgFirstResponseMin / 60)} h`} hint="tempo até a primeira resposta da equipe" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Funil" description="Negócios por etapa (abertos + movimentados nos últimos 30 dias)" action={<Link href="/app/pipeline" className="text-sm text-primary hover:underline">Abrir funil</Link>} />
          <ul className="space-y-3 px-5 py-4">
            {funnel.map((f) => (
              <li key={f.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-muted">{f.name}</span>
                <div className="h-2.5 rounded-full bg-surface-2" role="presentation">
                  <div className={`h-2.5 rounded-full ${f.kind === "won" ? "bg-success" : f.kind === "lost" ? "bg-danger/60" : "bg-primary"}`} style={{ width: `${(f.count / maxCount) * 100}%` }} />
                </div>
                <span className="tabular-nums">{f.count} <span className="text-muted">· {money(f.value)}</span></span>
              </li>
            ))}
          </ul>
          {m.winRate !== null && <p className="border-t border-border px-5 py-3 text-sm text-muted">Taxa de ganho no período: <strong className="text-text">{Math.round(m.winRate * 100)}%</strong> (ganhos ÷ ganhos + perdidos)</p>}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Radar de oportunidades" action={<Link href="/app/radar" className="text-sm text-primary hover:underline">Ver todas</Link>} />
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="text-xs font-medium text-muted">Potencial parado (estimativa)</p>
              <p className="text-2xl font-semibold text-money tabular-nums">{money(radar.potentialFromDeals + radar.potentialEstimated)}</p>
              <p className="text-xs text-muted">{radar.openCount} oportunidade(s) precisando de ação</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Receita recuperada este mês (real)</p>
              <p className="text-xl font-semibold text-success tabular-nums">{money(radar.recoveredThisMonth)}</p>
              <p className="text-xs text-muted">somente negócios ganhos após um alerta do Radar</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone={m.awaitingReply ? "danger" : "neutral"}>{m.awaitingReply} aguardando resposta</Badge>
              <Badge tone={m.tasksDue ? "money" : "neutral"}>{m.tasksDue} tarefa(s) para hoje</Badge>
              <Link href="/app/agenda"><Badge tone="primary">{m.appointmentsToday} agendamento(s) hoje</Badge></Link>
              {m.noShowRate !== null && <Badge tone={m.noShowRate > 0.15 ? "danger" : "neutral"}>faltas: {Math.round(m.noShowRate * 100)}%</Badge>}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
