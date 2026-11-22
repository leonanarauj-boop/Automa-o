import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { inboundPayload, resetDb, sign, statusPayload } from "../helpers";
import { closePool, withService, withTenant } from "@/lib/db";
import { signup } from "@/modules/auth/service";
import { setChannelProvider } from "@/modules/whatsapp/meta-cloud";
import { ProviderError, type ChannelProvider } from "@/modules/whatsapp/provider";
import { connectChannel, syncTemplates } from "@/modules/whatsapp/channel";
import { queueTemplate, queueText, SendBlockedError } from "@/modules/inbox/outbound";
import { runOnce } from "@/worker/handlers";
import { GET, POST } from "@/app/api/webhooks/whatsapp/route";
import { moveDeal, getDefaultPipeline } from "@/modules/crm/service";
import { refreshRadar, radarSummary } from "@/modules/radar/service";

const PHONE_ID = "1234567890";
const sent: { to: string; body?: string; template?: string; params?: string[] }[] = [];
let failMode: "none" | "retryable" | "fatal" = "none";
let counter = 0;

const fake: ChannelProvider = {
  async sendText(_c, to, body) {
    if (failMode === "retryable") throw new ProviderError("instável", true);
    if (failMode === "fatal") throw new ProviderError("número inválido", false, 131026);
    sent.push({ to, body }); return { providerMessageId: `wamid.out.${++counter}` };
  },
  async sendTemplate(_c, to, name, _l, params) { sent.push({ to, template: name, params }); return { providerMessageId: `wamid.out.${++counter}` }; },
  async listTemplates() {
    return [
      { id: "t1", name: "retomada", language: "pt_BR", category: "MARKETING", status: "APPROVED", bodyText: "Olá {{1}}, ainda tem interesse?" },
      { id: "t2", name: "pendente", language: "pt_BR", category: "UTILITY", status: "PENDING", bodyText: "Oi" },
    ];
  },
  async getPhoneNumber() { return { displayPhone: "+55 11 4000-0000", verifiedName: "Clínica" }; },
};

let A: { userId: string; orgId: string };

async function postWebhook(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  const req = new NextRequest("http://localhost/api/webhooks/whatsapp", {
    method: "POST", body, headers: { "x-hub-signature-256": signature ?? sign(body), "content-type": "application/json" },
  });
  return POST(req);
}
async function drain() { while ((await runOnce(50)) > 0) { /* processa tudo */ } }
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withService((db) => db.query<T>(sql, p)).then((r) => r.rows);

beforeAll(async () => {
  await resetDb();
  setChannelProvider(fake);
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
  await connectChannel(A.orgId, A.userId, { wabaId: "99999", phoneNumberId: PHONE_ID, accessToken: "EAAG-token-de-teste-123456" });
});
afterAll(async () => { setChannelProvider(null); await closePool(); });
beforeEach(() => { failMode = "none"; });

