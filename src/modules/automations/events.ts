import type { Db } from "@/lib/db";

export type EventType = "contact.created" | "message.received" | "deal.stage_changed" | "appointment.status_changed";

/**
 * Registra um evento de domínio na MESMA transação da mudança (outbox): se a mudança for desfeita,
 * o evento também é. O worker distribui os eventos para as automações ativas.
 */
export async function emitEvent(db: Db, orgId: string, type: EventType,
  refs: { contactId?: string | null; dealId?: string | null; appointmentId?: string | null }, payload: Record<string, unknown> = {}, depth = 0) {
  await db.query(
    "insert into domain_events (organization_id, type, contact_id, deal_id, appointment_id, payload, depth) values ($1,$2,$3,$4,$5,$6,$7)",
    [orgId, type, refs.contactId ?? null, refs.dealId ?? null, refs.appointmentId ?? null, JSON.stringify(payload), depth]);
}
