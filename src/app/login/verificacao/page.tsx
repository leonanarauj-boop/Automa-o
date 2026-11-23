import Link from "next/link";
import { cookies } from "next/headers";
import { challengeIsValid } from "@/modules/mfa/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input } from "@/components/ui";
import { verifyMfaAction } from "../../auth-actions";

export const metadata = { title: "Verificação" };
export const dynamic = "force-dynamic";

export default async function MfaLogin() {
  const token = (await cookies()).get("retoma_mfa")?.value ?? "";
  if (!(await challengeIsValid(token))) {
    return <AuthShell title="Verificação expirada" subtitle="Entre novamente com e-mail e senha." footer={<Link href="/login" className="text-primary hover:underline">Ir para o login</Link>}><span /></AuthShell>;
  }
  return (
    <AuthShell title="Verificação em duas etapas" subtitle="Digite o código de 6 dígitos do seu aplicativo autenticador." footer={<Link href="/login" className="text-primary hover:underline">Voltar</Link>}>
      <ActionForm action={verifyMfaAction} className="space-y-4">
        <Field label="Código" htmlFor="code" hint="Sem acesso ao celular? Use um dos códigos de recuperação (formato xxxxx-xxxxx).">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={20} className="text-center text-lg tracking-widest" />
        </Field>
        <SubmitButton className="w-full" pendingText="Verificando…">Verificar</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
