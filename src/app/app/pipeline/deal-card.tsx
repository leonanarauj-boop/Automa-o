"use client";

import { useActionState, useState, type ReactNode } from "react";
import { moveDealAction, updateDealValueAction } from "../actions";
import { Input, Select, buttonClass } from "@/components/ui";

interface Stage { id: string; name: string; kind: "open" | "won" | "lost" }

const brl = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100);

export function DealCard({ deal, stages, header, meta }: { deal: { id: string; title: string; value: number; stageId: string }; stages: Stage[]; header: ReactNode; meta: string }) {
  const [moveState, moveAction, moving] = useActionState(moveDealAction, null);
  const [valState, valAction, saving] = useActionState(updateDealValueAction, null);
  const [target, setTarget] = useState(deal.stageId);
  const [editing, setEditing] = useState(false);
  const targetKind = stages.find((s) => s.id === target)?.kind;

  return (
    <article className={`rounded-lg border border-border bg-surface p-3 text-sm shadow-sm ${moving ? "opacity-60" : ""}`}>
      <div>{header}</div>
      <p className="mt-0.5 text-muted">{deal.title}</p>
      {editing ? (
        <form action={async (fd) => { await valAction(fd); setEditing(false); }} className="mt-2 flex gap-1">
          <input type="hidden" name="dealId" value={deal.id} />
          <Input name="value" defaultValue={(deal.value / 100).toFixed(2).replace(".", ",")} inputMode="decimal" aria-label="Valor em reais" className="h-8" autoFocus />
          <button className={buttonClass("primary", "sm")} disabled={saving}>OK</button>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-2 font-semibold tabular-nums hover:underline" title="Editar valor">
          {deal.value ? brl(deal.value) : "Definir valor"}
        </button>
      )}
      <form action={moveAction} className="mt-2 space-y-1">
        <input type="hidden" name="dealId" value={deal.id} />
        <label className="sr-only" htmlFor={`st-${deal.id}`}>Mover para etapa</label>
        <div className="flex gap-1">
          <Select id={`st-${deal.id}`} name="stageId" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 text-xs">
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {target !== deal.stageId && <button className={buttonClass("primary", "sm")} disabled={moving}>Mover</button>}
        </div>
        {target !== deal.stageId && targetKind === "lost" && <Input name="lostReason" placeholder="Motivo da perda (opcional)" className="h-8 text-xs" />}
      </form>
      <p className="mt-2 text-xs text-muted">{meta}</p>
      {(moveState?.error || valState?.error) && <p role="alert" className="mt-1 text-xs text-danger">{moveState?.error ?? valState?.error}</p>}
    </article>
  );
}
