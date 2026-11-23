"use client";

import { useState, useTransition } from "react";
import { Field, Input, Select, buttonClass } from "@/components/ui";
import { checkoutAction } from "./actions";

/** Dados de cobrança. O pagamento (Pix, boleto ou cartão) acontece na página segura do Asaas. */
export function CheckoutForm({ planKey, planName, defaultEmail, defaultName }: { planKey: string; planName: string; defaultEmail: string; defaultName: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className={buttonClass("primary", "sm") + " w-full"} onClick={() => setOpen(true)}>Assinar {planName}</button>;
  return (
    <form className="space-y-3 text-left" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setError(null);
      start(async () => {
        const r = await checkoutAction({ planKey, name: String(fd.get("name")), document: String(fd.get("document")), email: String(fd.get("email")), billingType: String(fd.get("billingType")), couponCode: String(fd.get("couponCode") ?? "") });
        if (r.error) { setError(r.error); return; }
        if (r.url) { setDone(r.url); window.location.assign(r.url); } else setDone("");
      });
    }}>
      <Field label="Nome ou razão social" htmlFor={`n-${planKey}`}><Input id={`n-${planKey}`} name="name" required defaultValue={defaultName} /></Field>
      <Field label="CPF ou CNPJ" htmlFor={`d-${planKey}`}><Input id={`d-${planKey}`} name="document" required inputMode="numeric" /></Field>
      <Field label="E-mail para as faturas" htmlFor={`e-${planKey}`}><Input id={`e-${planKey}`} name="email" type="email" required defaultValue={defaultEmail} /></Field>
      <Field label="Forma de pagamento" htmlFor={`b-${planKey}`}>
        <Select id={`b-${planKey}`} name="billingType" defaultValue="UNDEFINED">
          <option value="UNDEFINED">Escolher na fatura (Pix, boleto ou cartão)</option><option value="PIX">Pix</option><option value="BOLETO">Boleto</option><option value="CREDIT_CARD">Cartão de crédito</option>
        </Select>
      </Field>
      <Field label="Cupom (opcional)" htmlFor={`c-${planKey}`}><Input id={`c-${planKey}`} name="couponCode" /></Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {done === "" && <p role="status" className="text-sm text-success">Assinatura criada. A fatura aparecerá abaixo em instantes.</p>}
      <button className={buttonClass("primary", "sm") + " w-full"} disabled={pending}>{pending ? "Gerando fatura…" : "Continuar para o pagamento"}</button>
      <p className="text-xs text-muted">Você será levado à página segura do Asaas. Não armazenamos dados de cartão.</p>
    </form>
  );
}
