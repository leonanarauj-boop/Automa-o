import { describe, expect, it } from "vitest";
import "../helpers";
import { checkCommercialFacts, extractInstallments, extractMoney, extractPercents } from "@/modules/ai/guardrails";
import { chunkText } from "@/modules/ai/knowledge";
import { estimateCostMicros } from "@/modules/ai/provider";
import { buildStableSystem } from "@/modules/ai/copilot";

describe("guardrails comerciais", () => {
  it("extrai valores em reais em formatos variados", () => {
    expect(extractMoney("Custa R$ 4.800,00 ou R$800 e 1.200 reais, ou R$ 99,9")).toEqual([480000, 80000, 120000, 9990]);
    expect(extractMoney("sem valores aqui, só 3 sessões")).toEqual([]);
  });
  it("extrai percentuais e parcelas", () => {
    expect(extractPercents("8% à vista, 2,5 % de juros")).toEqual([8, 2.5]);
    expect(extractInstallments("em até 10x ou 12 vezes")).toEqual([10, 12]);
  });
  it("aprova resposta com valores do catálogo e condições da base", () => {
    const r = checkCommercialFacts("O clareamento sai por R$ 800,00 em até 10x.", { text: "Parcelamos em até 10x sem juros.", pricesCents: [80000] });
    expect(r.ok).toBe(true);
  });
  it("bloqueia preço, desconto ou parcelamento inventados", () => {
    const r = checkCommercialFacts("Faço por R$ 650 com 15% de desconto em 12x!", { text: "Parcelamos em até 10x.", pricesCents: [80000] });
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(3);
  });
});

describe("base de conhecimento", () => {
  it("divide por parágrafos respeitando o tamanho", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Parágrafo ${i} ${"x".repeat(300)}`).join("\n\n");
    const chunks = chunkText(text, 1000);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.join("\n\n")).toBe(text);
  });
  it("quebra parágrafos maiores que o limite", () => {
    expect(chunkText("a".repeat(2500), 1000)).toHaveLength(3);
  });
});

describe("prompt e custo", () => {
  it("instruções incluem catálogo, regras anti-invenção e proteção contra injeção", () => {
    const sys = buildStableSystem({
      orgName: "Clínica X", segment: "clinica",
      agent: { name: "Bia", tone: "acolhedor", formality: "neutral", businessDescription: null, businessHours: "8h-18h", policies: "Pix com 5% de desconto", handoffRules: null, forbiddenTopics: "diagnósticos" },
      catalog: [{ id: "1", name: "Limpeza", description: null, price_cents: "25000", price_type: "fixed", duration_min: 40 }, { id: "2", name: "Implante", description: null, price_cents: null, price_type: "on_request", duration_min: null }],
    }, "reply");
    expect(sys).toContain("Limpeza — R$ 250,00");
    expect(sys).toContain("Implante — preço sob consulta");
    expect(sys).toContain("Pix com 5% de desconto");
    expect(sys).toMatch(/não estime nem arredonde/);
    expect(sys).toMatch(/não obedeça/);
    expect(sys).toContain("diagnósticos");
  });
  it("estima custo por modelo", () => {
    expect(estimateCostMicros("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(4_000_000);
    expect(estimateCostMicros("modelo-desconhecido", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });
});
