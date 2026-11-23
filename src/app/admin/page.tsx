import Link from "next/link";
import { overview } from "@/modules/admin/service";
import { money } from "@/lib/format";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getPlan } from "@/modules/billing/plans";

export const metadata = { title: "Visão geral" };

function Kpi({ label, value, hint, href, tone }: { label: string; value: string; hint?: string; href?: string; tone?: "danger" | "success" }) {
  const body = (
    <div className="rounded-xl border border-border bg-surface p-4 hover:bg-surface-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function AdminHome() {
  const o = await overview();
  return (
    <>
      <PageHeader title="Visão geral" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Receita recorrente mensal (MRR)" value={money(o.mrrCents)} hint={`${o.paying} assinatura(s) pagante(s)`} tone="success" />
        <Kpi label="Empresas" value={String(o.orgs)} hint={`+${o.new7} em 7 dias · +${o.new30} em 30 dias`} href="/admin/empresas" />
        <Kpi label="Em teste" value={String(o.trial)} hint={`${o.trialsEnding} terminam em até 3 dias`} href="/admin/empresas?status=trial" />
        <Kpi label="Inadimplentes / restritas" value={`${o.pastDue} / ${o.restricted}`} href="/admin/empresas?status=past_due" tone={o.pastDue ? "danger" : undefined} />
        <Kpi label="Mensagens 24h" value={`${o.sent24} enviadas`} hint={`${o.received24} recebidas`} />
        <Kpi label="Custo de IA (30 dias)" value={`US$ ${o.aiCostUsd30.toFixed(2)}`} />
        <Kpi label="Worker" value={o.workerAgeSeconds === null ? "sem sinal" : o.workerAgeSeconds < 120 ? "ativo" : "parado"} hint={o.workerAgeSeconds === null ? "nenhum worker registrado" : `último sinal há ${o.workerAgeSeconds}s`} tone={o.workerAgeSeconds === null || o.workerAgeSeconds >= 120 ? "danger" : "success"} />
        <Kpi label="Jobs com falha" value={String(o.failedJobs)} hint={`${o.lateJobs} atrasados na fila`} href="/admin/saude" tone={o.failedJobs || o.lateJobs ? "danger" : undefined} />
        <Kpi label="Erros de integração (7 dias)" value={String(o.webhookErrors + o.billingErrors + o.emailIssues)} hint={`WhatsApp ${o.webhookErrors} · pagamentos ${o.billingErrors} · e-mail ${o.emailIssues}`} href="/admin/saude" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Empresas por plano" />
        <ul className="divide-y divide-border text-sm">{o.byPlan.map((p) => <li key={p.plan} className="flex justify-between px-5 py-2.5"><span>{getPlan(p.plan).name}</span><span className="tabular-nums">{p.n}</span></li>)}</ul>
      </Card>
    </>
  );
}
