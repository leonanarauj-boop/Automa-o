import Link from "next/link";
import { isResetTokenValid } from "@/modules/auth/password";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input } from "@/components/ui";
import { resetPasswordAction } from "../../auth-actions";

export const metadata = { title: "Nova senha" };
export const dynamic = "force-dynamic";

export default async function ResetPassword({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await isResetTokenValid(token))) {
    return <AuthShell title="Link inválido ou expirado" subtitle="Os links de redefinição valem por 60 minutos e podem ser usados uma vez." footer={<Link href="/esqueci-senha" className="text-primary hover:underline">Pedir um novo link</Link>}><span /></AuthShell>;
  }
  return (
    <AuthShell title="Criar nova senha" subtitle="Ao salvar, você entra automaticamente e as outras sessões abertas são encerradas.">
      <ActionForm action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="Nova senha" htmlFor="password" hint="Mínimo de 10 caracteres."><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirme a nova senha" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <SubmitButton className="w-full" pendingText="Salvando…">Salvar e entrar</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
