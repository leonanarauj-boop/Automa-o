"use client";

import { useEffect } from "react";
import type { ParamSource } from "@/modules/messaging/template-send";

/** Padrão: {{1}} = primeiro nome; demais = texto fixo a preencher. */
export function normalizeParams(count: number, value: ParamSource[]): ParamSource[] {
  return Array.from({ length: count }, (_, i) => value[i] ?? (i === 0 ? { source: "first_name" as const } : { source: "fixed" as const, value: "" }));
}
import { Input, Select } from "@/components/ui";

/** Editor das variáveis {{n}} de um template: primeiro nome, nome completo ou texto fixo. */
export function ParamMapping({ count, value, onChange, idPrefix }: { count: number; value: ParamSource[]; onChange: (v: ParamSource[]) => void; idPrefix: string }) {
  const rows = normalizeParams(count, value);
  // mantém o estado do formulário igual ao que está na tela (inclusive os valores padrão)
  useEffect(() => { if (value.length !== count) onChange(normalizeParams(count, value)); }, [count, value, onChange]);
  if (count === 0) return <p className="text-xs text-muted">Este template não tem variáveis.</p>;
  const set = (i: number, p: ParamSource) => { const next = [...rows]; next[i] = p; onChange(next); };
  return (
    <div className="space-y-2">
      {rows.map((p, i) => (
        <div key={i} className="grid grid-cols-[3rem_10rem_1fr] items-center gap-2 text-sm">
          <span className="font-mono text-muted">{`{{${i + 1}}}`}</span>
          <Select aria-label={`Origem da variável ${i + 1}`} id={`${idPrefix}-src-${i}`} value={p.source} className="h-9" onChange={(e) => set(i, { source: e.target.value as ParamSource["source"], value: p.value })}>
            <option value="first_name">Primeiro nome</option><option value="full_name">Nome completo</option><option value="fixed">Texto fixo</option>
          </Select>
          {p.source === "fixed" ? <Input aria-label={`Texto da variável ${i + 1}`} value={p.value ?? ""} className="h-9" onChange={(e) => set(i, { source: "fixed", value: e.target.value })} /> : <span className="text-xs text-muted">preenchido por contato</span>}
        </div>
      ))}
    </div>
  );
}