describe("webhook da Meta", () => {
  it("verificação GET devolve o challenge só com o token certo", async () => {
    const ok = await GET(new NextRequest("http://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=42"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    const bad = await GET(new NextRequest("http://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42"));
    expect(bad.status).toBe(403);
  });

  it("rejeita assinatura inválida sem gravar nada", async () => {
    const res = await postWebhook(inboundPayload({ phoneNumberId: PHONE_ID, from: "5511900000099", id: "wamid.x", text: "oi" }), "sha256=00");
    expect(res.status).toBe(401);
    expect(await q("select * from webhook_events")).toHaveLength(0);
  });

  it("mensagem recebida cria contato, consentimento, conversa, mensagem e negócio", async () => {
    const res = await postWebhook(inboundPayload({ phoneNumberId: PHONE_ID, from: "5511988887777", id: "wamid.in.1", text: "Quanto custa o clareamento?", name: "Bruna" }));
    expect(res.status).toBe(200);
    await drain();
    const [c] = await q<{ display_name: string; source: string; id: string }>("select id, display_name, source from contacts where organization_id = $1", [A.orgId]);
    expect(c).toMatchObject({ display_name: "Bruna", source: "whatsapp" });
    expect(await q("select * from messages where direction = 'inbound'")).toHaveLength(1);
    expect(await q("select * from consent_records where contact_id = $1 and purpose = 'service'", [c.id])).toHaveLength(1);
    expect(await q("select * from deals where contact_id = $1", [c.id])).toHaveLength(1);
    const [conv] = await q<{ service_window_expires_at: Date }>("select service_window_expires_at from conversations");
    expect(conv.service_window_expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
  });

  it("é idempotente: o mesmo evento e a mesma mensagem não duplicam", async () => {
    const p = inboundPayload({ phoneNumberId: PHONE_ID, from: "5511988887777", id: "wamid.in.1", text: "Quanto custa o clareamento?", name: "Bruna" });
    await postWebhook(p); // corpo idêntico → mesmo evento
    await postWebhook({ ...p, extra: true }); // corpo diferente, mesma mensagem
    await drain();
    expect(await q("select * from messages where direction = 'inbound'")).toHaveLength(1);
    expect(await q("select * from contacts")).toHaveLength(1);
    expect(await q("select * from deals")).toHaveLength(1);
  });

  it("número não conectado é ignorado", async () => {
    await postWebhook(inboundPayload({ phoneNumberId: "000", from: "5511911110000", id: "wamid.other", text: "oi" }));
    await drain();
    expect(await q("select * from contacts where wa_id = '5511911110000'")).toHaveLength(0);
  });
});

describe("envio de mensagens", () => {
  let convId: string;
  beforeAll(async () => { convId = (await q<{ id: string }>("select id from conversations"))[0].id; });

  it("texto dentro da janela é enviado pelo worker e atualiza status", async () => {
    const id = await withTenant(A, (db) => queueText(db, A.userId, { conversationId: convId, body: "Custa R$ 800." }));
    await drain();
    expect(sent.at(-1)).toEqual({ to: "5511988887777", body: "Custa R$ 800." });
    const [m] = await q<{ status: string; provider_message_id: string }>("select status, provider_message_id from messages where id = $1", [id]);
    expect(m.status).toBe("sent");
    await postWebhook(statusPayload({ phoneNumberId: PHONE_ID, id: m.provider_message_id, status: "read" }));
    await postWebhook(statusPayload({ phoneNumberId: PHONE_ID, id: m.provider_message_id, status: "delivered" })); // fora de ordem
    await drain();
    expect((await q<{ status: string }>("select status from messages where id = $1", [id]))[0].status).toBe("read");
  });

  it("bloqueia texto livre fora da janela de 24h", async () => {
    await withService((db) => db.query("update conversations set service_window_expires_at = now() - interval '1 minute'"));
    await expect(withTenant(A, (db) => queueText(db, A.userId, { conversationId: convId, body: "oi" }))).rejects.toThrow(SendBlockedError);
  });

  it("templates: sincroniza, só envia aprovado e com variáveis corretas", async () => {
    const channelId = (await q<{ id: string }>("select id from channel_accounts"))[0].id;
    expect(await syncTemplates(A.orgId, channelId)).toBe(2);
    const tpls = await q<{ id: string; name: string; body_param_count: number }>("select id, name, body_param_count from message_templates order by name");
    const ok = tpls.find((t) => t.name === "retomada")!;
    const pend = tpls.find((t) => t.name === "pendente")!;
    expect(ok.body_param_count).toBe(1);
    await expect(withTenant(A, (db) => queueTemplate(db, A.userId, { conversationId: convId, templateId: pend.id, params: [] }))).rejects.toThrow(/aprovados/);
    await expect(withTenant(A, (db) => queueTemplate(db, A.userId, { conversationId: convId, templateId: ok.id, params: [] }))).rejects.toThrow(/variável/);
    await withTenant(A, (db) => queueTemplate(db, A.userId, { conversationId: convId, templateId: ok.id, params: ["Bruna"] }));
    await drain();
    expect(sent.at(-1)).toEqual({ to: "5511988887777", template: "retomada", params: ["Bruna"] });
  });

  it("descadastro (SAIR) bloqueia templates", async () => {
    await postWebhook(inboundPayload({ phoneNumberId: PHONE_ID, from: "5511988887777", id: "wamid.in.sair", text: "SAIR" }));
    await drain();
    const tplId = (await q<{ id: string }>("select id from message_templates where name = 'retomada'"))[0].id;
    await expect(withTenant(A, (db) => queueTemplate(db, A.userId, { conversationId: convId, templateId: tplId, params: ["x"] }))).rejects.toThrow(/não receber/);
  });

  it("erro transitório é re-tentado; erro definitivo marca a mensagem como falha", async () => {
    failMode = "retryable";
    const id = await withTenant(A, (db) => queueText(db, A.userId, { conversationId: convId, body: "tentativa" }));
    await runOnce();
    const [job] = await q<{ status: string; attempts: number }>("select status, attempts from jobs where payload->>'messageId' = $1", [id]);
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect((await q<{ status: string }>("select status from messages where id = $1", [id]))[0].status).toBe("pending");

    failMode = "fatal";
    await withService((db) => db.query("update jobs set run_at = now() where payload->>'messageId' = $1", [id]));
    await runOnce();
    const [m] = await q<{ status: string; error: string }>("select status, error from messages where id = $1", [id]);
    expect(m).toMatchObject({ status: "failed", error: "número inválido" });
  });
});

describe("Radar e receita recuperada", () => {
  it("detecta oportunidade, e só conta como recuperada quando o negócio é ganho", async () => {
    // Novo lead pergunta e ninguém responde há 5 horas
    const ts = Math.floor(Date.now() / 1000) - 5 * 3600;
    await postWebhook(inboundPayload({ phoneNumberId: PHONE_ID, from: "5511977776666", id: "wamid.in.radar", text: "Fazem implante?", name: "Caio", ts }));
    await drain();
    const deal = (await q<{ id: string }>("select d.id from deals d join contacts c on c.id = d.contact_id where c.wa_id = '5511977776666'"))[0];
    await withService((db) => db.query("update deals set value_cents = 900000 where id = $1", [deal.id]));

    await withTenant(A, (db) => refreshRadar(db, A.orgId));
    const s1 = await withTenant(A, (db) => radarSummary(db, A.orgId));
    expect(s1.openCount).toBeGreaterThanOrEqual(1);
    expect(s1.potentialFromDeals).toBeGreaterThanOrEqual(900000);
    expect(s1.recoveredThisMonth).toBe(0); // potencial NÃO é receita

    const pipe = await withTenant(A, (db) => getDefaultPipeline(db));
    const won = pipe.stages.find((s) => s.kind === "won")!;
    await withTenant(A, (db) => moveDeal(db, A.orgId, A.userId, deal.id, won.id));
    const s2 = await withTenant(A, (db) => radarSummary(db, A.orgId));
    expect(s2.recoveredThisMonth).toBe(900000);
    expect(s2.recoveredCountThisMonth).toBe(1);
  });

  it("sinal some (resolvido) quando a condição deixa de existir", async () => {
    await withService((db) => db.query("update contacts set last_outbound_at = now()"));
    await withService((db) => db.query("update deals set last_activity_at = now()"));
    await withTenant(A, (db) => refreshRadar(db, A.orgId));
    const open = await q("select * from opportunity_signals where status = 'open'");
    expect(open).toHaveLength(0);
  });
});
