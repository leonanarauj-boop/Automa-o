import Link from "next/link";
import { notFound } from "next/navigation";
import { tenant } from "@/lib/session";
import { getContact, getDefaultPipeline } from "@/modules/crm/service";
import { dateTime, money, phone, relative } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, DemoBadge, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { addNoteAction, consentAction, createDealAction, createTaskAction, setTagsAction, toggleTaskAction, updateContactAction } from "../../actions";
import { ContactFields } from "../contact-fields";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await tenant(async (db) => {
    const c = await getContact(db, id);
    if (!c) return null;
    return { ...c, allTags: (await db.query<{ id: string; name: string }>("select id, name from tags order by name")).rows, pipeline: await getDefaultPipeline(db) };
  });
  if (!data) notFound();
  const c = data.contact;
  const tagSet = new Set(data.tags.map((t) => t.id));
  const marketing = data.consent.find((x) => x.purpose === "marketing");

  return (
    <>
      <PageHeader
        title={c.display_name}
        description={<span className="flex flex-wrap items-center gap-2"><Link href="/app/contacts" className="hover:underline">← Contatos</Link> · {phone(c.phone_e164)} · origem: {c.source} {c.is_demo && <DemoBadge />}</span>}
        action={data.conversationId ? <LinkButton href={`/app/inbox?c=${data.conversationId}`} variant="secondary">Abrir conversa</LinkButton> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Dados do contato" />
            <ActionForm action={updateContactAction} className="space-y-4 p-5">
              <input type="hidden" name="id" value={c.id} />
              <ContactFields c={c} withNotes />
              <SubmitButton>Salvar alterações</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Negócios" />
            <ul className="divide-y divide-border">
              {data.deals.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="font-medium">{d.title}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "primary"}>{d.stage_name}</Badge>
                    <span className="tabular-nums">{money(d.value_cents)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <ActionForm action={createDealAction} resetOnSuccess className="grid gap-3 border-t border-border p-5 sm:grid-cols-[1fr_8rem_12rem_auto] sm:items-end">
              <input type="hidden" name="contactId" value={c.id} />
              <Field label="Novo negócio" htmlFor="title"><Input id="title" name="title" required placeholder="Ex.: Implante unitário" /></Field>
              <Field label="Valor (R$)" htmlFor="value"><Input id="value" name="value" inputMode="decimal" placeholder="0,00" /></Field>
              <Field label="Etapa" htmlFor="stageId"><Select id="stageId" name="stageId">{data.pipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <SubmitButton>Adicionar</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Notas internas" description="Visíveis apenas para a equipe." />
            <ActionForm action={addNoteAction} resetOnSuccess className="space-y-2 p-5">
              <input type="hidden" name="contactId" value={c.id} />
              <label htmlFor="note" className="sr-only">Nova nota</label>
              <Textarea id="note" name="body" rows={2} required placeholder="Ex.: Prefere contato após as 18h" />
              <SubmitButton size="sm">Adicionar nota</SubmitButton>
            </ActionForm>
            <ul className="divide-y divide-border border-t border-border">
              {data.notes.map((n) => (
                <li key={n.id} className="px-5 py-3 text-sm"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-xs text-muted">{n.author ?? "—"} · {dateTime(n.created_at)}</p></li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Resumo" />
            <dl className="space-y-2 px-5 py-4 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">Última mensagem recebida</dt><dd>{relative(c.last_inbound_at)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Última mensagem enviada</dt><dd>{relative(c.last_outbound_at)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Cliente desde</dt><dd>{dateTime(c.created_at)}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Etiquetas" />
            <ActionForm action={setTagsAction} className="p-5">
              <input type="hidden" name="id" value={c.id} />
              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">Etiquetas</legend>
                {data.allTags.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary">
                    <input type="checkbox" name="tag" value={t.id} defaultChecked={tagSet.has(t.id)} className="accent-[var(--primary)]" />{t.name}
                  </label>
                ))}
              </fieldset>
              <SubmitButton size="sm" variant="secondary" className="mt-3">Salvar etiquetas</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Tarefas" />
            <ul className="divide-y divide-border">
              {data.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <form action={toggleTaskAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="done" value={t.status === "done" ? "0" : "1"} />
                    <button aria-label={t.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"} className={`h-4 w-4 rounded border ${t.status === "done" ? "border-success bg-success" : "border-border"}`} /></form>
                  <span className={t.status === "done" ? "text-muted line-through" : ""}>{t.title}</span>
                  {t.due_at && <span className="ml-auto text-xs text-muted">{dateTime(t.due_at)}</span>}
                </li>
              ))}
            </ul>
            <ActionForm action={createTaskAction} resetOnSuccess className="space-y-2 border-t border-border p-5">
              <input type="hidden" name="contactId" value={c.id} />
              <Input name="title" required placeholder="Ex.: Ligar para confirmar avaliação" aria-label="Nova tarefa" />
              <Input name="dueAt" type="datetime-local" aria-label="Prazo" />
              <SubmitButton size="sm" variant="secondary">Criar tarefa</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Consentimento de marketing" description="Exigido para iniciar conversas com templates de marketing." />
            <div className="space-y-3 p-5 text-sm">
              <p>Situação: {marketing ? <Badge tone={marketing.status === "granted" ? "success" : "danger"}>{marketing.status === "granted" ? "Autorizado" : "Revogado"}</Badge> : <Badge>Não registrado</Badge>}
                {marketing && <span className="ml-1 text-xs text-muted">em {dateTime(marketing.recorded_at)} ({marketing.source})</span>}</p>
              <ActionForm action={consentAction} resetOnSuccess className="space-y-2">
                <input type="hidden" name="contactId" value={c.id} />
                <Select name="status" aria-label="Novo status"><option value="granted">Registrar autorização</option><option value="revoked">Registrar revogação</option></Select>
                <Input name="evidence" required placeholder="Como foi obtido? Ex.: formulário no site em 10/03" aria-label="Evidência" />
                <SubmitButton size="sm" variant="secondary">Registrar</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
