"use client";

import { useState, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, buttonClass } from "@/components/ui";
import { STEP_LABEL, TRIGGER_LABEL, type Definition, type Step, type Trigger } from "@/modules/automations/definition";
import { ParamMapping } from "../campaigns/param-mapping";
import { saveAutomationAction, simulateAction } from "./actions";

interface Opts {
  tags: { id: string; name: string }[]; stages: { id: string; name: string }[]; members: { id: string; name: string }[];
  templates: { id: string; name: string; category: string; body_param_count: number }[]; contacts: { id: string; name: string }[];
}

const DEFAULT_STEP: Record<Step["type"], (o: Opts) => Step> = {
  wait: () => ({ type: "wait", minutes: 60 }),
  condition: () => ({ type: "condition", check: { kind: "has_open_deal" }, negate: false }),
  add_tag: (o) => ({ type: "add_tag", tagId: o.tags[0]?.id ?? "" }),
  remove_tag: (o) => ({ type: "remove_tag", tagId: o.tags[0]?.id ?? "" }),
  set_temperature: () => ({ type: "set_temperature", value: "warm" }),
  assign_owner: () => ({ type: "assign_owner", mode: "round_robin", userId: null }),
  create_task: () => ({ type: "create_task", title: "", dueHours: 24 }),
  move_deal: (o) => ({ type: "move_deal", stageId: o.stages[0]?.id ?? "" }),
  send_template: (o) => ({ type: "send_template", templateId: o.templates[0]?.id ?? "", params: [] }),
  send_text: () => ({ type: "send_text", text: "" }),
  webhook: () => ({ type: "webhook", url: "https://" }),
};

