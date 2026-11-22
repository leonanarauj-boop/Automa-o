import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { resetDb } from "../helpers";
import { closePool, withService, withTenant } from "@/lib/db";
import { signup } from "@/modules/auth/service";
import { seedDemo } from "@/modules/demo/seed";
import { setAIProvider } from "@/modules/ai/anthropic";
import type { AIProvider, AIRequest, AIResult } from "@/modules/ai/provider";
import { analyzeConversation, applyAnalysis, CopilotError, recordReplyOutcome, suggestReply } from "@/modules/ai/copilot";
import { retrieve, saveAgent, saveDocument, saveProduct } from "@/modules/ai/knowledge";
import { AILimitError } from "@/modules/ai/usage";

let next: unknown = null;
let nextStatus: "ok" | "error" | "refused" = "ok";
const requests: AIRequest<z.ZodType>[] = [];
const usage = { inputTokens: 1200, outputTokens: 150, cacheReadTokens: 800, cacheWriteTokens: 0 };
const fake: AIProvider = {
  name: "fake", model: "claude-opus-5-5", available: () => true,
  async generate<S extends z.ZodType>(req: AIRequest<S>): Promise<AIResult<z.infer<S>>> {
    requests.push(req as AIRequest<z.ZodType>);
    if (nextStatus === "error") return { status: "error", message: "falha simulada", retryable: true };
    if (nextStatus === "refused") return { status: "refused", model: "claude-opus-5-5", usage, reason: null };
    return { status: "ok", data: next as z.infer<S>, model: "claude-opus-5-5", usage };
  },
};

let A: { userId: string; orgId: string };
let B: { userId: string; orgId: string };
let convA: string;
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withService((db) => db.query<T>(sql, p)).then((r) => r.rows);

beforeAll(async () => {
  await resetDb();
  setAIProvider(fake);
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
  B = await signup({ fullName: "Beto", email: "beto@b.com", password: "senha-forte-456", orgName: "Clínica B", segment: "clinica" });
  for (const t of [A, B]) await withTenant(t, (db) => seedDemo(db, t.orgId, t.userId));
  await withTenant(A, async (db) => {
    await saveProduct(db, A.orgId, { name: "Clareamento", price: "4.800,00", priceType: "fixed", durationMin: "60" });
    await saveDocument(db, A.orgId, A.userId, { title: "Pagamento", kind: "faq", content: "Aceitamos Pix e cartão em até 10x sem juros." });
    await saveAgent(db, A.orgId, A.userId, { name: "Bia", tone: "acolhedor", formality: "neutral", policies: "Desconto de 5% no Pix." });
  });
  await withTenant(B, async (db) => {
    await saveProduct(db, B.orgId, { name: "Produto Secreto B", price: "123,45", priceType: "fixed" });
    await saveDocument(db, B.orgId, B.userId, { title: "Segredo B", kind: "text", content: "Informação confidencial da clínica B que jamais deve vazar." });
  });
  convA = (await q<{ id: string }>("select cv.id from conversations cv join contacts c on c.id = cv.contact_id where c.organization_id = $1 and c.display_name like 'Mariana%'", [A.orgId]))[0].id;
});
afterAll(async () => { setAIProvider(null); await closePool(); });
beforeEach(() => { nextStatus = "ok"; requests.length = 0; });

describe("sugestão de resposta", () => {
  it("gera sugestão com dados SOMENTE da própria empresa e registra custo", async () => {
    next = { reply: "Oi, Mariana! O clareamento custa R$ 4.800,00 e parcelamos em até 10x sem juros. Quer agendar?", needs_human: false, reason: null, source_ids: ["P1", "K1"] };
    const s = await suggestReply(A, convA);
    expect(s.blocked).toBe(false);
    expect(s.reply).toContain("R$ 4.800,00");
    const req = requests[0];
    const full = req.system + req.user;
    expect(full).toContain("Clareamento — R$ 4.800,00");
    expect(full).toContain("10x sem juros");
    expect(full).toContain("Mariana Costa (DEMO)");
    expect(full).not.toContain("Produto Secreto B");
    expect(full).not.toContain("confidencial da clínica B");
    const [call] = await q<{ status: string; input_tokens: number; cost_micros: string; feature: string }>("select * from ai_calls where organization_id = $1", [A.orgId]);
    expect(call).toMatchObject({ status: "ok", input_tokens: 1200, feature: "reply" });
    expect(Number(call.cost_micros)).toBeGreaterThan(0);
  });

  it("bloqueia resposta com preço ou desconto inventado", async () => {
    next = { reply: "Para você faço R$ 3.900 com 20% off!", needs_human: false, reason: null, source_ids: [] };
    const s = await suggestReply(A, convA);
    expect(s.blocked).toBe(true);
    expect(s.reply).toBe("");
    expect(s.needs_human).toBe(true);
    expect(s.violations.length).toBe(2);
    const calls = await q<{ status: string }>("select status from ai_calls where organization_id = $1 order by created_at desc limit 1", [A.orgId]);
    expect(calls[0].status).toBe("blocked");
    // a sugestão anterior foi substituída
    const pend = await q("select * from ai_suggestions where conversation_id = $1 and kind = 'reply' and status = 'pending'", [convA]);
    expect(pend).toHaveLength(1);
  });

  it("registra se a sugestão foi enviada como está ou editada", async () => {
    next = { reply: "Posso te ajudar com o agendamento?", needs_human: false, reason: null, source_ids: [] };
    const s1 = await suggestReply(A, convA);
    await withTenant(A, (db) => recordReplyOutcome(db, A.userId, s1.id, "Posso te ajudar com o agendamento?"));
    const s2 = await suggestReply(A, convA);
    await withTenant(A, (db) => recordReplyOutcome(db, A.userId, s2.id, "Posso te ajudar? Temos horário amanhã."));
    const rows = await q<{ id: string; status: string }>("select id, status from ai_suggestions where id = any($1)", [[s1.id, s2.id]]);
    expect(rows.find((r) => r.id === s1.id)!.status).toBe("accepted");
    expect(rows.find((r) => r.id === s2.id)!.status).toBe("accepted_edited");
  });

  it("outra empresa não acessa a conversa", async () => {
    await expect(suggestReply(B, convA)).rejects.toThrow(CopilotError);
  });

  it("erro do provedor é registrado e não consome crédito", async () => {
    nextStatus = "error";
    await expect(suggestReply(A, convA)).rejects.toThrow("falha simulada");
    const [last] = await q<{ status: string }>("select status from ai_calls where organization_id = $1 order by created_at desc limit 1", [A.orgId]);
    expect(last.status).toBe("error");
  });

  it("recusa do modelo vira mensagem clara", async () => {
    nextStatus = "refused";
    await expect(suggestReply(A, convA)).rejects.toThrow(/Responda manualmente/);
  });
});

