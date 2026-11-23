import { describe, expect, it } from "vitest";
import "../helpers";
import { isValidCnpj, isValidCpf, isValidDocument } from "@/modules/billing/document";
import { computeOrgStatus, invoiceStatus } from "@/modules/billing/service";
import { applyCoupon } from "@/modules/billing/plans";
import { mapAsaasPayment } from "@/modules/billing/asaas";

const now = new Date("2026-06-15T12:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86400_000);

describe("documentos", () => {
  it("CPF e CNPJ válidos e inválidos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidDocument("123")).toBe(false);
  });
});

describe("status da conta", () => {
  const base = { trialEndsAt: day(3), subscription: null, hasPaidInvoice: false, oldestOverdueDueDate: null };
  it("teste ativo e teste vencido", () => {
    expect(computeOrgStatus(base, now)).toBe("trial");
    expect(computeOrgStatus({ ...base, trialEndsAt: day(-1) }, now)).toBe("suspended");
  });
  it("assinatura paga = ativa; aguardando 1º pagamento segue o teste", () => {
    const sub = { status: "pending", currentPeriodEnd: null };
    expect(computeOrgStatus({ ...base, subscription: sub }, now)).toBe("trial");
    expect(computeOrgStatus({ ...base, trialEndsAt: day(-1), subscription: sub }, now)).toBe("suspended");
    expect(computeOrgStatus({ ...base, trialEndsAt: day(-30), subscription: { status: "active", currentPeriodEnd: day(10) }, hasPaidInvoice: true }, now)).toBe("active");
  });
  it("inadimplência: carência de 7 dias e depois restrição", () => {
    const s = { ...base, trialEndsAt: day(-60), subscription: { status: "active", currentPeriodEnd: day(-2) }, hasPaidInvoice: true };
    expect(computeOrgStatus({ ...s, oldestOverdueDueDate: day(-3) }, now)).toBe("past_due");
    expect(computeOrgStatus({ ...s, oldestOverdueDueDate: day(-8) }, now)).toBe("suspended");
  });
  it("cancelada mantém acesso até o fim do período pago", () => {
    const s = { ...base, trialEndsAt: day(-60), hasPaidInvoice: true };
    expect(computeOrgStatus({ ...s, subscription: { status: "canceled", currentPeriodEnd: day(5) } }, now)).toBe("active");
    expect(computeOrgStatus({ ...s, subscription: { status: "canceled", currentPeriodEnd: day(-1) } }, now)).toBe("canceled");
  });
});

describe("gateway", () => {
  it("mapeia status do Asaas", () => {
    expect(invoiceStatus("CONFIRMED")).toBe("paid");
    expect(invoiceStatus("RECEIVED")).toBe("paid");
    expect(invoiceStatus("OVERDUE")).toBe("overdue");
    expect(invoiceStatus("REFUND_IN_PROGRESS")).toBe("refunded");
    expect(invoiceStatus("CHARGEBACK_REQUESTED")).toBe("chargeback");
    expect(invoiceStatus("PENDING")).toBe("pending");
    expect(invoiceStatus("PENDING", true)).toBe("canceled");
  });
  it("converte valores para centavos", () => {
    expect(mapAsaasPayment({ id: "pay_1", subscription: "sub_1", value: 349.9, status: "PENDING", dueDate: "2026-07-01", invoiceUrl: "https://x" }).valueCents).toBe(34990);
  });
  it("cupom percentual", () => {
    expect(applyCoupon(34900, 20)).toBe(27920);
    expect(applyCoupon(34900, null)).toBe(34900);
  });
});
