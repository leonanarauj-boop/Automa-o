import { describe, expect, it } from "vitest";
import "../helpers";
import { evaluateRadar, type RadarRow } from "@/modules/radar/rules";
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from "@/lib/crypto";

const now = new Date("2026-03-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000);
const base: RadarRow = { contactId: "c1", contactName: "Ana", lastInboundAt: null, lastOutboundAt: null, windowExpiresAt: null, dealId: null, dealValueCents: null, dealStageName: null, dealLastActivityAt: null };
const T = { awaiting_reply: 2, lead_silent: 72, deal_stale: 120 };

describe("Radar", () => {
  it("cliente aguardando resposta além do limite", () => {
    const c = evaluateRadar([{ ...base, lastInboundAt: hoursAgo(3), windowExpiresAt: hoursAgo(-21) }], T, null, now);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ ruleKind: "awaiting_reply", valueBasis: "unknown", potentialValueCents: null });
    expect(c[0].recommendedAction).toMatch(/janela de 24h ainda está aberta/);
  });
  it("não dispara antes do limite", () => {
    expect(evaluateRadar([{ ...base, lastInboundAt: hoursAgo(1) }], T, null, now)).toHaveLength(0);
  });
  it("cliente silencioso só conta se houver negócio aberto, usando valor do negócio", () => {
    const row = { ...base, lastInboundAt: hoursAgo(100), lastOutboundAt: hoursAgo(80), dealLastActivityAt: hoursAgo(80) };
    expect(evaluateRadar([row], T, null, now)).toHaveLength(0);
    const c = evaluateRadar([{ ...row, dealId: "d1", dealValueCents: 480000 }], T, null, now);
    expect(c[0]).toMatchObject({ ruleKind: "lead_silent", potentialValueCents: 480000, valueBasis: "deal_value" });
    expect(c[0].recommendedAction).toMatch(/template/);
  });
  it("usa ticket médio como ESTIMATIVA quando o negócio não tem valor", () => {
    const c = evaluateRadar([{ ...base, dealId: "d1", dealValueCents: 0, dealLastActivityAt: hoursAgo(200) }], T, 150000, now);
    expect(c[0]).toMatchObject({ ruleKind: "deal_stale", potentialValueCents: 150000, valueBasis: "avg_ticket" });
  });
  it("um contato gera apenas o sinal mais urgente", () => {
    const c = evaluateRadar([{ ...base, dealId: "d1", lastInboundAt: hoursAgo(130), dealLastActivityAt: hoursAgo(130) }], T, null, now);
    expect(c).toHaveLength(1);
    expect(c[0].ruleKind).toBe("awaiting_reply");
  });
  it("regra desativada não dispara", () => {
    expect(evaluateRadar([{ ...base, lastInboundAt: hoursAgo(10) }], { deal_stale: 1 }, null, now)).toHaveLength(0);
  });
});

describe("criptografia", () => {
  it("senha: hash e verificação", async () => {
    const h = await hashPassword("senha-super-segura");
    expect(h).not.toContain("senha-super-segura");
    expect(await verifyPassword("senha-super-segura", h)).toBe(true);
    expect(await verifyPassword("errada", h)).toBe(false);
  });
  it("segredos: ida e volta e detecção de adulteração", () => {
    const enc = encryptSecret("token-da-meta");
    expect(enc).not.toContain("token-da-meta");
    expect(decryptSecret(enc)).toBe("token-da-meta");
    const parts = enc.split(".");
    parts[3] = Buffer.from("adulterado").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
