import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { inboundPayload, resetDb, sign } from "../helpers";
import { closePool, withService, withTenant } from "@/lib/db";
import { signup } from "@/modules/auth/service";
import { addException, AgendaError, availableSlots, book, createProfessional, reschedule, setStatus, setWeeklyHours } from "@/modules/agenda/service";
import { sendDueReminders } from "@/modules/agenda/reminders";
import { createContact } from "@/modules/crm/service";
import { refreshRadar } from "@/modules/radar/service";
import { runOnce } from "@/worker/handlers";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { setChannelProvider } from "@/modules/whatsapp/meta-cloud";
import type { ChannelProvider } from "@/modules/whatsapp/provider";

let A: { userId: string; orgId: string };
let B: { userId: string; orgId: string };
let prof: string;
let contact: string;
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withService((db) => db.query<T>(sql, p)).then((r) => r.rows);
const MANAGER = { canOverride: true };
const AGENT = { canOverride: false };

/** Data local (São Paulo) daqui a N dias, no formato YYYY-MM-DD */
function day(n: number) {
  const d = new Date(Date.now() + n * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();
const D = day(10);

const sent: { template?: string; params?: string[] }[] = [];
const fakeChannel: ChannelProvider = {
  async sendText() { return { providerMessageId: `wamid.t.${Math.random()}` }; },
  async sendTemplate(_c, _to, name, _l, params) { sent.push({ template: name, params }); return { providerMessageId: `wamid.r.${Math.random()}` }; },
  async listTemplates() { return []; },
  async getPhoneNumber() { return { displayPhone: "+55", verifiedName: null }; },
};

beforeAll(async () => {
  await resetDb();
  setChannelProvider(fakeChannel);
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
  B = await signup({ fullName: "Beto", email: "beto@b.com", password: "senha-forte-456", orgName: "Clínica B", segment: "clinica" });
  await withTenant(A, async (db) => {
    prof = await createProfessional(db, A.orgId, A.userId, "Dra. Paula");
    // todos os dias, 08:00–12:00 e 13:00–17:00 (independe do dia da semana do teste)
    await setWeeklyHours(db, A.orgId, prof, [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [{ weekday, start: "08:00", end: "12:00" }, { weekday, start: "13:00", end: "17:00" }]));
    contact = await createContact(db, A.orgId, A.userId, { displayName: "Lucas Prado", phone: "11955554444" });
  });
});
afterAll(async () => { setChannelProvider(null); await closePool(); });

describe("disponibilidade", () => {
  it("gera horários no fuso da empresa, a cada 15 min, respeitando o almoço", async () => {
    const slots = await withTenant(A, (db) => availableSlots(db, A.orgId, prof, D, 30));
    expect(slots[0].toISOString()).toBe(at(D, "08:00").replace(".000Z", ".000Z"));
    expect(slots.map((s) => s.toISOString())).not.toContain(new Date(at(D, "11:45")).toISOString()); // terminaria 12:15
    expect(slots.map((s) => s.toISOString())).toContain(new Date(at(D, "11:30")).toISOString());
    expect(slots.map((s) => s.toISOString())).toContain(new Date(at(D, "13:00")).toISOString());
    expect(slots).toHaveLength(15 + 15); // 08:00..11:30 e 13:00..16:30, de 15 em 15 min
  });

  it("intervalos sobrepostos no mesmo dia são recusados", async () => {
    await expect(withTenant(A, (db) => setWeeklyHours(db, A.orgId, prof, [{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }]))).rejects.toThrow(AgendaError);
  });
});

describe("agendamento", () => {
  it("cria no horário livre e o horário some da lista", async () => {
    await withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(D, "09:00"), durationMin: 30 }, AGENT));
    const slots = (await withTenant(A, (db) => availableSlots(db, A.orgId, prof, D, 30))).map((s) => s.toISOString());
    expect(slots).not.toContain(new Date(at(D, "09:00")).toISOString());
    expect(slots).not.toContain(new Date(at(D, "08:45")).toISOString()); // 08:45–09:15 colidiria
    expect(slots).toContain(new Date(at(D, "09:30")).toISOString());
  });

  it("sobreposição parcial é bloqueada pelo banco", async () => {
    await expect(withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(D, "09:15"), durationMin: 30 }, AGENT)))
      .rejects.toThrow(/acabou de ser ocupado/);
  });

  it("20 pedidos simultâneos no mesmo horário: exatamente 1 vence", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () =>
      withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(D, "10:00"), durationMin: 30 }, AGENT))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const reasons = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as Error).message);
    expect(reasons.every((m) => /ocupado/.test(m))).toBe(true);
  });

  it("fora do horário: atendente não consegue; gestor faz encaixe", async () => {
    const input = { contactId: contact, professionalId: prof, startsAt: at(D, "12:15"), durationMin: 30, allowOutsideHours: true };
    await expect(withTenant(A, (db) => book(db, A.orgId, A.userId, input, AGENT))).rejects.toThrow(/Fora do horário/);
    await expect(withTenant(A, (db) => book(db, A.orgId, A.userId, input, MANAGER))).resolves.toBeTypeOf("string");
  });

  it("bloqueio remove horários e informa conflitos existentes", async () => {
    const conflicts = await withTenant(A, (db) => addException(db, A.orgId, prof, { date: D, start: "13:00", end: "15:00", reason: "Curso" }));
    expect(conflicts).toBe(0);
    const slots = (await withTenant(A, (db) => availableSlots(db, A.orgId, prof, D, 30))).map((s) => s.toISOString());
    expect(slots).not.toContain(new Date(at(D, "14:00")).toISOString());
    expect(slots).toContain(new Date(at(D, "15:00")).toISOString());
    const c2 = await withTenant(A, (db) => addException(db, A.orgId, prof, { date: D, start: "09:00", end: "10:30" }));
    expect(c2).toBe(2);
  });

  it("não agenda no passado", async () => {
    await expect(withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(day(-2), "09:00"), durationMin: 30 }, MANAGER))).rejects.toThrow(/passado/);
  });
});

