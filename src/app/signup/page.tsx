import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { signupAction } from "../auth-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { Logo } from "@/components/logo";
import { SEGMENTS } from "@/modules/onboarding/segments";

export const metadata = { title: "Criar conta" };

export default async function SignupPage() {
  if (await getSession()) redirect("/app");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex justify-center"><Logo className="text-lg" /></Link>
        <div className="rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">Crie sua conta</h1>
          <p className="mt-1 text-sm text-muted">14 dias grátis, sem cartão. Seu funil já vem configurado para o seu segmento.</p>
          <ActionForm action={signupAction} className="mt-6 space-y-4">
            <Field label="Seu nome" htmlFor="fullName"><Input id="fullName" name="fullName" autoComplete="name" required minLength={2} /></Field>
            <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
            <Field label="Senha" htmlFor="password" hint="Mínimo de 10 caracteres."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
            <Field label="Nome da empresa" htmlFor="orgName"><Input id="orgName" name="orgName" autoComplete="organization" required minLength={2} /></Field>
            <Field label="Segmento" htmlFor="segment" hint="Usamos para sugerir etapas do funil, etiquetas e alertas do Radar. Tudo pode ser ajustado depois.">
              <Select id="segment" name="segment" defaultValue="clinica">
                {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </Field>
            <SubmitButton className="w-full" pendingText="Criando conta…">Criar conta</SubmitButton>
            <p className="text-xs text-muted">Versão de pré-lançamento. Termos de Uso e Política de Privacidade serão publicados antes da abertura comercial.</p>
          </ActionForm>
        </div>
        <p className="mt-6 text-center text-sm text-muted">Já tem conta? <Link href="/login" className="font-medium text-primary hover:underline">Entrar</Link></p>
      </div>
    </main>
  );
}
