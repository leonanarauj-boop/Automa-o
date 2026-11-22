import { env } from "@/lib/env";
import { ProviderError, type ChannelCredentials, type ChannelProvider, type RemoteTemplate } from "./provider";

/**
 * Adaptador da WhatsApp Business Platform — Cloud API (Graph API da Meta).
 * Endpoints usados (documentação oficial):
 *   POST /{phone-number-id}/messages           envio de mensagens
 *   GET  /{waba-id}/message_templates          lista de templates
 *   GET  /{phone-number-id}                    dados do número
 */
type FetchLike = typeof fetch;

export class MetaCloudProvider implements ChannelProvider {
  constructor(private readonly fetchImpl: FetchLike = fetch, private readonly version = env().META_GRAPH_VERSION) {}

  private url(path: string) {
    return `https://graph.facebook.com/${this.version}/${path}`;
  }

  private async call<T>(creds: ChannelCredentials, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), {
        method: init?.method ?? "GET",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new ProviderError(`Falha de rede ao chamar a Meta: ${(e as Error).message}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || json.error?.code === 4 || json.error?.code === 80007;
      throw new ProviderError(json.error?.message ?? `Erro HTTP ${res.status} da Meta`, retryable, json.error?.code);
    }
    return json;
  }

  async sendText(creds: ChannelCredentials, to: string, body: string) {
    const r = await this.call<{ messages?: { id: string }[] }>(creds, `${creds.phoneNumberId}/messages`, {
      method: "POST",
      body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new ProviderError("Resposta da Meta sem id de mensagem", false);
    return { providerMessageId: id };
  }

  async sendTemplate(creds: ChannelCredentials, to: string, name: string, language: string, bodyParams: string[]) {
    const components = bodyParams.length
      ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
      : undefined;
    const r = await this.call<{ messages?: { id: string }[] }>(creds, `${creds.phoneNumberId}/messages`, {
      method: "POST",
      body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template: { name, language: { code: language }, components } },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new ProviderError("Resposta da Meta sem id de mensagem", false);
    return { providerMessageId: id };
  }

  async listTemplates(creds: ChannelCredentials): Promise<RemoteTemplate[]> {
    const out: RemoteTemplate[] = [];
    let path: string | null = `${creds.wabaId}/message_templates?fields=id,name,language,category,status,components&limit=100`;
    for (let page = 0; path && page < 20; page++) {
      const r: {
        data: { id: string; name: string; language: string; category: string; status: string; components?: { type: string; text?: string }[] }[];
        paging?: { cursors?: { after?: string }; next?: string };
      } = await this.call(creds, path);
      for (const t of r.data) {
        out.push({
          id: t.id, name: t.name, language: t.language, category: t.category, status: t.status,
          bodyText: t.components?.find((c) => c.type === "BODY")?.text ?? null,
        });
      }
      const after = r.paging?.next ? r.paging.cursors?.after : undefined;
      path = after ? `${creds.wabaId}/message_templates?fields=id,name,language,category,status,components&limit=100&after=${encodeURIComponent(after)}` : null;
    }
    return out;
  }

  async getPhoneNumber(creds: ChannelCredentials) {
    const r = await this.call<{ display_phone_number?: string; verified_name?: string }>(
      creds, `${creds.phoneNumberId}?fields=display_phone_number,verified_name`,
    );
    return { displayPhone: r.display_phone_number ?? creds.phoneNumberId, verifiedName: r.verified_name ?? null };
  }
}

let provider: ChannelProvider | null = null;
export function channelProvider(): ChannelProvider {
  return (provider ??= new MetaCloudProvider());
}
/** Permite injetar um provedor falso nos testes. */
export function setChannelProvider(p: ChannelProvider | null) {
  provider = p;
}
