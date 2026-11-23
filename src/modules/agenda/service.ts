import { z } from "zod";
import type { Db } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { emitEvent } from "@/modules/automations/events";

export class AgendaError extends Error {}

const SLOT_STEP_MIN = 15;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM)");

// ---------------------------------------------------------------------------------------------
// Profissionais e horários
// ---------------------------------------------------------------------------------------------
export async function createProfessional(db: Db, orgId: string, userId: string, name: string) {
  const n = z.string().trim().min(1, "Informe o nome").max(120).parse(name);
  const r = await db.query<{ id: string }>("insert into professionals (organization_id, name) values ($1,$2) returning id", [orgId, n]);
  // Horário inicial sugerido: seg a sex, 08:00–12:00 e 13:00–18:00 (editável)
  for (let wd = 1; wd <= 5; wd++) {
    await db.query("insert into availability_rules (organization_id, professional_id, weekday, start_time, end_time) values ($1,$2,$3,'08:00','12:00'), ($1,$2,$3,'13:00','18:00')", [orgId, r.rows[0].id, wd]);
  }
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "professional.created", targetType: "professional", targetId: r.rows[0].id });
  return r.rows[0].id;
}

export const intervalSchema = z.object({ weekday: z.number().int().min(0).max(6), start: timeStr, end: timeStr })
  .refine((i) => i.end > i.start, { message: "O fim do intervalo deve ser depois do início" });

/** Substitui o horário semanal de um profissional. Intervalos do mesmo dia não podem se sobrepor. */
export async function setWeeklyHours(db: Db, orgId: string, professionalId: string, intervals: z.input<typeof intervalSchema>[]) {
  const list = z.array(intervalSchema).max(50).parse(intervals);
  for (let wd = 0; wd <= 6; wd++) {
    const day = list.filter((i) => i.weekday === wd).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < day.length; i++) if (day[i].start < day[i - 1].end) throw new AgendaError("Há intervalos sobrepostos no mesmo dia.");
  }
  const p = await db.query("select 1 from professionals where id = $1", [professionalId]);
  if (!p.rowCount) throw new AgendaError("Profissional não encontrado.");
  await db.query("delete from availability_rules where professional_id = $1", [professionalId]);
  for (const i of list) {
    await db.query("insert into availability_rules (organization_id, professional_id, weekday, start_time, end_time) values ($1,$2,$3,$4,$5)", [orgId, professionalId, i.weekday, i.start, i.end]);
  }
}

export async function addException(db: Db, orgId: string, professionalId: string, input: { date: string; start: string; end: string; reason?: string }) {
  const d = z.object({ date: dateStr, start: timeStr, end: timeStr, reason: z.string().trim().max(200).optional() }).parse(input);
  if (d.end <= d.start) throw new AgendaError("O fim do bloqueio deve ser depois do início.");
  const r = await db.query<{ conflicts: string }>(
    `with tz as (select timezone from organizations where id = $1),
     ins as (
       insert into availability_exceptions (organization_id, professional_id, starts_at, ends_at, reason)
       select $1, $2, ($3::date + $4::time) at time zone tz.timezone, ($3::date + $5::time) at time zone tz.timezone, $6 from tz
       returning starts_at, ends_at)
     select (select count(*) from appointments a, ins where a.professional_id = $2 and a.status in ('scheduled','confirmed')
             and tstzrange(a.starts_at, a.ends_at) && tstzrange(ins.starts_at, ins.ends_at)) as conflicts`,
    [orgId, professionalId, d.date, d.start, d.end, d.reason ?? null]);
  return Number(r.rows[0].conflicts); // agendamentos já existentes no período (não são cancelados automaticamente)
}

// ---------------------------------------------------------------------------------------------
// Disponibilidade
// ---------------------------------------------------------------------------------------------
/**
 * Horários livres de um profissional numa data (no fuso da organização), para uma duração.
 * Considera horário semanal, bloqueios, agendamentos ativos e o momento atual.
 */
export async function availableSlots(db: Db, orgId: string, professionalId: string, date: string, durationMin: number): Promise<Date[]> {
  dateStr.parse(date);
  const dur = z.number().int().min(5).max(720).parse(durationMin);
  const r = await db.query<{ start: Date }>(
    `with tz as (select timezone from organizations where id = $1),
     rules as (
       select (($3::date + r.start_time) at time zone tz.timezone) as s, (($3::date + r.end_time) at time zone tz.timezone) as e
       from availability_rules r, tz
       where r.professional_id = $2 and r.weekday = extract(dow from $3::date)),
     cand as (
       select gs as start, gs + make_interval(mins => $4) as finish
       from rules, generate_series(rules.s, rules.e - make_interval(mins => $4), make_interval(mins => $5)) gs)
     select start from cand
     where start > now()
       and exists (select 1 from professionals p where p.id = $2 and p.active)
       and not exists (select 1 from appointments a where a.professional_id = $2 and a.status in ('scheduled','confirmed')
                       and tstzrange(a.starts_at, a.ends_at) && tstzrange(cand.start, cand.finish))
       and not exists (select 1 from availability_exceptions x where x.professional_id = $2
                       and tstzrange(x.starts_at, x.ends_at) && tstzrange(cand.start, cand.finish))
     order by start`,
    [orgId, professionalId, date, dur, SLOT_STEP_MIN]);
  return r.rows.map((x) => x.start);
}

