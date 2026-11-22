import type { Db } from "@/lib/db";
import { parseWebhook, type InboundMessage, type StatusUpdate } from "@/modules/whatsapp/webhook";
import { isOptInMessage, isOptOutMessage, serviceWindowExpiry, shouldApplyStatus } from "@/modules/whatsapp/rules";

/**
 * Processa um evento de webhook já persistido (contexto de serviço). Idempotente: reprocessar o
 * mesmo evento não duplica contatos, conversas nem mensagens.
 */
export async function processWebhookEvent(db: Db, eventId: string) {
  const ev = await db.query<{ payload: unknown; processed_at: Date | null }>(
    "select payload, processed_at from webhook_events where id = $1 for update",
    [eventId],
  );
  if (!ev.rowCount || ev.rows[0].processed_at) return;
  for (const item of parseWebhook(ev.rows[0].payload)) {
    if (item.kind === "message") await handleInbound(db, item);
    else await handleStatus(db, item);
  }
  await db.query("update webhook_events set processed_at = now(), error = null where id = $1", [eventId]);
}

async function findChannel(db: Db, phoneNumberId: string) {
  const r = await db.query<{ id: string; organization_id: string }>(
    "select id, organization_id from channel_accounts where phone_number_id = $1 and status = 'active'",
    [phoneNumberId],
  );
  return r.rows[0] ?? null;
}

export async function handleInbound(db: Db, m: InboundMessage) {
  const channel = await findChannel(db, m.phoneNumberId);
  if (!channel) return; // número não conectado a nenhuma organização: ignorado (fica registrado no evento bruto)
  const orgId = channel.organization_id;

  const contact = await db.query<{ id: string; inserted: boolean }>(
    `insert into contacts (organization_id, display_name, wa_id, phone_e164, source)
     values ($1, $2, $3, $3, 'whatsapp')
     on conflict (organization_id, wa_id) where wa_id is not null and deleted_at is null
     do update set display_name = case when contacts.display_name = contacts.wa_id and excluded.display_name <> excluded.wa_id
                                       then excluded.display_name else contacts.display_name end
     returning id, (xmax = 0) as inserted`,
    [orgId, m.profileName?.trim() || m.waId, m.waId],
  );
  const contactId = contact.rows[0].id;

  if (contact.rows[0].inserted) {
    await db.query(
      `insert into consent_records (organization_id, contact_id, purpose, status, source, evidence)
       values ($1, $2, 'service', 'granted', 'inbound_message', $3)`,
      [orgId, contactId, `Primeira mensagem recebida (${m.providerMessageId})`],
    );
    await createLeadDeal(db, orgId, contactId);
  }

  const conv = await db.query<{ id: string }>(
    `insert into conversations (organization_id, contact_id, channel_account_id)
     values ($1, $2, $3)
     on conflict (organization_id, contact_id, coalesce(channel_account_id, '00000000-0000-0000-0000-000000000000'::uuid))
     do update set status = 'open'
     returning id`,
    [orgId, contactId, channel.id],
  );
  const conversationId = conv.rows[0].id;

  const ins = await db.query(
    `insert into messages (organization_id, conversation_id, direction, sender_type, type, body, payload, provider_message_id, status, sent_at)
     values ($1, $2, 'inbound', 'contact', $3, $4, $5, $6, 'received', $7)
     on conflict (provider_message_id) do nothing`,
    [orgId, conversationId, m.type, m.text, JSON.stringify(m.raw), m.providerMessageId, m.timestamp],
  );
  if (!ins.rowCount) return; // duplicata

  await db.query(
    `update conversations set
       last_message_at = greatest(coalesce(last_message_at, $2), $2),
       service_window_expires_at = greatest(coalesce(service_window_expires_at, $3), $3),
       unread_count = unread_count + 1
     where id = $1`,
    [conversationId, m.timestamp, serviceWindowExpiry(m.timestamp)],
  );
  await db.query(
    "update contacts set last_inbound_at = greatest(coalesce(last_inbound_at, $2), $2), updated_at = now() where id = $1",
    [contactId, m.timestamp],
  );
  await db.query(
    "update deals set last_activity_at = greatest(last_activity_at, $2) where contact_id = $1 and status = 'open'",
    [contactId, m.timestamp],
  );

  if (isOptOutMessage(m.text) || isOptInMessage(m.text)) {
    const status = isOptOutMessage(m.text) ? "revoked" : "granted";
    await db.query(
      `insert into consent_records (organization_id, contact_id, purpose, status, source, evidence)
       values ($1, $2, 'marketing', $3, 'inbound_keyword', $4)`,
      [orgId, contactId, status, `Mensagem "${m.text}" (${m.providerMessageId})`],
    );
  }
}

/** Automação padrão "novo lead": cria um negócio na primeira etapa do funil padrão. */
async function createLeadDeal(db: Db, orgId: string, contactId: string) {
  const st = await db.query<{ pipeline_id: string; id: string }>(
    `select s.pipeline_id, s.id from pipeline_stages s join pipelines p on p.id = s.pipeline_id
     where p.organization_id = $1 and p.is_default and s.kind = 'open' order by s.position limit 1`,
    [orgId],
  );
  if (!st.rowCount) return;
  await db.query(
    `insert into deals (organization_id, contact_id, pipeline_id, stage_id, title)
     values ($1, $2, $3, $4, 'Novo contato pelo WhatsApp')`,
    [orgId, contactId, st.rows[0].pipeline_id, st.rows[0].id],
  );
}

export async function handleStatus(db: Db, s: StatusUpdate) {
  const msg = await db.query<{ id: string; status: string }>(
    "select id, status from messages where provider_message_id = $1 for update",
    [s.providerMessageId],
  );
  if (!msg.rowCount) return;
  if (!shouldApplyStatus(msg.rows[0].status, s.status)) return;
  await db.query("update messages set status = $2, error = coalesce($3, error) where id = $1", [
    msg.rows[0].id, s.status, s.error,
  ]);
}
