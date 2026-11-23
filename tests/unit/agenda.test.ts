import { describe, expect, it } from "vitest";
import "../helpers";
import { isConfirmationMessage, reminderParams } from "@/modules/agenda/reminders";
import { evaluateAppointments, type AppointmentRow } from "@/modules/radar/rules";

describe("confirmação por resposta", () => {
  it("reconhece confirmações comuns", () => {
    for (const t of ["Sim", "sim!", "Confirmo", "confirmado 👍", "Pode confirmar", "SIM CONFIRMO"]) expect(isConfirmationMessage(t), t).toBe(true);
  });
  it("não confunde com outras mensagens nem com cancelamento", () => {
    for (const t of ["sim, mas preciso remarcar", "cancelar", "não", "ok", null]) expect(isConfirmationMessage(t), String(t)).toBe(false);
  });
});

describe("variáveis do lembrete", () => {
  const a = { contact_name: "Mariana Costa (DEMO)", starts_at: new Date("2026-03-10T17:30:00Z"), professional: "Dra. Paula", service: "Limpeza", timezone: "America/Sao_Paulo" };
  it("preenche na ordem e no fuso da empresa", () => {
    expect(reminderParams(a, 5)).toEqual(["Mariana", "10/03", "14:30", "Dra. Paula", "Limpeza"]);
    expect(reminderParams(a, 2)).toEqual(["Mariana", "10/03"]);
    expect(reminderParams(a, 0)).toEqual([]);
  });
  it("recusa templates com variáveis demais", () => expect(reminderParams(a, 6)).toBeNull());
});

describe("Radar da agenda", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  const base: AppointmentRow = { appointmentId: "a1", contactId: "c1", contactName: "Ana", status: "scheduled", startsAt: new Date("2026-03-11T09:00:00Z"), servicePriceCents: 25000, hasLaterBooking: false, label: "11/03 às 06:00" };
  it("não confirmado dentro da antecedência gera alerta com valor do serviço", () => {
    const c = evaluateAppointments([base], { appointment_unconfirmed: 24 }, now);
    expect(c[0]).toMatchObject({ ruleKind: "appointment_unconfirmed", potentialValueCents: 25000, valueBasis: "service_price", appointmentId: "a1" });
  });
  it("fora da antecedência ou confirmado não gera", () => {
    expect(evaluateAppointments([base], { appointment_unconfirmed: 12 }, now)).toHaveLength(0);
    expect(evaluateAppointments([{ ...base, status: "confirmed" }], { appointment_unconfirmed: 24 }, now)).toHaveLength(0);
  });
  it("falta sem reagendamento gera alerta; com novo agendamento, não", () => {
    const ns = { ...base, status: "no_show", startsAt: new Date("2026-03-08T12:00:00Z") };
    expect(evaluateAppointments([ns], { no_show: 24 }, now)[0].ruleKind).toBe("no_show");
    expect(evaluateAppointments([{ ...ns, hasLaterBooking: true }], { no_show: 24 }, now)).toHaveLength(0);
  });
});
