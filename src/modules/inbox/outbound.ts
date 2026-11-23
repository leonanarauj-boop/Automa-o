import { z } from "zod";
import type { Db } from "@/lib/db";
import { randomToken, decryptSecret } from "@/lib/crypto";
import { isWindowOpen, renderTemplate } from "@/modules/whatsapp/rules";
import { channelProvider } from "@/modules/whatsapp/meta-cloud";
import { ProviderError } from "@/modules/whatsapp/provider";
import { audit } from "@/modules/audit/audit";
import { BillingError, assertCanOperate } from "@/modules/billing/service";

export class SendBlockedError extends Error {}

export const textSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Mensagem vazia").max(4096, "Máximo de 4096 caracteres"),
});

async function loadConversation(db: Db, conversationId: string) {
  const r = await db.query<{
    id: string; organization_id: string; contact_id: string; channel_account_id: string | null;
    service_window_expires_at: Date | null; wa_id: string | null;
  }>(
    `select c.id, c.organization_id, c.contact_id, c.channel_account_id, c.service_window_expires_at, ct.wa_id
     from conversations c join contacts ct on ct.id = c.contact_id where c.id = $1`,
    [conversationId],
  );
  if (!r.rowCount) throw new SendBlockedError("Conversa não encontrada.");
  return r.rows[0];
}

async function canSend(db: Db, orgId: string) {
  try { await assertCanOperate(db, orgId); } catch (e) { if (e instanceof BillingError) throw new SendBlockedError(e.message); throw e; }
}

export async function marketingOptedOut(db: Db, contactId: string): Promise<boolean> {
  const r = await db.query<{ status: string }>(
    `select status from consent_records where contact_id = $1 and purpose = 'marketing'
     order by recorded_at desc limit 1`,
    [contactId],
  );
  return r.rows[0]?.status === "revoked";
}

/**
 * Enfileira uma resposta em texto livre (contexto do tenant, com RLS).
 * Regra da Meta: texto livre só dentro da janela de 24h após a última mensagem do cliente.
 */
export async function queueText(db: Db, userId: string, input: z.infer<typeof textSchema>) {
  const data = textSchema.parse(input);
  const conv = await loadConversation(db, data.conversationId);
  await canSend(db, conv.organization_id);
  if (!conv.channel_account_id || !conv.wa_id) throw new SendBlockedError("Esta conversa não está ligada a um número de WhatsApp conectado.");
  if (!isWindowOpen(conv.service_window_expires_at)) {
    throw new SendBlockedError("A janela de 24h está fechada. Para retomar o contato, envie um template aprovado.");
  }
  return insertAndEnqueue(db, conv, userId, { type: "text", body: data.body });
}

export const templateSchema = z.object({
  conversationId: z.string().uuid(),
  templateId: z.string().uuid(),
  params: z.array(z.string().trim().min(1, "Preencha todas as variáveis").max(1000)).max(20),
});

/** Enfileira um template aprovado (permitido fora da janela), respeitando o descadastramento. */
export async function queueTemplate(db: Db, userId: string, input: z.infer<typeof templateSchema>) {
  const data = templateSchema.parse(input);
  const conv = await loadConversation(db, data.conversationId);
  await canSend(db, conv.organization_id);
  if (!conv.channel_account_id || !conv.wa_id) throw new SendBlockedError("Esta conversa não está ligada a um número de WhatsApp conectado.");
  if (await marketingOptedOut(db, conv.contact_id)) {
    throw new SendBlockedError("O contato pediu para não receber mensagens. Envio de templates bloqueado.");
  }
  const t = await db.query<{ id: string; name: string; status: string; body_text: string | null; body_param_count: number }>(
    "select id, name, status, body_text, body_param_count from message_templates where id = $1 and channel_account_id = $2",
    [data.templateId, conv.channel_account_id],
  );
  const tpl = t.rows[0];
  if (!tpl) throw new SendBlockedError("Template não encontrado para este número.");
  if (tpl.status !== "APPROVED") throw new SendBlockedError("Somente templates aprovados pela Meta podem ser enviados.");
  if (data.params.length !== tpl.body_param_count) throw new SendBlockedError(`Este template exige ${tpl.body_param_count} variável(is).`);
  return insertAndEnqueue(db, conv, userId, {
    type: "template",
    body: tpl.body_text ? renderTemplate(tpl.body_text, data.params) : `[template ${tpl.name}]`,
    templateId: tpl.id,
    params: data.params,
  });
}

async function insertAndEnqueue(
  db: Db,
  conv: { id: string; organization_id: string },
  userId: string,
  msg: { type: "text" | "template"; body: string; templateId?: string; params?: string[] },
) {
  const r = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, sender_type, sender_user_id, type, body, template_id, payload, status, idempotency_key)
     values ($1, $2, 'outbound', 'user', $3, $4, $5, $6, $7, 'pending', $8) returning id`,
    [conv.organization_id, conv.id, userId, msg.type, msg.body, msg.templateId ?? null,
     msg.params ? JSON.stringify({ params: msg.params }) : null, randomToken(16)],
  );
  const messageId = r.rows[0].id;
  await db.query("select app_enqueue_message_send($1)", [messageId]);
  await db.query("update conversations set last_message_at = now(), unread_count = 0 where id = $1", [conv.id]);
  await audit(db, { orgId: conv.organization_id, actorType: "user", actorId: userId, action: `message.queued.${msg.type}`, targetType: "message", targetId: messageId });
  return messageId;
}

/**
 * Executa o envio (worker, contexto de serviço). Retorna normalmente em sucesso ou falha definitiva;
 * lança ProviderError retryable para nova tentativa.
 */
export async function performSend(db: Db, messageId: string, orgId: string, opts: { lastAttempt: boolean }) {
  const r = await db.query<{
    status: string; type: string; body: string | null; payload: { params?: string[] } | null;
    wa_id: string; contact_id: string; phone_number_id: string; waba_id: string; access_token_encrypted: string;
    template_name: string | null; template_language: string | null;
  }>(
    `select m.status, m.type, m.body, m.payload, ct.wa_id, ct.id as contact_id, ch.phone_number_id, ch.waba_id, ch.access_token_encrypted,
            t.name as template_name, t.language as template_language
     from messages m
     join conversations c on c.id = m.conversation_id
     join contacts ct on ct.id = c.contact_id
     join channel_accounts ch on ch.id = c.channel_account_id
     left join message_templates t on t.id = m.template_id
     where m.id = $1 and m.organization_id = $2 for update of m`,
    [messageId, orgId],
  );
  const m = r.rows[0];
  if (!m || m.status !== "pending") return;
  const creds = { phoneNumberId: m.phone_number_id, wabaId: m.waba_id, accessToken: decryptSecret(m.access_token_encrypted) };
  try {
    const res = m.type === "template"
      ? await channelProvider().sendTemplate(creds, m.wa_id, m.template_name!, m.template_language!, m.payload?.params ?? [])
      : await channelProvider().sendText(creds, m.wa_id, m.body ?? "");
    await db.query("update messages set status = 'sent', provider_message_id = $2, error = null where id = $1", [messageId, res.providerMessageId]);
    await db.query("update contacts set last_outbound_at = now() where id = $1", [m.contact_id]);
    await db.query("update deals set last_activity_at = now() where contact_id = $1 and status = 'open'", [m.contact_id]);
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError((e as Error).message, false);
    if (err.retryable && !opts.lastAttempt) throw err;
    await db.query("update messages set status = 'failed', error = $2 where id = $1", [messageId, err.message.slice(0, 500)]);
  }
}
