import { z } from "zod";

/**
 * Normalização do payload de webhooks da WhatsApp Cloud API (campo "messages").
 * Formato: { object: "whatsapp_business_account", entry: [{ id, changes: [{ field, value }] }] }
 */
const messageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), caption: z.string().optional(), mime_type: z.string().optional() }).optional(),
  document: z.object({ id: z.string(), caption: z.string().optional(), filename: z.string().optional() }).optional(),
  audio: z.object({ id: z.string() }).optional(),
  video: z.object({ id: z.string(), caption: z.string().optional() }).optional(),
  button: z.object({ text: z.string() }).optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
}).passthrough();

const statusSchema = z.object({
  id: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]).or(z.string()),
  timestamp: z.string(),
  recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() })).optional(),
}).passthrough();

const valueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: z.object({ phone_number_id: z.string(), display_phone_number: z.string().optional() }),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(statusSchema).optional(),
}).passthrough();

const payloadSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ id: z.string(), changes: z.array(z.object({ field: z.string(), value: z.unknown() })) })),
});

export interface InboundMessage {
  kind: "message";
  phoneNumberId: string;
  waId: string;
  profileName: string | null;
  providerMessageId: string;
  timestamp: Date;
  type: string;
  text: string | null;
  raw: unknown;
}

export interface StatusUpdate {
  kind: "status";
  phoneNumberId: string;
  providerMessageId: string;
  status: string;
  timestamp: Date;
  error: string | null;
}

export type WebhookItem = InboundMessage | StatusUpdate;

/** Texto legível para cada tipo de mensagem recebida. */
export function messageText(m: z.infer<typeof messageSchema>): string | null {
  switch (m.type) {
    case "text": return m.text?.body ?? null;
    case "button": return m.button?.text ?? null;
    case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case "image": return m.image?.caption ?? "[imagem]";
    case "document": return m.document?.caption ?? `[documento${m.document?.filename ? `: ${m.document.filename}` : ""}]`;
    case "audio": return "[áudio]";
    case "video": return m.video?.caption ?? "[vídeo]";
    default: return `[${m.type}]`;
  }
}

export function parseWebhook(body: unknown): WebhookItem[] {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return [];
  const items: WebhookItem[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const v = valueSchema.safeParse(change.value);
      if (!v.success) continue;
      const phoneNumberId = v.data.metadata.phone_number_id;
      const names = new Map((v.data.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const m of v.data.messages ?? []) {
        items.push({
          kind: "message",
          phoneNumberId,
          waId: m.from,
          profileName: names.get(m.from) ?? null,
          providerMessageId: m.id,
          timestamp: new Date(Number(m.timestamp) * 1000),
          type: m.type,
          text: messageText(m),
          raw: m,
        });
      }
      for (const s of v.data.statuses ?? []) {
        const err = s.errors?.[0];
        items.push({
          kind: "status",
          phoneNumberId,
          providerMessageId: s.id,
          status: s.status,
          timestamp: new Date(Number(s.timestamp) * 1000),
          error: err ? [err.code, err.title ?? err.message].filter(Boolean).join(" - ") : null,
        });
      }
    }
  }
  return items;
}
