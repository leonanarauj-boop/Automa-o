import { z } from "zod";
import type { Db } from "@/lib/db";
import { renderTemplate } from "@/modules/whatsapp/rules";

/**
 * Envio de templates iniciado pela empresa (campanhas e automações), com as regras de
 * consentimento, limite diário e qualidade aplicadas em um único lugar.
 */
export const paramSourceSchema = z.object({
  source: z.enum(["first_name", "full_name", "fixed"]),
  value: z.string().max(500).optional(),
});
export type ParamSource = z.infer<typeof paramSourceSchema>;

export function firstName(name: string) {
  return name.replace(/\s*\(DEMO\)\s*/g, "").trim().split(/\s+/)[0] || name;
}

export function renderParams(mapping: ParamSource[], contact: { display_name: string }): string[] {
  return mapping.map((m) => {
    if (m.source === "first_name") return firstName(contact.display_name);
    if (m.source === "full_name") return contact.display_name.replace(/\s*\(DEMO\)\s*/g, "").trim();
    return (m.value ?? "").trim();
  });
}

export interface TemplateInfo {
  id: string; name: string; channel_account_id: string; category: string; status: string; body_text: string | null; body_param_count: number;
}

export async function loadTemplate(db: Db, templateId: string): Promise<TemplateInfo | null> {
  const r = await db.query<TemplateInfo>(
    "select id, name, channel_account_id, category, status, body_text, body_param_count from message_templates where id = $1", [templateId]);
  return r.rows[0] ?? null;
}

/** Conversas iniciadas por template para contatos distintos nas últimas 24h (base do limite da Meta). */
export async function dailyCapacity(db: Db, orgId: string) {
  const r = await db.query<{ limit: number; used: string }>(
    `select o.daily_template_limit as limit,
       (select count(distinct cv.contact_id) from messages m join conversations cv on cv.id = m.conversation_id
        where m.organization_id = $1 and m.direction = 'outbound' and m.type = 'template' and m.status <> 'failed'
          and m.created_at > now() - interval '24 hours') as used
     from organizations o where o.id = $1`, [orgId]);
  const limit = r.rows[0].limit;
  const used = Number(r.rows[0].used);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

export type BlockReason = "no_whatsapp" | "opted_out" | "no_marketing_consent" | "channel_inactive" | "template_not_approved" | "param_mismatch";
export const BLOCK_LABEL: Record<BlockReason | "frequency" | "daily_limit" | "demo" | "max_recipients", string> = {
  no_whatsapp: "sem WhatsApp",
  opted_out: "pediu para não receber",
  no_marketing_consent: "sem consentimento de marketing registrado",
  channel_inactive: "número desconectado",
  template_not_approved: "template não aprovado",
  param_mismatch: "variáveis do template incompletas",
  frequency: "recebeu campanha recentemente",
  daily_limit: "limite diário de envios atingido",
  demo: "contato de demonstração",
  max_recipients: "acima do máximo de destinatários da campanha",
};

/**
 * Regras: quem pediu para sair nunca recebe; template de MARKETING exige consentimento de marketing
 * registrado; UTILITY/AUTHENTICATION exigem apenas que o cliente não tenha pedido para sair.
 */
export async function checkContact(db: Db, contactId: string, tpl: TemplateInfo, opts: { requireMarketingConsent?: boolean } = {}): Promise<BlockReason | null> {
  const r = await db.query<{ wa_id: string | null; consent: string | null; channel_status: string | null }>(
    `select c.wa_id,
       (select status from consent_records cr where cr.contact_id = c.id and cr.purpose = 'marketing' order by recorded_at desc limit 1) as consent,
       (select status from channel_accounts where id = $2) as channel_status
     from contacts c where c.id = $1 and c.deleted_at is null`, [contactId, tpl.channel_account_id]);
  const c = r.rows[0];
  if (!c || !c.wa_id) return "no_whatsapp";
  if (c.channel_status !== "active") return "channel_inactive";
  if (tpl.status !== "APPROVED") return "template_not_approved";
  if (c.consent === "revoked") return "opted_out";
  if ((opts.requireMarketingConsent || tpl.category === "MARKETING") && c.consent !== "granted") return "no_marketing_consent";
  return null;
}

/** Cria (ou reutiliza) a conversa, registra a mensagem pendente e enfileira o envio. Idempotente pela chave. */
export async function queueTemplateMessage(db: Db, orgId: string, contact: { id: string; display_name: string }, tpl: TemplateInfo,
  mapping: ParamSource[], opts: { idempotencyKey: string; runAt?: Date; senderUserId?: string | null }) {
  const params = renderParams(mapping, contact);
  if (params.length !== tpl.body_param_count || params.some((p) => !p)) throw new TemplateSendError("param_mismatch");
  const conv = await db.query<{ id: string }>(
    `insert into conversations (organization_id, contact_id, channel_account_id) values ($1,$2,$3)
     on conflict (organization_id, contact_id, coalesce(channel_account_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set status = conversations.status
     returning id`, [orgId, contact.id, tpl.channel_account_id]);
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, sender_type, sender_user_id, type, body, template_id, payload, status, idempotency_key, sent_at)
     values ($1,$2,'outbound',$3,$4,'template',$5,$6,$7,'pending',$8, coalesce($9, now()))
     on conflict (organization_id, idempotency_key) do nothing returning id`,
    [orgId, conv.rows[0].id, opts.senderUserId ? "user" : "system", opts.senderUserId ?? null,
     tpl.body_text ? renderTemplate(tpl.body_text, params) : `[template ${tpl.name}]`, tpl.id, JSON.stringify({ params }), opts.idempotencyKey, opts.runAt ?? null]);
  if (!msg.rowCount) return null; // já enfileirada antes
  await db.query("select app_enqueue_message_send($1, $2)", [msg.rows[0].id, opts.runAt ?? null]);
  return msg.rows[0].id;
}

export class TemplateSendError extends Error {
  constructor(readonly reason: BlockReason) { super(BLOCK_LABEL[reason]); }
}
