"use client";

import { useEffect, useState, useTransition } from "react";
import { getSlotsAction } from "./actions";
import { cx } from "@/components/ui";

/** Mostra os horários livres e grava o escolhido em um input hidden "startsAt". */
export function SlotPicker({ professionalId, date, durationMin }: { professionalId: string; date: string; durationMin: number }) {
  const [slots, setSlots] = useState<{ iso: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [pending, start] = useTransition();

  useEffect(() => {
    setChosen("");
    if (!professionalId || !date || !durationMin) { setSlots(null); return; }
    start(async () => {
      const r = await getSlotsAction(professionalId, date, durationMin);
      setError(r.error ?? null);
      setSlots(r.slots ?? []);
    });
  }, [professionalId, date, durationMin]);

  return (
    <div>
      <input type="hidden" name="startsAt" value={chosen} />
      {pending && <p className="text-sm text-muted">Buscando horários…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!pending && slots && slots.length === 0 && !error && <p className="text-sm text-muted">Nenhum horário livre nesta data.</p>}
      {!pending && slots && slots.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Horários disponíveis">
          {slots.map((s) => (
            <button key={s.iso} type="button" role="radio" aria-checked={chosen === s.iso} onClick={() => setChosen(s.iso)}
              className={cx("rounded-md border px-2.5 py-1 text-sm tabular-nums", chosen === s.iso ? "border-primary bg-primary text-on-primary" : "border-border bg-surface hover:border-primary")}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
