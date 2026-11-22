import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { loginAction } from "../auth-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { Logo } from "@/components/logo";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getSession()) redirect("/app");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center"><Logo className="text-lg" /></Link>
        <div className="rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">Entrar</h1>
          <p className="mt-1 text-sm text-muted">Acesse sua conta para continuar.</p>
          <ActionForm action={loginAction} className="mt-6 space-y-4">
            <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
            <Field label="Senha" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
            <SubmitButton className="w-full" pendingText="Entrando…">Entrar</SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-6 text-center text-sm text-muted">Ainda não tem conta? <Link href="/signup" className="font-medium text-primary hover:underline">Teste grátis por 14 dias</Link></p>
      </div>
    </main>
  );
}
