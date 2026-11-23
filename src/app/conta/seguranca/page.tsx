import Link from "next/link";
import { requireSession } from "@/lib/session";
import { mfaStatus } from "@/modules/mfa/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input, Notice } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { disableMfaAction, regenerateAction } from "./actions";
import { Enroll } from "./enroll";

export const metadata = { title: "Segurança da conta" };
export const dynamic = "force-dynamic";

export default async function Security({ searchParams }: { searchParams: Promise<{ obrigatorio?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const st = await mfaStatus(s.userId);
  return (
    <AuthShell title="Verificação em duas etapas" subtitle={`${s.userName} · ${s.userEmail}`} footer={<Link href="/app/settings#conta" className="text-primary hover:underline">Voltar para o app</Link>}>
      <div className="space-y-5">
        {sp.obrigatorio && !st.enabled && <Notice tone="money">{s.orgName} exige verificação em duas etapas para donos e gestores. Ative para continuar.</Notice>}
        {!st.enabled ? <Enroll /> : (
          <>
            <Notice tone="success">Ativa desde {dateTime(st.enabledAt)}. {st.recoveryRemaining} código(s) de recuperação disponível(is).</Notice>
            <details className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">Gerar novos códigos de recuperação</summary>
              <ActionForm action={regenerateAction} className="mt-3 space-y-2">
                <Field label="Código atual do aplicativo" htmlFor="rc"><Input id="rc" name="code" inputMode="numeric" maxLength={6} required /></Field>
                <SubmitButton size="sm" variant="secondary">Gerar novos códigos</SubmitButton>
              </ActionForm>
            </details>
            <details className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium text-danger">Desativar</summary>
              <ActionForm action={disableMfaAction} className="mt-3 space-y-2">
                <Field label="Senha" htmlFor="dp"><Input id="dp" name="password" type="password" autoComplete="current-password" required /></Field>
                <Field label="Código do aplicativo ou de recuperação" htmlFor="dc"><Input id="dc" name="code" required /></Field>
                <SubmitButton size="sm" variant="danger">Desativar verificação</SubmitButton>
              </ActionForm>
            </details>
          </>
        )}
      </div>
    </AuthShell>
  );
}
