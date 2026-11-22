"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, buttonClass } from "@/components/ui";
import { createDealAction } from "../actions";

export function NewDeal({ contacts, stages }: { contacts: { id: string; display_name: string }[]; stages: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className={buttonClass()} onClick={() => setOpen(true)}>Novo negócio</button>;
  if (contacts.length === 0) return <p className="text-sm text-muted">Cadastre um contato antes de criar negócios.</p>;
  return (
    <div className="w-full rounded-xl border border-border bg-surface p-4 sm:w-[28rem]">
      <ActionForm action={createDealAction} resetOnSuccess className="grid gap-3">
        <Field label="Contato" htmlFor="contactId"><Select id="contactId" name="contactId" required>{contacts.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</Select></Field>
        <Field label="Título" htmlFor="title"><Input id="title" name="title" required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$)" htmlFor="value"><Input id="value" name="value" inputMode="decimal" placeholder="0,00" /></Field>
          <Field label="Etapa" htmlFor="stageId"><Select id="stageId" name="stageId">{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        <div className="flex gap-2"><SubmitButton>Criar</SubmitButton><button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>Fechar</button></div>
      </ActionForm>
    </div>
  );
}
