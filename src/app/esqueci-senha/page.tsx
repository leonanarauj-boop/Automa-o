import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input } from "@/components/ui";
import { forgotPasswordAction } from "../auth-actions";

export const metadata = { title: "Esqueci minha senha" };

export default function ForgotPassword() {
  return (
    <AuthShell title="Esqueci minha senha" subtitle="Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha."
      footer={<Link href="/login" className="text-primary hover:underline">Voltar para o login</Link>}>
      <ActionForm action={forgotPasswordAction} className="space-y-4">
        <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <SubmitButton className="w-full" pendingText="Enviando…">Enviar link</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
