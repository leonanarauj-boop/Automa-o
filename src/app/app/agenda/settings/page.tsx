import Link from "next/link";
import { tenant } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { REMINDER_VARIABLES } from "@/modules/agenda/reminders";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Select, buttonClass } from "@/components/ui";
import { addExceptionAction, createProfessionalAction, deleteExceptionAction, saveHoursAction, saveReminderAction, toggleProfessionalAction } from "../actions";

export const metadata = { title: "Configurar agenda" };
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const hhmm = (t: string) => t.slice(0, 5);

export default async function AgendaSettings() {
  const d = await tenant(async (db, s) => ({
    role: s.role,
    pros: (await db.query<{ id: string; name: string; active: boolean }>("select id, name, active from professionals order by created_at")).rows,
    rules: (await db.query<{ professional_id: string; weekday: number; start_time: string; end_time: string }>("select professional_id, weekday, start_time::text, end_time::text from availability_rules order by weekday, start_time")).rows,
    exceptions: (await db.query<{ id: string; professional: string; starts_at: Date; ends_at: Date; reason: string | null }>(
      "select x.id, p.name as professional, x.starts_at, x.ends_at, x.reason from availability_exceptions x join professionals p on p.id = x.professional_id where x.ends_at > now() order by x.starts_at")).rows,
    org: (await db.query<{ reminder_hours_before: number; reminder_template_id: string | null }>("select reminder_hours_before, reminder_template_id from organizations limit 1")).rows[0],
    templates: (await db.query<{ id: string; name: string; language: string; body_text: string | null; body_param_count: number }>(
      "select id, name, language, body_text, body_param_count from message_templates where status = 'APPROVED' order by name")).rows,
  }));
  const manager = d.role !== "agent";
  const active = d.pros.filter((p) => p.active);

  return (
    <>
      <PageHeader title="Configurar agenda" description={<Link href="/app/agenda" className="hover:underline">← Voltar para a agenda</Link>} />
      {!manager && <div className="mb-6"><Notice>Somente gestores e o dono da conta podem alterar a configuração da agenda.</Notice></div>}
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profissionais" description="Quem atende. Cada profissional tem seu próprio horário e não recebe dois agendamentos no mesmo horário." />
          <ul className="divide-y divide-border text-sm">
            {d.pros.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-3">
                <span className={p.active ? "" : "text-muted line-through"}>{p.name}</span>
                {manager && <form action={toggleProfessionalAction}><input type="hidden" name="id" value={p.id} /><button className="text-xs text-muted hover:text-text">{p.active ? "Desativar" : "Reativar"}</button></form>}
              </li>
            ))}
          </ul>
          {manager && (
            <ActionForm action={createProfessionalAction} resetOnSuccess className="flex flex-col gap-2 border-t border-border p-5 sm:flex-row">
              <Input name="name" required placeholder="Nome do profissional (ex.: Dra. Paula)" aria-label="Nome do profissional" />
              <SubmitButton>Adicionar</SubmitButton>
            </ActionForm>
          )}
        </Card>

        {active.map((p) => {
          const mine = d.rules.filter((r) => r.professional_id === p.id);
          return (
            <Card key={p.id}>
              <CardHeader title={`Horário de ${p.name}`} description="Até dois intervalos por dia (ex.: manhã e tarde). Deixe em branco os dias de folga." />
              <ActionForm action={saveHoursAction} className="space-y-2 p-5">
                <input type="hidden" name="professionalId" value={p.id} />
                {DAYS.map((label, wd) => {
                  const day = mine.filter((r) => r.weekday === wd);
                  return (
                    <div key={wd} className="grid grid-cols-[6rem_1fr] items-center gap-2 text-sm sm:grid-cols-[7rem_repeat(2,minmax(0,14rem))]">
                      <span className="font-medium">{label}</span>
                      {(["a", "b"] as const).map((part, i) => (
                        <span key={part} className="col-start-2 flex items-center gap-1 sm:col-start-auto">
                          <Input type="time" name={`s${wd}${part}`} defaultValue={day[i] ? hhmm(day[i].start_time) : ""} disabled={!manager} aria-label={`${label}, início ${i + 1}`} className="h-9" />
                          <span className="text-muted">–</span>
                          <Input type="time" name={`e${wd}${part}`} defaultValue={day[i] ? hhmm(day[i].end_time) : ""} disabled={!manager} aria-label={`${label}, fim ${i + 1}`} className="h-9" />
                        </span>
                      ))}
                    </div>
                  );
                })}
                {manager && <SubmitButton size="sm">Salvar horários</SubmitButton>}
              </ActionForm>
            </Card>
          );
        })}

        {active.length > 0 && (
          <Card>
            <CardHeader title="Bloqueios" description="Férias, cursos, compromissos. Horários bloqueados não aparecem para agendamento." />
            {d.exceptions.length > 0 && (
              <ul className="divide-y divide-border text-sm">
                {d.exceptions.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span>{x.professional} · {dateTime(x.starts_at)} até {dateTime(x.ends_at)}{x.reason ? <span className="text-muted"> · {x.reason}</span> : null}</span>
                    {manager && <form action={deleteExceptionAction}><input type="hidden" name="id" value={x.id} /><button className="text-xs text-danger hover:underline">Remover</button></form>}
                  </li>
                ))}
              </ul>
            )}
            {manager && (
              <ActionForm action={addExceptionAction} resetOnSuccess className="grid gap-3 border-t border-border p-5 sm:grid-cols-[1fr_10rem_7rem_7rem]">
                <Field label="Profissional" htmlFor="xp"><Select id="xp" name="professionalId">{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                <Field label="Data" htmlFor="xd"><Input id="xd" name="date" type="date" required /></Field>
                <Field label="Das" htmlFor="xs"><Input id="xs" name="start" type="time" required /></Field>
                <Field label="Até" htmlFor="xe"><Input id="xe" name="end" type="time" required /></Field>
                <div className="sm:col-span-4"><Field label="Motivo (opcional)" htmlFor="xr"><Input id="xr" name="reason" /></Field></div>
                <div className="sm:col-span-4"><SubmitButton size="sm">Bloquear período</SubmitButton></div>
              </ActionForm>
            )}
          </Card>
        )}

        <Card id="lembretes">
          <CardHeader title="Lembrete automático pelo WhatsApp" description="Enviado uma vez por agendamento, com um template aprovado pela Meta. Se o cliente responder “sim” ou “confirmo”, o agendamento é confirmado automaticamente." />
          <div className="space-y-4 p-5 text-sm">
            <p>Situação: {d.org.reminder_template_id ? <Badge tone="success">Ativo</Badge> : <Badge>Desativado</Badge>}</p>
            {d.templates.length === 0 ? (
              <Notice>Nenhum template aprovado sincronizado. Crie um template de categoria Utilidade no Gerenciador do WhatsApp (ex.: “Olá {"{{1}}"}, lembrando do seu horário em {"{{2}}"} às {"{{3}}"} com {"{{4}}"}. Responda SIM para confirmar.”) e sincronize em <Link href="/app/settings#whatsapp" className="font-medium underline">Configurações</Link>.</Notice>
            ) : (
              <ActionForm action={saveReminderAction} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                <Field label="Template" htmlFor="rt">
                  <Select id="rt" name="templateId" defaultValue={d.org.reminder_template_id ?? ""} disabled={!manager}>
                    <option value="">Não enviar lembretes</option>
                    {d.templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language}) · {t.body_param_count} variável(is)</option>)}
                  </Select>
                </Field>
                <Field label="Antecedência (horas)" htmlFor="rh"><Input id="rh" name="hours" type="number" min={1} max={168} defaultValue={d.org.reminder_hours_before} disabled={!manager} /></Field>
                {manager && <SubmitButton>Salvar</SubmitButton>}
              </ActionForm>
            )}
            <p className="text-xs text-muted">Variáveis preenchidas automaticamente, na ordem: {REMINDER_VARIABLES.map((v, i) => `{{${i + 1}}} ${v}`).join(" · ")}. Lembretes são cobrados pela Meta conforme a categoria do template e não são enviados a quem pediu para sair.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
