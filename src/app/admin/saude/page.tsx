import { health } from "@/modules/admin/service";
import { dateTime } from "@/lib/format";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { retryJobAction } from "../actions";

export const metadata = { title: "Saúde operacional" };

export default async function Health() {
  const h = await health();
  const empty = (t: string) => <p className="px-5 py-4 text-sm text-muted">{t}</p>;
  return (
    <>
      <PageHeader title="Saúde operacional" />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Jobs com falha (${h.failedJobs.length})`} description="Reprocessar é seguro: mensagens já marcadas como falhas não são reenviadas." />
          {h.failedJobs.length === 0 ? empty("Nenhum.") : <ul className="divide-y divide-border text-sm">{h.failedJobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span><span className="font-mono text-xs">{j.type}</span> <span className="text-muted">· {j.attempts} tentativa(s) · {dateTime(j.created_at)}</span><span className="block text-xs text-danger">{j.last_error}</span></span>
              <form action={retryJobAction}><input type="hidden" name="id" value={j.id} /><button className="text-xs font-medium text-primary hover:underline">Reprocessar</button></form>
            </li>))}</ul>}
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Webhooks do WhatsApp com erro" />
            {h.webhookErrors.length === 0 ? empty("Nenhum.") : <ul className="divide-y divide-border text-sm">{h.webhookErrors.map((w) => <li key={w.id} className="px-5 py-2"><span className="text-xs text-muted">{dateTime(w.received_at)}</span><span className="block text-xs text-danger">{w.error}</span></li>)}</ul>}</Card>
          <Card><CardHeader title="Eventos de pagamento com erro" />
            {h.billingErrors.length === 0 ? empty("Nenhum.") : <ul className="divide-y divide-border text-sm">{h.billingErrors.map((w) => <li key={w.id} className="px-5 py-2"><span className="font-mono text-xs">{w.type}</span> <span className="text-xs text-muted">{dateTime(w.received_at)}</span><span className="block text-xs text-danger">{w.error}</span></li>)}</ul>}</Card>
          <Card><CardHeader title="E-mails não enviados" />
            {h.emails.length === 0 ? empty("Nenhum.") : <ul className="divide-y divide-border text-sm">{h.emails.map((e, k) => <li key={k} className="px-5 py-2"><span className="font-mono text-xs">{e.template}</span> <span className="text-xs text-muted">· {e.status} · {dateTime(e.created_at)}</span>{e.error && <span className="block text-xs text-danger">{e.error}</span>}</li>)}</ul>}</Card>
          <Card><CardHeader title="Ações administrativas recentes" />
            {h.adminLog.length === 0 ? empty("Nenhuma.") : <ul className="divide-y divide-border text-sm">{h.adminLog.map((a, k) => <li key={k} className="px-5 py-2"><span className="font-mono text-xs">{a.action}</span> <span className="text-xs text-muted">· {a.admin ?? "—"}{a.org ? ` · ${a.org}` : ""} · {dateTime(a.created_at)}</span></li>)}</ul>}</Card>
        </div>
      </div>
    </>
  );
}