async function withinWorkingHours(db: Db, orgId: string, professionalId: string, start: Date, end: Date) {
  const r = await db.query<{ ok: boolean }>(
    `with tz as (select timezone from organizations where id = $1),
     l as (select ($3::timestamptz at time zone tz.timezone) as ls, ($4::timestamptz at time zone tz.timezone) as le from tz)
     select exists (
       select 1 from availability_rules r, l where r.professional_id = $2
         and r.weekday = extract(dow from l.ls) and l.ls::date = l.le::date
         and r.start_time <= l.ls::time and r.end_time >= l.le::time
     ) and not exists (
       select 1 from availability_exceptions x where x.professional_id = $2 and tstzrange(x.starts_at, x.ends_at) && tstzrange($3, $4)
     ) as ok`,
    [orgId, professionalId, start, end]);
  return r.rows[0].ok;
}

// ---------------------------------------------------------------------------------------------
// Agendamentos
// ---------------------------------------------------------------------------------------------
export const bookSchema = z.object({
  contactId: z.string().uuid("Selecione o cliente"),
  professionalId: z.string().uuid("Selecione o profissional"),
  serviceId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  startsAt: z.string().datetime({ offset: true, message: "Escolha um horário" }),
  durationMin: z.coerce.number().int().min(5, "Duração mínima de 5 minutos").max(720),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
  allowOutsideHours: z.boolean().default(false),
});

function mapConflict(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "23P01") throw new AgendaError("Este horário acabou de ser ocupado. Escolha outro.");
  throw e;
}

