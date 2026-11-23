"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, buttonClass } from "@/components/ui";
import { confirmEnrollmentAction, startEnrollmentAction } from "./actions";

export function Enroll() {
  const [data, setData] = useState<{ secret?: string; qr?: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (codes) {
    return (
      <div className="space-y-3">
        <p className="font-medium text-success">Verificação em duas etapas ativada.</p>
        <p className="text-sm">Guarde estes códigos de recuperação em lugar seguro. Cada um funciona uma única vez se você perder o celular. Eles não serão mostrados de novo.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-4 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="flex gap-2">
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copiar códigos</button>
          <button type="button" className={buttonClass("primary", "sm")} onClick={() => router.push("/app")}>Já guardei, continuar</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-2">
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="button" disabled={pending} className={buttonClass()} onClick={() => start(async () => { const r = await startEnrollmentAction(); if (r.error) setError(r.error); else setData(r); })}>
          {pending ? "Preparando…" : "Ativar verificação em duas etapas"}
        </button>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => { const r = await confirmEnrollmentAction(code); if (r.error) setError(r.error); else setCodes(r.codes ?? []); }); }}>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>Escaneie o QR code ou digite a chave manualmente.</li>
        <li>Informe o código de 6 dígitos exibido.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data.qr} alt="QR code para o aplicativo autenticador" width={220} height={220} className="rounded-lg border border-border bg-white p-2" />
      <p className="text-xs text-muted">Chave manual: <code className="break-all font-mono text-text">{data.secret}</code></p>
      <Field label="Código de 6 dígitos" htmlFor="code"><Input id="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="max-w-40 text-center tracking-widest" /></Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className={buttonClass()} disabled={pending}>{pending ? "Confirmando…" : "Confirmar e ativar"}</button>
    </form>
  );
}
