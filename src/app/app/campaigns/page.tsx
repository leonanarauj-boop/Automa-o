import Link from "next/link";
import { tenant } from "@/lib/session";
import { dailyCapacity } from "@/modules/messaging/template-send";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { createCampaignAction, saveLimitsAction } from "./actions";
import { CAMPAIGN_STATUS } from "./status";

export const metadata = { title: "Campanhas" };


export default async function Campaigns() {
  const d = await tenant(async (db, s) => ({
    role: s.role,
    list: (await db.query<{ id: string; name: string; status: string; scheduled_at: Date | null; created_at: Date; template: string | null; queued: string; replied: string }>(
      `select c.id, c.name, c.status, c.scheduled_at, c.created_at, t.name as template,
         (select count(*) from campaign_recipients cr where cr.campaign_id = c.id and cr.status = 'queued' and not cr.is_test) as queued,
         (select count(*) from campaign_recipients cr join messages m on m.id = cr.message_id where cr.campaign_id = c.id and not cr.is_test
            and exists (select 1 from messages i where i.conversation_id = m.conversation_id and i.direction = 'inbound' and i.sent_at > m.sent_at and i.sent_at < m.sent_at + interval '72 hours')) as replied
       from campaigns c left join message_templates t on t.id = c.template_id order by coalesce(c.scheduled_at, c.created_at) desc limit 100`)).rows,
    org: (await db.query<{ daily_template_limit: number; campaign_frequency_days: number }>("select daily_template_limit, campaign_frequency_days from organizations limit 1")).rows[0],
    cap: await dailyCapacity(db, s.orgId),
  }));
  const manager = d.role !== "agent";
  return (
    <>
      <PageHeader title="Campanhas" description="Mensagens para grupos de clientes, sempre com template aprovado, consentimento registrado e aprovação de um gestor." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          {d.list.length === 0 ? <EmptyState title="Nenhuma campanha ainda">Crie a primeira ao lado. Só recebem campanhas os contatos que autorizaram mensagens de marketing.</EmptyState> : (
            <ul className="divide-y divide-border">
              {d.list.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/campaigns/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2">
                    <span><span className="font-medium">{c.name}</span><span className="block text-xs text-muted">{c.template ?? "sem template"} · {c.scheduled_at ? `envio ${dateTime(c.scheduled_at)}` : `criada ${dateTime(c.created_at)}`}</span></span>
                    <span className="flex items-center gap-3 text-sm">
                      {Number(c.queued) > 0 && <span className="text-muted tabular-nums">{c.queued} enviadas · {c.replied} responderam</span>}
                      <Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Nova campanha</h2>
            <ActionForm action={createCampaignAction} className="mt-3 space-y-3">
              <Input name="name" required placeholder="Ex.: Retorno de clientes inativos" aria-label="Nome da campanha" />
              <SubmitButton className="w-full">Criar rascunho</SubmitButton>
            </ActionForm>
          </Card>
          <Card>
            <CardHeader title="Limites de envio" description={`Hoje: ${d.cap.used} de ${d.cap.limit} contatos com template nas últimas 24h.`} />
            <ActionForm action={saveLimitsAction} className="space-y-3 p-5">
              <Field label="Contatos por dia (limite da Meta)" htmlFor="daily" hint="Use o limite atual do seu número no Gerenciador do WhatsApp (ex.: 250, 1.000)."><Input id="daily" name="daily" type="number" min={0} defaultValue={d.org.daily_template_limit} disabled={!manager} /></Field>
              <Field label="Intervalo mínimo entre campanhas (dias)" htmlFor="frequency" hint="Um contato não recebe outra campanha antes desse prazo."><Input id="frequency" name="frequency" type="number" min={0} max={90} defaultValue={d.org.campaign_frequency_days} disabled={!manager} /></Field>
              {manager && <SubmitButton size="sm" variant="secondary">Salvar limites</SubmitButton>}
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