describe("remarcação e status", () => {
  it("remarcar cria novo vinculado, cancela o original e libera o horário", async () => {
    const D2 = day(11);
    const id = await withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(D2, "08:00"), durationMin: 30 }, AGENT));
    const newId = await withTenant(A, (db) => reschedule(db, A.orgId, A.userId, id, at(D2, "16:00"), AGENT));
    const rows = await q<{ id: string; status: string; rescheduled_from: string | null }>("select id, status, rescheduled_from from appointments where id = any($1)", [[id, newId]]);
    expect(rows.find((r) => r.id === id)!.status).toBe("canceled");
    expect(rows.find((r) => r.id === newId)!.rescheduled_from).toBe(id);
    const slots = (await withTenant(A, (db) => availableSlots(db, A.orgId, prof, D2, 30))).map((s) => s.toISOString());
    expect(slots).toContain(new Date(at(D2, "08:00")).toISOString());
  });

  it("remarcar para horário ocupado falha sem perder o agendamento original", async () => {
    const D3 = day(12);
    const a1 = await withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(D3, "08:00"), durationMin: 30 }, AGENT));
    await withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(D3, "09:00"), durationMin: 30 }, AGENT));
    await expect(withTenant(A, (db) => reschedule(db, A.orgId, A.userId, a1, at(D3, "09:00"), AGENT))).rejects.toThrow(/ocupado/);
    expect((await q<{ status: string }>("select status from appointments where id = $1", [a1]))[0].status).toBe("scheduled");
  });

  it("transições inválidas são recusadas", async () => {
    const id = await withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: contact, professionalId: prof, startsAt: at(day(13), "08:00"), durationMin: 30 }, AGENT));
    await expect(withTenant(A, (db) => setStatus(db, A.orgId, A.userId, id, "no_show"))).rejects.toThrow(/depois do horário/);
    await withTenant(A, (db) => setStatus(db, A.orgId, A.userId, id, "canceled", "Cliente desistiu"));
    await expect(withTenant(A, (db) => setStatus(db, A.orgId, A.userId, id, "confirmed"))).rejects.toThrow(/não permitida/);
  });
});

describe("isolamento", () => {
  it("outra empresa não vê agendamentos nem usa profissionais alheios", async () => {
    expect((await withTenant(B, (db) => db.query("select * from appointments"))).rowCount).toBe(0);
    const bContact = await withTenant(B, (db) => createContact(db, B.orgId, B.userId, { displayName: "X" }));
    await expect(withTenant(B, (db) => book(db, B.orgId, B.userId, { contactId: bContact, professionalId: prof, startsAt: at(D, "16:00"), durationMin: 30 }, MANAGER))).rejects.toThrow(/Profissional não encontrado/);
  });
});

