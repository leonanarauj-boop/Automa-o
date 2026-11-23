"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { buttonClass, cx } from "./ui";

export type ActionResult = { ok?: boolean; error?: string; message?: string } | null;
type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

const PendingContext = createContext(false);

/**
 * Formulário com estado de envio, mensagem de erro/sucesso e reset opcional após sucesso.
 * O envio é feito manualmente (sem o reset automático do React 19 em <form action>), para que
 * campos controlados nunca fiquem diferentes do que está salvo.
 */
export function ActionForm({ action, children, className, resetOnSuccess = false, id }: {
  action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} className={className} id={id} aria-busy={pending} onSubmit={(e) => {
      e.preventDefault();
      if (pending) return;
      const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
      startTransition(() => formAction(fd));
    }}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="mt-2 text-sm text-success">{state.message}</p>}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingText }: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; className?: string; pendingText?: string;
}) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={cx(buttonClass(variant, size), className)}>
      {pending ? pendingText ?? "Salvando…" : children}
    </button>
  );
}
