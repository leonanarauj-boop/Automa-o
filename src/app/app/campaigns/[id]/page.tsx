import Link from "next/link";
import { notFound } from "next/navigation";
import { tenant } from "@/lib/session";
import { campaignStats, getCampaign, preview, segmentSchema } from "@/modules/campaigns/service";
import { BLOCK_LABEL } from "@/modules/messaging/template-send";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Select } from "@/components/ui";
import { approveAction, cancelCampaignAction, requestApprovalAction, testSendAction } from "../actions";
import { CampaignEditor } from "../editor";
import { CAMPAIGN_STATUS } from "../status";

const REASON: Record<string, string> = { ...BLOCK_LABEL };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tenant(async (db, s) => {
    const c = await getCampaign(db, id).catch(() => null);
    if (!c) return null;
    const editable = ["draft", "pending_approval"].includes(c.status);
    return {
      c, role: s.role, editable,
      pv: editable || c.status === "scheduled" ? await preview(db, s.orgId, id) : null,
      stats: ["sending", "done", "canceled"].includes(c.status) ? await campaignStats(db, id) : null,
      templates: (await db.query<{ id: string; name: string; language: string; category: string; body_text: string | null; body_param_count: number }>(
        "select id, name, language, category, body_text, body_param_count from message_templates where status = 'APPROVED' order by name")).rows,
      tags: (await db.query<{ id: string; name: string }>("select id, name from tags order by name")).rows,
      stages: (await db.query<{ id: string; name: string }>("select s.id, s.name from pipeline_stages s join pipelines p on p.id = s.pipeline_id and p.is_default order by s.position")).rows,
      testContacts: (await db.query<{ id: string; name: string }>(
        `select c.id, c.display_name as name from contacts c where c.deleted_at is null and c.wa_id is not null and not c.is_demo
         and (select status from consent_records cr where cr.contact_id = c.id and cr.purpose = 'marketing' order by recorded_at desc limit 1) = 'granted'
         order by c.display_name limit 200`)).rows,
      recipients: (await db.query<{ name: string; status: string; skip_reason: string | null; msg_status: string | null; is_test: boolean }>(
        `select c.display_name as name, cr.status, cr.skip_reason, m.status as msg_status, cr.is_test from campaign_recipients cr
         join contacts c on c.id = cr.contact_id left join messages m on m.id = cr.message_id where cr.campaign_id = $1 order by cr.is_test desc, cr.created_at limit 200`, [id])).rows,
    };
  });
  if (!d) notFound();
  const { c, pv, stats } = d;
  const manager = d.role !== "agent";
  const st = CAMPAIGN_STATUS[c.status];
  const pct = (n: number, base: number) => (base ? `${Math.round((n / base) * 100)}%` : "—");

  return (
    <>
      <PageHeader title={c.name} description={<span className="flex flex-wrap items-center gap-2"><Link href="/app/campaigns" className="hover:underline">← Campanhas</Link><Badge tone={st.tone}>{st.label}</Badge>{c.scheduled_at && <span>envio {dateTime(c.scheduled_at)}</span>}</span>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {d.editable ? (
            <Card className="p-5">
              <CampaignEditor id={c.id} templates={d.templates} tags={d.tags} stages={d.stages}
                initial={{ name: c.name, templateId: c.template_id, paramMapping: c.param_mapping, segment: segmentSchema.parse(c.segment), maxRecipients: c.max_recipients }} />
            </Card>
          ) : stats && (
            <Card>
              <CardHeader title="Resultados" description="Atualizados conforme a Meta confirma entregas e leituras." />
              <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
                {[["Enviadas", stats.sent, stats.queued], ["Entregues", stats.delivered, stats.queued], ["Lidas", stats.read, stats.queued], ["Responderam", stats.replied, stats.queued]].map(([l, n, b]) => (
                  <div key={l as string}><p className="text-xs text-muted">{l}</p><p className="text-2xl font-semibold tabular-nums">{n as number}</p><p className="text-xs text-muted">{pct(n as number, b as number)} de {b as number}</p></div>
                ))}
              </div>
              <p className="border-t border-border px-5 py-3 text-sm text-muted">{stats.pending} na fila · {stats.failed} falharam · {stats.skipped} não enviadas{stats.skipReasons.length ? ` (${stats.skipReasons.map((r) => `${REASON[r.reason] ?? r.reason}: ${r.n}`).join("; ")})` : ""}{stats.canceled ? ` · ${stats.canceled} canceladas` : ""}</p>
            </Card>
          )}
          {d.recipients.length > 0 && (
            <Card>
              <CardHeader title="Destinatários" />
              <ul className="divide-y divide-border text-sm">
                {d.recipients.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2 px-5 py-2"><span>{r.name}{r.is_test && <Badge className="ml-2">teste</Badge>}</span>
                    <span className="text-muted">{r.status === "skipped" ? `não enviada: ${REASON[r.skip_reason ?? ""] ?? r.skip_reason}` : r.status === "canceled" ? "cancelada" : r.msg_status ?? "—"}</span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {pv && (
            <Card>
              <CardHeader title="Pré-visualização" />
              <div className="space-y-3 p-5 text-sm">
                <p><span className="text-2xl font-semibold tabular-nums">{pv.eligible}</span> <span className="text-muted">de {pv.total} contatos do segmento podem receber</span></p>
                {Object.entries(pv.excluded).length > 0 && <ul className="space-y-0.5 text-muted">{Object.entries(pv.excluded).map(([k, n]) => <li key={k}>{n} excluído(s): {REASON[k] ?? k}</li>)}</ul>}
                <p className="text-muted">Capacidade hoje: {pv.capacity.remaining} de {pv.capacity.limit}. Serão enviadas até <strong className="text-text">{pv.willSend}</strong>.</p>
                {pv.template && <p className="text-xs text-muted">Template {pv.template.name} · categoria {pv.template.category.toLowerCase()} · cobrado pela Meta por mensagem entregue.</p>}
                {pv.samples.map((s, i) => <div key={i} className="rounded-lg bg-bubble-out p-3"><p className="text-xs text-muted">{s.name}</p><p className="whitespace-pre-wrap">{s.text}</p></div>)}
                {pv.problems.length > 0 && <Notice tone="money">{pv.problems.join(" ")}</Notice>}
              </div>
            </Card>
          )}

          {d.editable && pv && pv.problems.length === 0 && (
            <Card className="space-y-4 p-5">
              {d.testContacts.length > 0 && (
                <ActionForm action={testSendAction} className="space-y-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Enviar teste para" htmlFor="tc"><Select id="tc" name="contactId">{d.testContacts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
                  <SubmitButton size="sm" variant="secondary">Enviar teste</SubmitButton>
                </ActionForm>
              )}
              {manager ? (
                <ActionForm action={approveAction} className="space-y-2 border-t border-border pt-4">
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Agendar para (opcional)" htmlFor="when" hint="Vazio = enviar agora. Horário de Brasília."><Input id="when" name="when" type="datetime-local" /></Field>
                  <SubmitButton className="w-full" pendingText="Aprovando…">Aprovar e agendar envio</SubmitButton>
                </ActionForm>
              ) : c.status === "draft" ? (
                <ActionForm action={requestApprovalAction}><input type="hidden" name="id" value={c.id} /><SubmitButton className="w-full">Enviar para aprovação</SubmitButton></ActionForm>
              ) : <Notice>Aguardando aprovação de um gestor.</Notice>}
            </Card>
          )}

          {manager && c.status !== "canceled" && c.status !== "draft" && (
            <ActionForm action={cancelCampaignAction}><input type="hidden" name="id" value={c.id} /><SubmitButton variant="danger" size="sm" pendingText="Cancelando…">{c.status === "done" || c.status === "sending" ? "Interromper envios pendentes" : "Cancelar campanha"}</SubmitButton></ActionForm>
          )}
        </div>
      </div>
    </>
  );
}