describe("controle de créditos", () => {
  it("respeita o limite mensal e o interruptor da organização", async () => {
    const used = (await q<{ n: string }>("select count(*) n from ai_calls where organization_id = $1 and status <> 'error'", [A.orgId]))[0].n;
    await withService((db) => db.query("update organizations set ai_monthly_credits = $2 where id = $1", [A.orgId, Number(used)]));
    next = { reply: "ok", needs_human: false, reason: null, source_ids: [] };
    await expect(suggestReply(A, convA)).rejects.toThrow(AILimitError);
    await withService((db) => db.query("update organizations set ai_monthly_credits = 300, ai_enabled = false where id = $1", [A.orgId]));
    await expect(suggestReply(A, convA)).rejects.toThrow(/desativada/);
    await withService((db) => db.query("update organizations set ai_enabled = true where id = $1", [A.orgId]));
  });

  it("chamadas simultâneas não ultrapassam o limite", async () => {
    const used = Number((await q<{ n: string }>("select count(*) n from ai_calls where organization_id = $1 and status <> 'error'", [A.orgId]))[0].n);
    await withService((db) => db.query("update organizations set ai_monthly_credits = $2 where id = $1", [A.orgId, used + 2]));
    next = { reply: "ok", needs_human: false, reason: null, source_ids: [] };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => suggestReply(A, convA)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    await withService((db) => db.query("update organizations set ai_monthly_credits = 300 where id = $1", [A.orgId]));
  });
});

describe("análise da conversa", () => {
  it("só aplica no CRM o que o humano aprovar", async () => {
    next = {
      summary: "Mariana quer clareamento, recebeu orçamento de R$ 4.800 e vai decidir com o marido.",
      temperature: "warm", intent: "orcamento", interests: ["Clareamento"], budget_mentioned: null, urgency: "media",
      objections: [{ type: "aprovacao_terceiros", evidence: "Vou ver com meu marido" }],
      suggested_stage: "Negociação", stage_evidence: "Vou ver com meu marido e te aviso.", next_action: "Retomar contato oferecendo parcelamento",
    };
    const a = await analyzeConversation(A, convA);
    expect(a.suggested_stage_id).not.toBeNull();
    const contactId = (await q<{ contact_id: string }>("select contact_id from conversations where id = $1", [convA]))[0].contact_id;
    await withTenant(A, (db) => applyAnalysis(db, A.orgId, A.userId, a.id, ["summary", "stage", "task"]));
    const [c] = await q<{ ai_summary: string; temperature: string }>("select ai_summary, temperature from contacts where id = $1", [contactId]);
    expect(c.ai_summary).toContain("clareamento");
    expect(c.temperature).toBe("hot"); // temperatura NÃO aplicada (demo era hot)
    const [d] = await q<{ name: string }>("select s.name from deals d join pipeline_stages s on s.id = d.stage_id where d.contact_id = $1", [contactId]);
    expect(d.name).toBe("Negociação");
    expect(await q("select * from tasks where contact_id = $1 and created_by_type = 'ai'", [contactId])).toHaveLength(1);
    await expect(withTenant(A, (db) => applyAnalysis(db, A.orgId, A.userId, a.id, ["temperature"]))).rejects.toThrow(/já foi decidida/);
  });

  it("ignora etapa inexistente sugerida pela IA", async () => {
    next = { summary: "x", temperature: "cold", intent: "outro", interests: [], budget_mentioned: null, urgency: "desconhecida", objections: [], suggested_stage: "Etapa Inventada", stage_evidence: null, next_action: "y" };
    const a = await analyzeConversation(A, convA);
    expect(a.suggested_stage).toBeNull();
    expect(a.suggested_stage_id).toBeNull();
  });
});

describe("recuperação de conhecimento", () => {
  it("base grande: busca os trechos relevantes, sem acento, só da própria empresa", async () => {
    const filler = Array.from({ length: 50 }, (_, i) => `Tópico ${i}: ${"informação genérica sobre o funcionamento da clínica ".repeat(20)}`).join("\n\n");
    await withTenant(A, (db) => saveDocument(db, A.orgId, A.userId, { title: "Manual", kind: "text", content: filler + "\n\nO preço da manutenção ortodôntica é combinado na avaliação." }));
    const res = await withTenant(A, (db) => retrieve(db, A.orgId, "qual o preco da manutencao ortodontica?"));
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].content).toMatch(/manutenção ortodôntica/);
    const resB = await withTenant(B, (db) => retrieve(db, B.orgId, "manutencao ortodontica"));
    expect(resB.every((r) => !r.content.includes("ortodôntica"))).toBe(true);
  });
});
