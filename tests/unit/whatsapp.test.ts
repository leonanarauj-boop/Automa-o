import { describe, expect, it } from "vitest";
import "../helpers";
import { verifyMetaSignature } from "@/modules/whatsapp/signature";
import { parseWebhook } from "@/modules/whatsapp/webhook";
import { countTemplateParams, isOptOutMessage, isWindowOpen, normalizePhone, renderTemplate, serviceWindowExpiry, shouldApplyStatus } from "@/modules/whatsapp/rules";
import { inboundPayload, sign, statusPayload } from "../helpers";

describe("assinatura da Meta", () => {
  const body = JSON.stringify({ a: 1 });
  it("aceita assinatura válida", () => expect(verifyMetaSignature(body, sign(body), "test-app-secret")).toBe(true));
  it("rejeita assinatura de outro segredo", () => expect(verifyMetaSignature(body, sign(body, "outro"), "test-app-secret")).toBe(false));
  it("rejeita corpo alterado", () => expect(verifyMetaSignature(body + " ", sign(body), "test-app-secret")).toBe(false));
  it("rejeita cabeçalho ausente ou malformado", () => {
    expect(verifyMetaSignature(body, null, "test-app-secret")).toBe(false);
    expect(verifyMetaSignature(body, "md5=abc", "test-app-secret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "test-app-secret")).toBe(false);
  });
  it("rejeita quando o segredo não está configurado", () => expect(verifyMetaSignature(body, sign(body, ""), "")).toBe(false));
});

describe("parse de webhook", () => {
  it("extrai mensagem de texto com nome do perfil", () => {
    const items = parseWebhook(inboundPayload({ phoneNumberId: "111", from: "5511988887777", id: "wamid.1", text: "Olá", name: "Ana", ts: 1700000000 }));
    expect(items).toEqual([expect.objectContaining({ kind: "message", phoneNumberId: "111", waId: "5511988887777", profileName: "Ana", text: "Olá", providerMessageId: "wamid.1" })]);
    expect((items[0] as { timestamp: Date }).timestamp.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });
  it("extrai status", () => {
    const items = parseWebhook(statusPayload({ phoneNumberId: "111", id: "wamid.2", status: "delivered" }));
    expect(items[0]).toMatchObject({ kind: "status", providerMessageId: "wamid.2", status: "delivered" });
  });
  it("ignora objetos que não são do WhatsApp e payloads inválidos", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook("lixo")).toEqual([]);
    expect(parseWebhook({ object: "whatsapp_business_account", entry: [{ id: "x", changes: [{ field: "messages", value: { sem: "metadata" } }] }] })).toEqual([]);
  });
});

describe("regras", () => {
  it("janela de 24h", () => {
    const now = new Date("2026-01-02T12:00:00Z");
    expect(isWindowOpen(serviceWindowExpiry(new Date("2026-01-01T13:00:00Z")), now)).toBe(true);
    expect(isWindowOpen(serviceWindowExpiry(new Date("2026-01-01T11:59:00Z")), now)).toBe(false);
    expect(isWindowOpen(null, now)).toBe(false);
  });
  it("detecta pedido de descadastro", () => {
    for (const t of ["SAIR", "Parar!", " stop ", "Não quero mais receber"]) expect(isOptOutMessage(t)).toBe(true);
    for (const t of ["quero sair às 18h", "ok", null]) expect(isOptOutMessage(t)).toBe(false);
  });
  it("status só avança e failed prevalece", () => {
    expect(shouldApplyStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyStatus("read", "delivered")).toBe(false);
    expect(shouldApplyStatus("delivered", "failed")).toBe(true);
    expect(shouldApplyStatus("failed", "read")).toBe(false);
    expect(shouldApplyStatus("sent", "desconhecido")).toBe(false);
  });
  it("normaliza telefones brasileiros", () => {
    expect(normalizePhone("(11) 91234-5678")).toBe("5511912345678");
    expect(normalizePhone("+55 11 91234-5678")).toBe("5511912345678");
    expect(normalizePhone("1234")).toBeNull();
  });
  it("templates: conta e renderiza variáveis", () => {
    expect(countTemplateParams("Olá {{1}}, seu horário é {{2}}")).toBe(2);
    expect(countTemplateParams("Sem variáveis")).toBe(0);
    expect(renderTemplate("Olá {{1}}!", ["Ana"])).toBe("Olá Ana!");
  });
});
