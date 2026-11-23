"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { bookAction } from "./actions";
import { SlotPicker } from "./slot-picker";

interface Opt { id: string; name: string }
interface Service extends Opt { duration_min: number | null }

export function NewAppointment({ contacts, professionals, services, date, canOverride, defaultContactId }: {
  contacts: Opt[]; professionals: Opt[]; services: Service[]; date: string; canOverride: boolean; defaultContactId?: string;
}) {
  const [prof, setProf] = useState(professionals[0]?.id ?? "");
  const [day, setDay] = useState(date);
  const [serviceId, setServiceId] = useState("");
  const [duration, setDuration] = useState(30);
  const [outside, setOutside] = useState(false);
  const [manualTime, setManualTime] = useState("");

  return (
    <ActionForm action={bookAction} resetOnSuccess className="space-y-3">
      <Field label="Cliente" htmlFor="contactId">
        <Select id="contactId" name="contactId" required defaultValue={defaultContactId ?? ""}>
          <option value="" disabled>Selecione…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Serviço" htmlFor="serviceId">
        <Select id="serviceId" name="serviceId" value={serviceId} onChange={(e) => {
          setServiceId(e.target.value);
          const s = services.find((x) => x.id === e.target.value);
          if (s?.duration_min) setDuration(s.duration_min);
        }}>
          <option value="">Sem serviço específico</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.duration_min ? ` (${s.duration_min} min)` : ""}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Profissional" htmlFor="professionalId">
          <Select id="professionalId" name="professionalId" value={prof} onChange={(e) => setProf(e.target.value)} required>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Duração (min)" htmlFor="durationMin">
          <Input id="durationMin" name="durationMin" type="number" min={5} max={720} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} required />
        </Field>
      </div>
      <Field label="Data" htmlFor="day"><Input id="day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required /></Field>
      {outside ? (
        <Field label="Horário (encaixe)" htmlFor="manualTime">
          <Input id="manualTime" type="time" value={manualTime} onChange={(e) => setManualTime(e.target.value)} required />
          <input type="hidden" name="startsAt" value={day && manualTime ? new Date(`${day}T${manualTime}:00-03:00`).toISOString() : ""} />
        </Field>
      ) : (
        <div className="space-y-1.5"><p className="text-sm font-medium">Horário</p><SlotPicker professionalId={prof} date={day} durationMin={duration} /></div>
      )}
      {canOverride && (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="allowOutsideHours" checked={outside} onChange={(e) => setOutside(e.target.checked)} className="accent-[var(--primary)]" />
          Encaixe fora do horário de atendimento
        </label>
      )}
      <Field label="Observações" htmlFor="notes"><Textarea id="notes" name="notes" rows={2} /></Field>
      <SubmitButton className="w-full" pendingText="Agendando…">Agendar</SubmitButton>
    </ActionForm>
  );
}