describe("lembretes e confirmação pelo WhatsApp", () => {
  it("envia uma vez com variáveis, respeita descadastro e confirma com 'sim'", async () => {
    // número conectado + template aprovado
    const ch = (await q<{ id: string }>("insert into channel_accounts (organization_id, waba_id, phone_number_id, access_token_encrypted) values ($1,'1','PHONE_AG','x') returning id", [A.orgId]))[0].id;
    const { encryptSecret } = await import("@/lib/crypto");
    await withService((db) => db.query("update channel_accounts set access_token_encrypted = $2 where id = $1", [ch, encryptSecret("token")]));
    const tpl = (await q<{ id: string }>(`insert into message_templates (organization_id, channel_account_id, name, language, category, status, body_text, body_param_count)
      values ($1,$2,'lembrete','pt_BR','UTILITY','APPROVED','Olá {{1}}, seu horário é {{2}} às {{3}} com {{4}}. Responda SIM para confirmar.', 4) returning id`, [A.orgId, ch]))[0].id;
    await withService((db) => db.query("update organizations set reminder_template_id = $2, reminder_hours_before = 48 where id = $1", [A.orgId, tpl]));

    const soon = new Date(Date.now() + 26 * 3600_000);
    soon.setUTCMinutes(0, 0, 0);
    const apptId = (await q<{ id: string }>(`insert into appointments (organization_id, contact_id, professional_id, starts_at, ends_at) values ($1,$2,$3,$4,$4::timestamptz + interval '30 minutes') returning id`, [A.orgId, contact, prof, soon]))[0].id;
    const other = await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Sem Lembrete", phone: "11944443333" }));
    await withService((db) => db.query("insert into consent_records (organization_id, contact_id, purpose, status, source) values ($1,$2,'marketing','revoked','teste')", [A.orgId, other]));
    const otherAppt = (await q<{ id: string }>(`insert into appointments (organization_id, contact_id, professional_id, starts_at, ends_at) values ($1,$2,$3,$4::timestamptz + interval '1 hour',$4::timestamptz + interval '90 minutes') returning id`, [A.orgId, other, prof, soon]))[0].id;

    expect(await withService((db) => sendDueReminders(db))).toBe(1);
    expect(await withService((db) => sendDueReminders(db))).toBe(0); // não reenvia
    while ((await runOnce(50)) > 0) { /* drena a fila */ }
    expect(sent.at(-1)!.template).toBe("lembrete");
    expect(sent.at(-1)!.params![0]).toBe("Lucas");
    expect(sent.at(-1)!.params).toHaveLength(4);
    expect((await q<{ reminder_error: string }>("select reminder_error from appointments where id = $1", [otherAppt]))[0].reminder_error).toMatch(/não receber/);

    // cliente responde "Sim"
    const body = JSON.stringify(inboundPayload({ phoneNumberId: "PHONE_AG", from: "5511955554444", id: "wamid.sim", text: "Sim" }));
    await POST(new NextRequest("http://x/api/webhooks/whatsapp", { method: "POST", body, headers: { "x-hub-signature-256": sign(body) } }));
    while ((await runOnce(50)) > 0) { /* drena */ }
    const [a] = await q<{ status: string; confirmed_via: string }>("select status, confirmed_via from appointments where id = $1", [apptId]);
    expect(a).toMatchObject({ status: "confirmed", confirmed_via: "whatsapp" });
  });
});

describe("Radar da agenda", () => {
  it("alerta não confirmados e faltas; remarcar resolve a falta", async () => {
    await withService((db) => db.query("update opportunity_rules set threshold_hours = 48 where organization_id = $1 and kind = 'appointment_unconfirmed'", [A.orgId]));
    const c2 = await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Faltoso", phone: "11933332222" }));
    await q(`insert into appointments (organization_id, contact_id, professional_id, starts_at, ends_at, status) values ($1,$2,$3, now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', 'no_show')`, [A.orgId, c2, prof]);
    const c3 = await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Sem Confirmar", phone: "11922221111" }));
    await q(`insert into appointments (organization_id, contact_id, professional_id, starts_at, ends_at) values ($1,$2,$3, date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '30 hours 30 minutes')`, [A.orgId, c3, prof]);
    await withTenant(A, (db) => refreshRadar(db, A.orgId));
    const sig = await q<{ rule_kind: string; contact_id: string }>("select rule_kind, contact_id from opportunity_signals where organization_id = $1 and status = 'open' and rule_kind in ('no_show','appointment_unconfirmed')", [A.orgId]);
    expect(sig.find((s) => s.contact_id === c2)?.rule_kind).toBe("no_show");
    expect(sig.find((s) => s.contact_id === c3)?.rule_kind).toBe("appointment_unconfirmed");

    await withTenant(A, (db) => book(db, A.orgId, A.userId, { contactId: c2, professionalId: prof, startsAt: at(day(14), "08:00"), durationMin: 30 }, AGENT));
    await withTenant(A, (db) => refreshRadar(db, A.orgId));
    const after = await q("select * from opportunity_signals where contact_id = $1 and status = 'open' and rule_kind = 'no_show'", [c2]);
    expect(after).toHaveLength(0);
  });
});
