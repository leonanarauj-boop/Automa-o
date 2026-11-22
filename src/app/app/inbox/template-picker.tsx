"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/action-form";
import { Input, Select } from "@/components/ui";

interface Tpl { id: string; name: string; language: string; category: string; body_text: string | null; body_param_count: number }

export function TemplatePicker({ templates }: { templates: Tpl[] }) {
  const [id, setId] = useState(templates[0]?.id);
  const [params, setParams] = useState<string[]>([]);
  const tpl = templates.find((t) => t.id === id);
  const preview = tpl?.body_text?.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`);
  return (
    <div className="space-y-2">
      <label htmlFor="templateId" className="sr-only">Template</label>
      <Select id="templateId" name="templateId" value={id} onChange={(e) => { setId(e.target.value); setParams([]); }}>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language} · {t.category.toLowerCase()})</option>)}
      </Select>
      {tpl && Array.from({ length: tpl.body_param_count }, (_, i) => (
        <Input key={`${tpl.id}-${i}`} name="param" required placeholder={`Variável {{${i + 1}}}`} aria-label={`Variável ${i + 1}`}
          value={params[i] ?? ""} onChange={(e) => { const p = [...params]; p[i] = e.target.value; setParams(p); }} />
      ))}
      {preview && <p className="rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">{preview}</p>}
      <SubmitButton pendingText="Enviando…">Enviar template</SubmitButton>
    </div>
  );
}
