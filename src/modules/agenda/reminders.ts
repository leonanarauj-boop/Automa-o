import type { Db } from "@/lib/db";
import { enqueue } from "@/modules/jobs/queue";
import { randomToken } from "@/lib/crypto";
import { renderTemplate } from "@/modules/whatsapp/rules";
import { audit } from "@/modules/audit/audit";

/**
 * Variáveis do template de lembrete, por posição:
 * {{1}} primeiro nome · {{2}} data (dd/mm) · {{3}} horário (HH:MM) · {{4}} profissional · {{5}} serviço
 */
export const REMINDER_VARIABLES = ["primeiro nome do cliente", "data (dd/mm)", "horário (HH:MM)", "profissional", "serviço"];

export function reminderParams(a: { contact_name: string; starts_at: Date; professional: string; service: string | null; timezone: string }, count: number): string[] | null {
  if (count > REMINDER_VARIABLES.length) return null;
  const opts = { timeZone: a.timezone };
  const all = [
    a.contact_name.replace(/\s*\(DEMO\)\s*/g, "").trim().split(/\s+/)[0] || a.contact_name,
    a.starts_at.toLocaleDateString("pt-BR", { ...opts, day: "2-digit", month: "2-digit" }),
    a.starts_at.toLocaleTimeString("pt-BR", { ...opts, hour: "2-digit", minute: "2-digit" }),
    a.professional,
    a.service ?? "atendimento",
  ];
  return all.slice(0, count);
}

/**
 * Enfileira lembretes de agendamentos que entram na janela configurada (contexto de serviço / worker).
 * Usa somente o template aprovado escolhido pela organização. Cada agendamento recebe no máximo um lembrete.
 */
export async function sendDueReminders(db: Db) {
  const due = await db.query<{
    id: string; organization_id: string; contact_id: string; contact_name: string; wa_id: string | null; starts_at: Date; professional: string;
    service: string | null; timezone: string; template_id: string; template_status: string; body_text: string | null; body_param_count: number; channel_account_id: string; channel_status: string;
  }>(
    `select a.id, a.organization_id, a.contact_id, c.display_name as contact_name, c.wa_id, a.starts_at, p.name as professional, s.name as service,
            o.timezone, t.id as template_id, t.status as template_status, t.body_text, t.body_param_count, t.channel_account_id, ch.status as channel_status
     from appointments a
     join organizations o on o.id = a.organization_id and o.status in ('trial','active')
     join message_templates t on t.id = o.reminder_template_id
     join channel_accounts ch on ch.id = t.channel_account_id
     join contacts c on c.id = a.contact_id
     join professionals p on p.id = a.professional_id
     left join products_services s on s.id = a.service_id
     where a.status in ('scheduled','confirmed') and a.reminder_sent_at is null and a.reminder_error is null and not a.is_demo
       and a.starts_at > now() and a.starts_at <= now() + make_interval(hours => o.reminder_hours_before)
     order by a.starts_at limit 200
     for update of a skip locked`);
  let sent = 0;
  for (const a of due.rows) {
    const fail = (msg: string) => db.query("update appointments set reminder_error = $2 where id = $1", [a.id, msg]);
    if (!a.wa_id) { await fail("Cliente sem WhatsApp"); continue; }
    if (a.channel_status !== "active") { await fail("Número de WhatsApp desconectado"); continue; }
    if (a.template_status !== "APPROVED") { await fail("Template de lembrete não está aprovado"); continue; }
    const optOut = await db.query<{ status: string }>(
      "select status from consent_records where contact_id = $1 and purpose = 'marketing' order by recorded_at desc limit 1", [a.contact_id]);
    if (optOut.rows[0]?.status === "revoked") { await fail("Cliente pediu para não receber mensagens"); continue; }
    const params = reminderParams(a, a.body_param_count);
    if (!params) { await fail("Template com mais variáveis do que o suportado (máx. 5)"); continue; }
    const conv = await db.query<{ id: string }>(
      `insert into conversations (organization_id, contact_id, channel_account_id) values ($1,$2,$3)
       on conflict (organization_id, contact_id, coalesce(channel_account_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set status = conversations.status
       returning id`, [a.organization_id, a.contact_id, a.channel_account_id]);
    const msg = await db.query<{ id: string }>(
      `insert into messages (organization_id, conversation_id, direction, sender_type, type, body, template_id, payload, status, idempotency_key)
       values ($1,$2,'outbound','system','template',$3,$4,$5,'pending',$6) returning id`,
      [a.organization_id, conv.rows[0].id, a.body_text ? renderTemplate(a.body_text, params) : "[lembrete de agendamento]", a.template_id,
       JSON.stringify({ params }), `reminder:${a.id}`]);
    await enqueue(db, "whatsapp.send", { messageId: msg.rows[0].id, orgId: a.organization_id });
    await db.query("update appointments set reminder_sent_at = now(), reminder_message_id = $2 where id = $1", [a.id, msg.rows[0].id]);
    await audit(db, { orgId: a.organization_id, actorType: "system", action: "appointment.reminder_queued", targetType: "appointment", targetId: a.id });
    sent++;
  }
  return sent;
}

const CONFIRM = new Set(["sim", "confirmo", "confirmar", "confirmado", "confirmada", "sim confirmo", "pode confirmar", "confirmo sim", "estarei la", "vou sim", "ok confirmado"]);

export function isConfirmationMessage(text: string | null): boolean {
  if (!text) return false;
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[!.,👍🏻👍]/gu, "").trim();
  return CONFIRM.has(t);
}

/**
 * Cliente respondeu "sim/confirmo" depois de receber o lembrete: confirma o próximo agendamento.
 * Cancelamentos NÃO são automáticos (exigem atendimento humano).
 */
export async function confirmFromReply(db: Db, orgId: string, contactId: string, text: string | null) {
  if (!isConfirmationMessage(text)) return null;
  const r = await db.query<{ id: string }>(
    `update appointments set status = 'confirmed', confirmed_at = now(), confirmed_via = 'whatsapp', updated_at = now()
     where id = (select id from appointments where organization_id = $1 and contact_id = $2 and status = 'scheduled'
                 and reminder_sent_at > now() - interval '48 hours' and starts_at > now() order by starts_at limit 1)
     returning id`, [orgId, contactId]);
  if (r.rowCount) await audit(db, { orgId, actorType: "system", action: "appointment.confirmed_by_reply", targetType: "appointment", targetId: r.rows[0].id });
  return r.rows[0]?.id ?? null;
}