function WaitEditor({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
  return (
    <div className="flex gap-2">
      <Input type="number" min={1} value={minutes / unit} aria-label="Quantidade" className="h-9 w-24" onChange={(e) => onChange(Math.max(1, Math.round(Number(e.target.value) || 1)) * unit)} />
      <Select value={unit} aria-label="Unidade" className="h-9 w-32" onChange={(e) => onChange(Math.max(1, Math.round(minutes / unit)) * Number(e.target.value))}>
        <option value={1}>minutos</option><option value={60}>horas</option><option value={1440}>dias</option>
      </Select>
    </div>
  );
}

function StepEditor({ step, set, o }: { step: Step; set: (s: Step) => void; o: Opts }) {
  switch (step.type) {
    case "wait": return <WaitEditor minutes={step.minutes} onChange={(minutes) => set({ ...step, minutes })} />;
    case "condition": {
      const c = step.check;
      return (
        <div className="flex flex-wrap gap-2">
          <Select value={step.negate ? "1" : "0"} aria-label="Sentido" className="h-9 w-28" onChange={(e) => set({ ...step, negate: e.target.value === "1" })}><option value="0">Se</option><option value="1">Se NÃO</option></Select>
          <Select value={c.kind} aria-label="Condição" className="h-9 w-56" onChange={(e) => {
            const k = e.target.value;
            const check = k === "has_tag" ? { kind: "has_tag" as const, tagId: o.tags[0]?.id ?? "" } : k === "temperature_is" ? { kind: "temperature_is" as const, value: "hot" as const }
              : k === "deal_in_stage" ? { kind: "deal_in_stage" as const, stageId: o.stages[0]?.id ?? "" } : { kind: k as "has_open_deal" | "replied_since_start" | "marketing_consent" };
            set({ ...step, check });
          }}>
            <option value="has_open_deal">tem negócio aberto</option><option value="deal_in_stage">negócio está na etapa</option><option value="has_tag">tem a etiqueta</option>
            <option value="temperature_is">temperatura é</option><option value="replied_since_start">respondeu desde o início</option><option value="marketing_consent">autorizou marketing</option>
          </Select>
          {c.kind === "has_tag" && <Select value={c.tagId} aria-label="Etiqueta" className="h-9 w-44" onChange={(e) => set({ ...step, check: { ...c, tagId: e.target.value } })}>{o.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
          {c.kind === "deal_in_stage" && <Select value={c.stageId} aria-label="Etapa" className="h-9 w-48" onChange={(e) => set({ ...step, check: { ...c, stageId: e.target.value } })}>{o.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          {c.kind === "temperature_is" && <Select value={c.value} aria-label="Temperatura" className="h-9 w-32" onChange={(e) => set({ ...step, check: { ...c, value: e.target.value as "hot" } })}><option value="cold">Frio</option><option value="warm">Morno</option><option value="hot">Quente</option></Select>}
          <span className="self-center text-xs text-muted">— senão, a execução para.</span>
        </div>
      );
    }
    case "add_tag": case "remove_tag":
      return <Select value={step.tagId} aria-label="Etiqueta" className="h-9 w-56" onChange={(e) => set({ ...step, tagId: e.target.value })}>{o.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>;
    case "set_temperature":
      return <Select value={step.value} aria-label="Temperatura" className="h-9 w-40" onChange={(e) => set({ ...step, value: e.target.value as "hot" })}><option value="cold">Frio</option><option value="warm">Morno</option><option value="hot">Quente</option></Select>;
    case "assign_owner":
      return (
        <div className="flex flex-wrap gap-2">
          <Select value={step.mode} aria-label="Modo" className="h-9 w-56" onChange={(e) => set({ ...step, mode: e.target.value as "user", userId: e.target.value === "user" ? o.members[0]?.id ?? null : null })}><option value="round_robin">Distribuir na equipe (rodízio)</option><option value="user">Pessoa específica</option></Select>
          {step.mode === "user" && <Select value={step.userId ?? ""} aria-label="Pessoa" className="h-9 w-48" onChange={(e) => set({ ...step, userId: e.target.value })}>{o.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
        </div>
      );
    case "create_task":
      return (
        <div className="flex flex-wrap gap-2">
          <Input value={step.title} placeholder="Título da tarefa" aria-label="Título da tarefa" className="h-9 min-w-56 flex-1" onChange={(e) => set({ ...step, title: e.target.value })} />
          <label className="flex items-center gap-1 text-sm">prazo <Input type="number" min={0} value={step.dueHours} aria-label="Prazo em horas" className="h-9 w-20" onChange={(e) => set({ ...step, dueHours: Math.max(0, Number(e.target.value) || 0) })} /> h</label>
        </div>
      );
    case "move_deal":
      return <Select value={step.stageId} aria-label="Etapa" className="h-9 w-56" onChange={(e) => set({ ...step, stageId: e.target.value })}>{o.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>;
    case "send_template": {
      const tpl = o.templates.find((t) => t.id === step.templateId);
      if (!o.templates.length) return <p className="text-xs text-danger">Nenhum template aprovado sincronizado.</p>;
      return (
        <div className="space-y-2">
          <Select value={step.templateId} aria-label="Template" className="h-9" onChange={(e) => set({ ...step, templateId: e.target.value, params: [] })}>{o.templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category.toLowerCase()})</option>)}</Select>
          {tpl && <ParamMapping count={tpl.body_param_count} value={step.params} idPrefix={`s-${step.templateId}`} onChange={(params) => set({ ...step, params })} />}
          <p className="text-xs text-muted">Não é enviado a quem pediu para sair; templates de marketing exigem consentimento registrado.</p>
        </div>
      );
    }
    case "send_text":
      return <Input value={step.text} placeholder="Mensagem (enviada apenas se o cliente escreveu nas últimas 24h)" aria-label="Mensagem" className="h-9" onChange={(e) => set({ ...step, text: e.target.value })} />;
    case "webhook":
      return <div className="space-y-1"><Input value={step.url} aria-label="URL do webhook" className="h-9" onChange={(e) => set({ ...step, url: e.target.value })} /><p className="text-xs text-muted">POST JSON com dados do contato, assinado no cabeçalho X-Retoma-Signature. Endereços internos são bloqueados.</p></div>;
  }
}

export function Builder({ id, name: initialName, initial, o, canEdit }: { id: string; name: string; initial: Definition; o: Opts; canEdit: boolean }) {
  const [name, setName] = useState(initialName);
  const [trigger, setTrigger] = useState<Trigger>(initial.trigger);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  const [adding, setAdding] = useState<Step["type"]>("create_task");
  const [sim, setSim] = useState<{ result?: { step: number; label: string; result: string }[]; error?: string } | null>(null);
  const [simContact, setSimContact] = useState(o.contacts[0]?.id ?? "");
  const [pending, start] = useTransition();
  const def: Definition = { trigger, steps };
  const move = (i: number, d: -1 | 1) => { const n = [...steps]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSteps(n); };

  return (
    <div className="space-y-6">
      <ActionForm action={saveAutomationAction} className="space-y-5">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="definition" value={JSON.stringify(def)} />
        <Field label="Nome" htmlFor="aname"><Input id="aname" name="name" value={name} onChange={(e) => setName(e.target.value)} required disabled={!canEdit} /></Field>

        <fieldset disabled={!canEdit} className="space-y-3">
          <div className="rounded-xl border border-primary/40 bg-primary-soft/40 p-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-primary uppercase">Quando</p>
            <div className="flex flex-wrap gap-2">
              <Select value={trigger.type} aria-label="Gatilho" className="h-9 w-64" onChange={(e) => {
                const t = e.target.value as Trigger["type"];
                setTrigger(t === "deal.stage_changed" ? { type: t, stageId: o.stages[0]?.id ?? null } : t === "appointment.status_changed" ? { type: t, status: "done" } : t === "conversation.no_reply" ? { type: t, hours: 48 } : { type: t });
              }}>
                {Object.entries(TRIGGER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              {trigger.type === "deal.stage_changed" && <Select value={trigger.stageId ?? ""} aria-label="Para a etapa" className="h-9 w-56" onChange={(e) => setTrigger({ ...trigger, stageId: e.target.value || null })}><option value="">qualquer etapa</option>{o.stages.map((s) => <option key={s.id} value={s.id}>para {s.name}</option>)}</Select>}
              {trigger.type === "appointment.status_changed" && <Select value={trigger.status ?? ""} aria-label="Status" className="h-9 w-48" onChange={(e) => setTrigger({ ...trigger, status: (e.target.value || null) as "done" })}><option value="">qualquer status</option><option value="confirmed">confirmado</option><option value="done">atendido</option><option value="no_show">faltou</option><option value="canceled">cancelado</option></Select>}
              {trigger.type === "conversation.no_reply" && <label className="flex items-center gap-1 text-sm">há <Input type="number" min={1} max={720} value={trigger.hours} aria-label="Horas sem resposta" className="h-9 w-20" onChange={(e) => setTrigger({ ...trigger, hours: Math.max(1, Number(e.target.value) || 1) })} /> horas depois da última mensagem da equipe</label>}
            </div>
          </div>

          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium"><span className="mr-2 text-muted">{i + 1}.</span>{STEP_LABEL[s.type]}</p>
                  {canEdit && <div className="flex gap-1 text-xs">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded px-1.5 py-0.5 hover:bg-surface-2 disabled:opacity-30" aria-label="Mover para cima">↑</button>
                    <button type="button" disabled={i === steps.length - 1} onClick={() => move(i, 1)} className="rounded px-1.5 py-0.5 hover:bg-surface-2 disabled:opacity-30" aria-label="Mover para baixo">↓</button>
                    <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="rounded px-1.5 py-0.5 text-danger hover:bg-danger-soft">Remover</button>
                  </div>}
                </div>
                <StepEditor step={s} o={o} set={(n) => setSteps(steps.map((x, j) => (j === i ? n : x)))} />
              </li>
            ))}
          </ol>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Select value={adding} aria-label="Tipo de passo" className="h-9 w-72" onChange={(e) => setAdding(e.target.value as Step["type"])}>
                {Object.entries(STEP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setSteps([...steps, DEFAULT_STEP[adding](o)])}>+ Adicionar passo</button>
            </div>
          )}
        </fieldset>
        {canEdit && <SubmitButton pendingText="Salvando…">Salvar nova versão</SubmitButton>}
      </ActionForm>

      {o.contacts.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-4">
          <p className="text-sm font-medium">Testar sem executar</p>
          <p className="text-xs text-muted">Simula a automação para um contato com os dados de agora. Nada é enviado nem alterado.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Select value={simContact} aria-label="Contato para simular" className="h-9 w-64" onChange={(e) => setSimContact(e.target.value)}>{o.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <button type="button" className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => start(async () => setSim(await simulateAction(JSON.stringify(def), simContact)))}>{pending ? "Simulando…" : "Simular"}</button>
          </div>
          {sim?.error && <p className="mt-2 text-sm text-danger">{sim.error}</p>}
          {sim?.result && <ol className="mt-3 space-y-1 text-sm">{sim.result.map((r) => <li key={r.step}><span className="text-muted">{r.step}. {r.label}:</span> {r.result}</li>)}</ol>}
        </div>
      )}
    </div>
  );
}