export async function book(db: Db, orgId: string, userId: string, input: z.input<typeof bookSchema>, opts: { canOverride: boolean }) {
  const d = bookSchema.parse(input);
  const start = new Date(d.startsAt);
  const end = new Date(start.getTime() + d.durationMin * 60_000);
  if (start.getTime() < Date.now() - 5 * 60_000) throw new AgendaError("Não é possível agendar no passado.");
  const refs = await db.query<{ contact: boolean; prof: boolean }>(
    "select exists(select 1 from contacts where id = $1 and deleted_at is null) contact, exists(select 1 from professionals where id = $2 and active) prof",
    [d.contactId, d.professionalId]);
  if (!refs.rows[0].contact) throw new AgendaError("Cliente não encontrado.");
  if (!refs.rows[0].prof) throw new AgendaError("Profissional não encontrado ou inativo.");
  if (d.serviceId && !(await db.query("select 1 from products_services where id = $1", [d.serviceId])).rowCount) throw new AgendaError("Serviço não encontrado.");
  if (!(await withinWorkingHours(db, orgId, d.professionalId, start, end))) {
    if (!(d.allowOutsideHours && opts.canOverride)) throw new AgendaError("Fora do horário de atendimento do profissional (ou em período bloqueado).");
  }
  const deal = await db.query<{ id: string }>("select id from deals where contact_id = $1 and status = 'open' order by created_at desc limit 1", [d.contactId]);
  let id: string;
  try {
    await db.query("savepoint book");
    const r = await db.query<{ id: string }>(
      `insert into appointments (organization_id, contact_id, professional_id, service_id, deal_id, starts_at, ends_at, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [orgId, d.contactId, d.professionalId, d.serviceId, deal.rows[0]?.id ?? null, start, end, d.notes, userId]);
    id = r.rows[0].id;
    await db.query("release savepoint book");
  } catch (e) {
    await db.query("rollback to savepoint book");
    mapConflict(e);
  }
  if (deal.rows[0]) await db.query("update deals set last_activity_at = now() where id = $1", [deal.rows[0].id]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "appointment.created", targetType: "appointment", targetId: id, metadata: d.allowOutsideHours ? { outsideHours: true } : undefined });
  return id;
}

type Status = "scheduled" | "confirmed" | "canceled" | "no_show" | "done";
const TRANSITIONS: Record<Status, Status[]> = {
  scheduled: ["confirmed", "canceled", "no_show", "done"],
  confirmed: ["scheduled", "canceled", "no_show", "done"],
  canceled: [],
  no_show: ["done"],
  done: ["no_show"],
};

export async function setStatus(db: Db, orgId: string, userId: string, appointmentId: string, status: Status, reason?: string) {
  const a = await db.query<{ status: Status; starts_at: Date; contact_id: string }>("select status, starts_at, contact_id from appointments where id = $1 for update", [appointmentId]);
  const cur = a.rows[0];
  if (!cur) throw new AgendaError("Agendamento não encontrado.");
  if (!TRANSITIONS[cur.status].includes(status)) throw new AgendaError("Mudança de status não permitida para este agendamento.");
  if ((status === "no_show" || status === "done") && cur.starts_at.getTime() > Date.now()) throw new AgendaError("Só é possível marcar falta ou atendimento depois do horário.");
  await db.query(
    `update appointments set status = $2, updated_at = now(),
       confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end,
       confirmed_via = case when $2 = 'confirmed' then 'user' else confirmed_via end,
       cancel_reason = case when $2 = 'canceled' then $3 else cancel_reason end
     where id = $1`,
    [appointmentId, status, reason?.trim().slice(0, 300) || null]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: `appointment.${status}`, targetType: "appointment", targetId: appointmentId });
  await emitEvent(db, orgId, "appointment.status_changed", { contactId: cur.contact_id, appointmentId }, { status });
}

/** Reagenda: cancela o original e cria um novo vinculado (histórico preservado), numa única transação. */
export async function reschedule(db: Db, orgId: string, userId: string, appointmentId: string, startsAt: string, opts: { canOverride: boolean; allowOutsideHours?: boolean }) {
  const a = await db.query<{ contact_id: string; professional_id: string; service_id: string | null; notes: string | null; status: Status; dur: number }>(
    "select contact_id, professional_id, service_id, notes, status, extract(epoch from (ends_at - starts_at))::int / 60 as dur from appointments where id = $1 for update", [appointmentId]);
  const cur = a.rows[0];
  if (!cur) throw new AgendaError("Agendamento não encontrado.");
  if (cur.status !== "scheduled" && cur.status !== "confirmed") throw new AgendaError("Só agendamentos ativos podem ser reagendados.");
  await db.query("update appointments set status = 'canceled', cancel_reason = 'Reagendado', updated_at = now() where id = $1", [appointmentId]);
  const id = await book(db, orgId, userId, {
    contactId: cur.contact_id, professionalId: cur.professional_id, serviceId: cur.service_id ?? "", startsAt, durationMin: cur.dur,
    notes: cur.notes ?? undefined, allowOutsideHours: opts.allowOutsideHours ?? false,
  }, opts);
  await db.query("update appointments set rescheduled_from = $2 where id = $1", [id, appointmentId]);
  return id;
}

// ---------------------------------------------------------------------------------------------
// Consultas para as telas
// ---------------------------------------------------------------------------------------------
export interface DayAppointment {
  id: string; contact_id: string; contact_name: string; professional_id: string; service_name: string | null;
  starts_at: Date; ends_at: Date; status: Status; start_min: number; end_min: number; is_demo: boolean; confirmed_via: string | null; reminder_sent_at: Date | null;
}

export async function dayView(db: Db, orgId: string, date: string) {
  dateStr.parse(date);
  const professionals = (await db.query<{ id: string; name: string }>("select id, name from professionals where active order by created_at")).rows;
  const appointments = (await db.query<DayAppointment>(
    `with tz as (select timezone from organizations where id = $1)
     select a.id, a.contact_id, c.display_name as contact_name, a.professional_id, s.name as service_name, a.starts_at, a.ends_at, a.status, a.is_demo,
            a.confirmed_via, a.reminder_sent_at,
            (extract(hour from a.starts_at at time zone tz.timezone) * 60 + extract(minute from a.starts_at at time zone tz.timezone))::int as start_min,
            (extract(hour from a.ends_at at time zone tz.timezone) * 60 + extract(minute from a.ends_at at time zone tz.timezone))::int as end_min
     from appointments a join contacts c on c.id = a.contact_id left join products_services s on s.id = a.service_id, tz
     where (a.starts_at at time zone tz.timezone)::date = $2::date and a.status <> 'canceled'
     order by a.starts_at`, [orgId, date])).rows;
  const hours = (await db.query<{ min_h: number | null; max_h: number | null; works: string[] | null }>(
    `select min(extract(hour from start_time))::int min_h, max(ceil(extract(epoch from end_time) / 3600))::int max_h,
            array_agg(distinct professional_id::text) filter (where weekday = extract(dow from $1::date)) works
     from availability_rules r join professionals p on p.id = r.professional_id and p.active`, [date])).rows[0];
  const startHour = Math.min(hours.min_h ?? 8, ...appointments.map((a) => Math.floor(a.start_min / 60)));
  const endHour = Math.max(hours.max_h ?? 18, ...appointments.map((a) => Math.ceil(a.end_min / 60)));
  return { professionals, appointments, startHour, endHour: Math.min(24, endHour), workingIds: new Set(hours.works ?? []) };
}

export async function appointmentDetail(db: Db, id: string) {
  const r = await db.query<{
    id: string; contact_id: string; contact_name: string; phone_e164: string | null; professional_id: string; professional_name: string;
    service_name: string | null; starts_at: Date; ends_at: Date; status: Status; notes: string | null; cancel_reason: string | null;
    confirmed_at: Date | null; confirmed_via: string | null; reminder_sent_at: Date | null; reminder_error: string | null; is_demo: boolean; dur: number;
  }>(
    `select a.*, c.display_name as contact_name, c.phone_e164, p.name as professional_name, s.name as service_name,
            extract(epoch from (a.ends_at - a.starts_at))::int / 60 as dur
     from appointments a join contacts c on c.id = a.contact_id join professionals p on p.id = a.professional_id
     left join products_services s on s.id = a.service_id where a.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function contactAppointments(db: Db, contactId: string) {
  return (await db.query<{ id: string; starts_at: Date; status: Status; professional_name: string; service_name: string | null }>(
    `select a.id, a.starts_at, a.status, p.name as professional_name, s.name as service_name
     from appointments a join professionals p on p.id = a.professional_id left join products_services s on s.id = a.service_id
     where a.contact_id = $1 order by a.starts_at desc limit 20`, [contactId])).rows;
}

export const STATUS_LABEL: Record<Status, string> = { scheduled: "Agendado", confirmed: "Confirmado", canceled: "Cancelado", no_show: "Faltou", done: "Atendido" };
export type AppointmentStatus = Status;

/** Visão semanal de um profissional: 7 dias a partir de `weekStart` (segunda-feira), no fuso da organização. */
export async function weekView(db: Db, orgId: string, weekStart: string, professionalId: string) {
  dateStr.parse(weekStart);
  const appointments = (await db.query<DayAppointment & { day: number }>(
    `with tz as (select timezone from organizations where id = $1)
     select a.id, a.contact_id, c.display_name as contact_name, a.professional_id, s.name as service_name, a.starts_at, a.ends_at, a.status, a.is_demo,
            a.confirmed_via, a.reminder_sent_at,
            ((a.starts_at at time zone tz.timezone)::date - $2::date) as day,
            (extract(hour from a.starts_at at time zone tz.timezone) * 60 + extract(minute from a.starts_at at time zone tz.timezone))::int as start_min,
            (extract(hour from a.ends_at at time zone tz.timezone) * 60 + extract(minute from a.ends_at at time zone tz.timezone))::int as end_min
     from appointments a join contacts c on c.id = a.contact_id left join products_services s on s.id = a.service_id, tz
     where a.professional_id = $3 and a.status <> 'canceled'
       and (a.starts_at at time zone tz.timezone)::date >= $2::date and (a.starts_at at time zone tz.timezone)::date < $2::date + 7
     order by a.starts_at`, [orgId, weekStart, professionalId])).rows;
  const rules = (await db.query<{ weekday: number; start_min: number; end_min: number }>(
    `select weekday, (extract(epoch from start_time) / 60)::int start_min, (extract(epoch from end_time) / 60)::int end_min
     from availability_rules where professional_id = $1`, [professionalId])).rows;
  const blocks = (await db.query<{ day: number; start_min: number; end_min: number; reason: string | null }>(
    `with tz as (select timezone from organizations where id = $1)
     select ((x.starts_at at time zone tz.timezone)::date - $2::date) as day,
            (extract(hour from x.starts_at at time zone tz.timezone) * 60 + extract(minute from x.starts_at at time zone tz.timezone))::int start_min,
            (extract(hour from x.ends_at at time zone tz.timezone) * 60 + extract(minute from x.ends_at at time zone tz.timezone))::int end_min, x.reason
     from availability_exceptions x, tz
     where x.professional_id = $3 and (x.starts_at at time zone tz.timezone)::date between $2::date and $2::date + 6`, [orgId, weekStart, professionalId])).rows;
  const minH = Math.min(8, ...rules.map((r) => Math.floor(r.start_min / 60)), ...appointments.map((a) => Math.floor(a.start_min / 60)));
  const maxH = Math.max(18, ...rules.map((r) => Math.ceil(r.end_min / 60)), ...appointments.map((a) => Math.ceil(a.end_min / 60)));
  return { appointments, rules, blocks, startHour: minH, endHour: Math.min(24, maxH) };
}

/** Segunda-feira da semana de uma data (YYYY-MM-DD). */
export function mondayOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}
