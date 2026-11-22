"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "./ui";

export type ActionResult = { ok?: boolean; error?: string; message?: string } | null;
type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Formulário com estado de envio, mensagem de erro/sucesso e reset opcional após sucesso. */
export function ActionForm({ action, children, className, resetOnSuccess = false, id }: {
  action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="mt-2 text-sm text-success">{state.message}</p>}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingText }: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; className?: string; pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={cx(buttonClass(variant, size), className)}>
      {pending ? pendingText ?? "Salvando…" : children}
    </button>
  );
}
