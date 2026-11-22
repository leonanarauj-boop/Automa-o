import { z } from "zod";
import { withService, type Db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { audit } from "@/modules/audit/audit";
import { channelProvider } from "./meta-cloud";
import { ProviderError } from "./provider";
import { countTemplateParams } from "./rules";

export const connectSchema = z.object({
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "ID da conta (WABA) deve conter apenas números"),
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "ID do número deve conter apenas números"),
  accessToken: z.string().trim().min(20, "Token de acesso inválido").max(1000),
});

export class ChannelError extends Error {}

/**
 * Conexão manual de um número da Cloud API (ID da WABA, ID do número e token de sistema).
 * Valida as credenciais chamando a Meta antes de salvar. O token é guardado criptografado.
 * O Embedded Signup substituirá este formulário quando o app da Meta for aprovado como Tech Provider.
 */
export async function connectChannel(orgId: string, userId: string, input: z.input<typeof connectSchema>) {
  const d = connectSchema.parse(input);
  let displayPhone: string;
  try {
    displayPhone = (await channelProvider().getPhoneNumber({ wabaId: d.wabaId, phoneNumberId: d.phoneNumberId, accessToken: d.accessToken })).displayPhone;
  } catch (e) {
    throw new ChannelError(`A Meta recusou as credenciais: ${(e as Error).message}`);
  }
  return withService(async (db) => {
    const existing = await db.query<{ organization_id: string }>("select organization_id from channel_accounts where phone_number_id = $1", [d.phoneNumberId]);
    if (existing.rowCount && existing.rows[0].organization_id !== orgId) throw new ChannelError("Este número já está conectado a outra conta.");
    await db.query(
      `insert into channel_accounts (organization_id, waba_id, phone_number_id, display_phone, access_token_encrypted, status)
       values ($1,$2,$3,$4,$5,'active')
       on conflict (phone_number_id) do update set waba_id = excluded.waba_id, display_phone = excluded.display_phone,
         access_token_encrypted = excluded.access_token_encrypted, status = 'active', updated_at = now()`,
      [orgId, d.wabaId, d.phoneNumberId, displayPhone, encryptSecret(d.accessToken)],
    );
    await audit(db, { orgId, actorType: "user", actorId: userId, action: "channel.connected", metadata: { phoneNumberId: d.phoneNumberId } });
    return displayPhone;
  });
}

export async function disconnectChannel(orgId: string, userId: string, channelId: string) {
  await withService(async (db) => {
    await db.query("update channel_accounts set status = 'disconnected', updated_at = now() where id = $1 and organization_id = $2", [channelId, orgId]);
    await audit(db, { orgId, actorType: "user", actorId: userId, action: "channel.disconnected", targetType: "channel", targetId: channelId });
  });
}

/** Sincroniza templates da WABA com a Meta (contexto de serviço, sempre filtrado pela org). */
export async function syncTemplates(orgId: string, channelId: string) {
  const ch = await withService((db) =>
    db.query<{ id: string; waba_id: string; phone_number_id: string; access_token_encrypted: string }>(
      "select id, waba_id, phone_number_id, access_token_encrypted from channel_accounts where id = $1 and organization_id = $2 and status = 'active'",
      [channelId, orgId],
    ),
  );
  const c = ch.rows[0];
  if (!c) throw new ChannelError("Número não encontrado.");
  let list;
  try {
    list = await channelProvider().listTemplates({ wabaId: c.waba_id, phoneNumberId: c.phone_number_id, accessToken: decryptSecret(c.access_token_encrypted) });
  } catch (e) {
    throw new ChannelError(e instanceof ProviderError ? `Erro da Meta: ${e.message}` : (e as Error).message);
  }
  await withService(async (db: Db) => {
    for (const t of list) {
      await db.query(
        `insert into message_templates (organization_id, channel_account_id, provider_template_id, name, language, category, status, body_text, body_param_count, synced_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         on conflict (channel_account_id, name, language) do update set provider_template_id = excluded.provider_template_id,
           category = excluded.category, status = excluded.status, body_text = excluded.body_text,
           body_param_count = excluded.body_param_count, synced_at = now()`,
        [orgId, c.id, t.id, t.name, t.language, t.category, t.status, t.bodyText, countTemplateParams(t.bodyText)],
      );
    }
  });
  return list.length;
}
