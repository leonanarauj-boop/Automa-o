"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Input } from "@/components/ui";
import { rescheduleAction, setStatusAction } from "./actions";
import { SlotPicker } from "./slot-picker";

const LABEL: Record<string, string> = { scheduled: "Agendado", confirmed: "Confirmado", canceled: "Cancelado", no_show: "Faltou", done: "Atendido" };
const TONE: Record<string, "primary" | "success" | "danger" | "neutral"> = { scheduled: "primary", confirmed: "success", canceled: "neutral", no_show: "danger", done: "neutral" };

export interface PanelData {
  id: string; contact_id: string; contact_name: string; phone: string; professional_id: string; professional_name: string; service_name: string | null;
  when: string; status: string; notes: string | null; cancel_reason: string | null; confirmed_via: string | null; reminder: string | null; reminder_error: string | null;
  dur: number; past: boolean; is_demo: boolean; date: string; conversationId: string | null;
}

function StatusButton({ id, status, label, variant = "secondary" }: { id: string; status: string; label: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={setStatusAction}>
      <input type="hidden" name="appointmentId" value={id} /><input type="hidden" name="status" value={status} />
      <SubmitButton size="sm" variant={variant} pendingText="…">{label}</SubmitButton>
    </ActionForm>
  );
}

export function AppointmentPanel({ a }: { a: PanelData }) {
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [day, setDay] = useState(a.date);
  const active = a.status === "scheduled" || a.status === "confirmed";
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="flex items-center gap-2"><Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge>{a.is_demo && <Badge tone="money">DEMO</Badge>}</div>
        <Link href={`/app/contacts/${a.contact_id}`} className="mt-2 block text-base font-semibold hover:underline">{a.contact_name}</Link>
        <p className="text-muted">{a.phone}</p>
      </div>
      <dl className="space-y-1">
        <div><dt className="inline text-muted">Quando: </dt><dd className="inline">{a.when} ({a.dur} min)</dd></div>
        <div><dt className="inline text-muted">Profissional: </dt><dd className="inline">{a.professional_name}</dd></div>
        {a.service_name && <div><dt className="inline text-muted">Serviço: </dt><dd className="inline">{a.service_name}</dd></div>}
        {a.notes && <div><dt className="inline text-muted">Obs.: </dt><dd className="inline">{a.notes}</dd></div>}
        {a.confirmed_via && <div><dt className="inline text-muted">Confirmado: </dt><dd className="inline">{a.confirmed_via === "whatsapp" ? "pelo cliente no WhatsApp" : "pela equipe"}</dd></div>}
        {a.reminder && <div><dt className="inline text-muted">Lembrete: </dt><dd className="inline">enviado {a.reminder}</dd></div>}
        {a.reminder_error && <div className="text-danger">Lembrete não enviado: {a.reminder_error}</div>}
        {a.cancel_reason && <div><dt className="inline text-muted">Motivo: </dt><dd className="inline">{a.cancel_reason}</dd></div>}
      </dl>

      {mode === "view" && (
        <div className="flex flex-wrap gap-2">
          {a.status === "scheduled" && <StatusButton id={a.id} status="confirmed" label="Confirmar presença" variant="primary" />}
          {a.past && active && <StatusButton id={a.id} status="done" label="Atendido" variant="primary" />}
          {a.past && active && <StatusButton id={a.id} status="no_show" label="Faltou" variant="danger" />}
          {active && <button type="button" className="h-8 rounded-lg border border-border px-3 hover:bg-surface-2" onClick={() => setMode("reschedule")}>Remarcar</button>}
          {active && <button type="button" className="h-8 rounded-lg px-3 text-danger hover:bg-danger-soft" onClick={() => setMode("cancel")}>Cancelar</button>}
          {a.conversationId && <Link href={`/app/inbox?c=${a.conversationId}`} className="h-8 rounded-lg px-3 leading-8 text-primary hover:underline">Abrir conversa</Link>}
        </div>
      )}
      {mode === "reschedule" && (
        <ActionForm action={rescheduleAction} className="space-y-2">
          <input type="hidden" name="appointmentId" value={a.id} />
          <label className="block text-sm font-medium" htmlFor="rday">Nova data</label>
          <Input id="rday" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <SlotPicker professionalId={a.professional_id} date={day} durationMin={a.dur} />
          <div className="flex gap-2"><SubmitButton size="sm" pendingText="Remarcando…">Confirmar remarcação</SubmitButton>
            <button type="button" className="text-sm text-muted" onClick={() => setMode("view")}>Voltar</button></div>
        </ActionForm>
      )}
      {mode === "cancel" && (
        <ActionForm action={setStatusAction} className="space-y-2">
          <input type="hidden" name="appointmentId" value={a.id} /><input type="hidden" name="status" value="canceled" />
          <Input name="reason" placeholder="Motivo do cancelamento (opcional)" aria-label="Motivo" />
          <div className="flex gap-2"><SubmitButton size="sm" variant="danger" pendingText="Cancelando…">Cancelar agendamento</SubmitButton>
            <button type="button" className="text-sm text-muted" onClick={() => setMode("view")}>Voltar</button></div>
        </ActionForm>
      )}
    </div>
  );
}
