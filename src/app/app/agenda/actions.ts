"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, tenant } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { AgendaError, addException, availableSlots, book, createProfessional, reschedule, setStatus, setWeeklyHours, type AppointmentStatus } from "@/modules/agenda/service";
import { refreshRadar } from "@/modules/radar/service";
import type { SessionInfo } from "@/modules/auth/service";

const uuid = (v: string) => z.string().uuid("Identificador inválido").parse(v);
const isManager = (s: SessionInfo) => s.role !== "agent";
function requireManager(s: SessionInfo) {
  if (!isManager(s)) throw new AgendaError("Apenas gestores e o dono da conta podem alterar a configuração da agenda.");
}
function revalidateAgenda() {
  revalidatePath("/app/agenda", "layout");
  revalidatePath("/app/radar");
  revalidatePath("/app/contacts", "layout");
}

export async function getSlotsAction(professionalId: string, date: string, durationMin: number): Promise<{ slots?: { iso: string; label: string }[]; error?: string }> {
  try {
    const slots = await tenant((db, s) => availableSlots(db, s.orgId, uuid(professionalId), date, durationMin));
    return { slots: slots.map((d) => ({ iso: d.toISOString(), label: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) })) };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : e instanceof AgendaError ? e.message : "Não foi possível consultar os horários." };
  }
}

export async function bookAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => {
      await book(db, s.orgId, s.userId, {
        contactId: str(fd, "contactId"), professionalId: str(fd, "professionalId"), serviceId: str(fd, "serviceId"), startsAt: str(fd, "startsAt"),
        durationMin: str(fd, "durationMin"), notes: str(fd, "notes"), allowOutsideHours: fd.get("allowOutsideHours") === "on",
      }, { canOverride: isManager(s) });
      await refreshRadar(db, s.orgId);
    });
    revalidateAgenda();
    return "Agendamento criado.";
  });
}

export async function setStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const status = z.enum(["scheduled", "confirmed", "canceled", "no_show", "done"]).parse(str(fd, "status")) as AppointmentStatus;
    await tenant(async (db, s) => {
      await setStatus(db, s.orgId, s.userId, uuid(str(fd, "appointmentId")), status, str(fd, "reason"));
      await refreshRadar(db, s.orgId);
    });
    revalidateAgenda();
  });
}

export async function rescheduleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => {
      await reschedule(db, s.orgId, s.userId, uuid(str(fd, "appointmentId")), str(fd, "startsAt"), { canOverride: isManager(s) });
      await refreshRadar(db, s.orgId);
    });
    revalidateAgenda();
    return "Agendamento remarcado.";
  });
}

// ---------- Configuração ----------
export async function createProfessionalAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => { requireManager(s); await createProfessional(db, s.orgId, s.userId, str(fd, "name")); });
    revalidateAgenda();
    return "Profissional adicionado com horário padrão (seg a sex). Ajuste abaixo se precisar.";
  });
}

export async function toggleProfessionalAction(fd: FormData) {
  await tenant(async (db, s) => { requireManager(s); await db.query("update professionals set active = not active where id = $1", [uuid(str(fd, "id"))]); });
  revalidateAgenda();
}

/** Formulário com até 2 intervalos por dia: s{dia}a, e{dia}a, s{dia}b, e{dia}b. */
export async function saveHoursAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const intervals: { weekday: number; start: string; end: string }[] = [];
    for (let wd = 0; wd <= 6; wd++) {
      for (const part of ["a", "b"]) {
        const start = str(fd, `s${wd}${part}`);
        const end = str(fd, `e${wd}${part}`);
        if (!start && !end) continue;
        if (!start || !end) throw new AgendaError("Preencha início e fim de cada intervalo (ou deixe ambos vazios).");
        intervals.push({ weekday: wd, start, end });
      }
    }
    await tenant(async (db, s) => { requireManager(s); await setWeeklyHours(db, s.orgId, uuid(str(fd, "professionalId")), intervals); });
    revalidateAgenda();
    return "Horários salvos.";
  });
}

export async function addExceptionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const conflicts = await tenant(async (db, s) => {
      requireManager(s);
      return addException(db, s.orgId, uuid(str(fd, "professionalId")), { date: str(fd, "date"), start: str(fd, "start"), end: str(fd, "end"), reason: str(fd, "reason") || undefined });
    });
    revalidateAgenda();
    return conflicts ? `Bloqueio criado. Atenção: ${conflicts} agendamento(s) já existente(s) no período continuam marcados — remarque-os.` : "Bloqueio criado.";
  });
}

export async function deleteExceptionAction(fd: FormData) {
  await tenant(async (db, s) => { requireManager(s); await db.query("delete from availability_exceptions where id = $1", [uuid(str(fd, "id"))]); });
  revalidateAgenda();
}

export async function saveReminderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const hours = z.coerce.number().int().min(1, "Mínimo 1 hora").max(168, "Máximo 7 dias").parse(str(fd, "hours"));
    const tpl = str(fd, "templateId");
    await tenant(async (db, s) => {
      requireManager(s);
      if (tpl) {
        const t = await db.query<{ status: string; body_param_count: number }>("select status, body_param_count from message_templates where id = $1", [uuid(tpl)]);
        if (!t.rowCount) throw new AgendaError("Template não encontrado.");
        if (t.rows[0].status !== "APPROVED") throw new AgendaError("Escolha um template aprovado pela Meta.");
        if (t.rows[0].body_param_count > 5) throw new AgendaError("O template pode ter no máximo 5 variáveis.");
      }
      await db.query("update organizations set reminder_hours_before = $1, reminder_template_id = $2, updated_at = now() where id = $3", [hours, tpl || null, s.orgId]);
    });
    revalidateAgenda();
    return tpl ? "Lembretes automáticos ativados." : "Lembretes automáticos desativados.";
  });
}

export async function currentRole() {
  return (await requireSession()).role;
}
