"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, cx } from "@/components/ui";
import type { Segment } from "@/modules/campaigns/service";
import type { ParamSource } from "@/modules/messaging/template-send";
import { saveCampaignAction } from "./actions";
import { ParamMapping } from "./param-mapping";

interface Tpl { id: string; name: string; language: string; category: string; body_text: string | null; body_param_count: number }

export function CampaignEditor({ id, initial, templates, tags, stages }: {
  id: string;
  initial: { name: string; templateId: string | null; paramMapping: ParamSource[]; segment: Segment; maxRecipients: number };
  templates: Tpl[]; tags: { id: string; name: string }[]; stages: { id: string; name: string }[];
}) {
  const [name, setName] = useState(initial.name);
  const [templateId, setTemplateId] = useState(initial.templateId ?? "");
  const [params, setParams] = useState<ParamSource[]>(initial.paramMapping);
  const [seg, setSeg] = useState<Segment>(initial.segment);
  const [max, setMax] = useState(initial.maxRecipients);
  const tpl = templates.find((t) => t.id === templateId);
  const toggle = <K extends "tagIds" | "stageIds" | "temperatures">(k: K, v: string) =>
    setSeg({ ...seg, [k]: (seg[k] as string[]).includes(v) ? (seg[k] as string[]).filter((x) => x !== v) : [...(seg[k] as string[]), v] });
  const num = (v: string) => (v ? Math.max(1, Math.round(Number(v))) : null);
  const chip = (on: boolean) => cx("cursor-pointer rounded-full border px-2.5 py-1 text-sm", on ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2");
  const payload = JSON.stringify({ name, templateId: templateId || null, paramMapping: tpl ? params.slice(0, tpl.body_param_count) : [], segment: seg, maxRecipients: max });

  return (
    <ActionForm action={saveCampaignAction} className="space-y-6">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="payload" value={payload} />
      <Field label="Nome" htmlFor="cname"><Input id="cname" value={name} onChange={(e) => setName(e.target.value)} required /></Field>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Mensagem</h3>
        {templates.length === 0 ? <p className="text-sm text-muted">Nenhum template aprovado. Crie no Gerenciador do WhatsApp e sincronize em Configurações.</p> : (
          <Field label="Template aprovado" htmlFor="ctpl">
            <Select id="ctpl" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setParams([]); }}>
              <option value="">Selecione…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language} · {t.category.toLowerCase()})</option>)}
            </Select>
          </Field>
        )}
        {tpl && <>
          {tpl.body_text && <p className="rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">{tpl.body_text}</p>}
          <ParamMapping count={tpl.body_param_count} value={params} onChange={setParams} idPrefix="camp" />
        </>}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Quem recebe</h3>
        <p className="text-xs text-muted">Todos os filtros se somam. Contatos sem consentimento de marketing são excluídos automaticamente.</p>
        {tags.length > 0 && <div><p className="mb-1.5 text-sm">Com qualquer uma das etiquetas</p><div className="flex flex-wrap gap-2">{tags.map((t) => <button type="button" key={t.id} aria-pressed={seg.tagIds.includes(t.id)} className={chip(seg.tagIds.includes(t.id))} onClick={() => toggle("tagIds", t.id)}>{t.name}</button>)}</div></div>}
        <div><p className="mb-1.5 text-sm">Temperatura</p><div className="flex flex-wrap gap-2">{([["cold", "Frio"], ["warm", "Morno"], ["hot", "Quente"]] as const).map(([v, l]) => <button type="button" key={v} aria-pressed={seg.temperatures.includes(v)} className={chip(seg.temperatures.includes(v))} onClick={() => toggle("temperatures", v)}>{l}</button>)}</div></div>
        <div><p className="mb-1.5 text-sm">Com negócio na etapa</p><div className="flex flex-wrap gap-2">{stages.map((s) => <button type="button" key={s.id} aria-pressed={seg.stageIds.includes(s.id)} className={chip(seg.stageIds.includes(s.id))} onClick={() => toggle("stageIds", s.id)}>{s.name}</button>)}</div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Negócio aberto" htmlFor="copen">
            <Select id="copen" value={seg.hasOpenDeal === null ? "" : String(seg.hasOpenDeal)} onChange={(e) => setSeg({ ...seg, hasOpenDeal: e.target.value === "" ? null : e.target.value === "true" })}>
              <option value="">Indiferente</option><option value="true">Tem negócio aberto</option><option value="false">Sem negócio aberto</option>
            </Select>
          </Field>
          <Field label="Sem interação há pelo menos (dias)" htmlFor="cinact"><Input id="cinact" type="number" min={1} value={seg.inactiveDays ?? ""} onChange={(e) => setSeg({ ...seg, inactiveDays: num(e.target.value) })} /></Field>
          <Field label="Com interação nos últimos (dias)" htmlFor="cact"><Input id="cact" type="number" min={1} value={seg.activeDays ?? ""} onChange={(e) => setSeg({ ...seg, activeDays: num(e.target.value) })} /></Field>
          <Field label="Cadastrado nos últimos (dias)" htmlFor="cnew"><Input id="cnew" type="number" min={1} value={seg.createdWithinDays ?? ""} onChange={(e) => setSeg({ ...seg, createdWithinDays: num(e.target.value) })} /></Field>
          <Field label="Máximo de destinatários" htmlFor="cmax"><Input id="cmax" type="number" min={1} max={100000} value={max} onChange={(e) => setMax(Number(e.target.value) || 1)} /></Field>
        </div>
      </section>
      <SubmitButton>Salvar e atualizar pré-visualização</SubmitButton>
    </ActionForm>
  );
}
