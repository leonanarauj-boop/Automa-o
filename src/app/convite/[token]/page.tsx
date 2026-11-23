import Link from "next/link";
import { getSession } from "@/lib/session";
import { findInvite } from "@/modules/team/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input, Notice } from "@/components/ui";
import { acceptInviteLoggedAction, acceptInviteNewAction, logoutAction } from "../../auth-actions";

export const metadata = { title: "Convite" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInvite(token);
  if (!inv) {
    return <AuthShell title="Convite inválido ou expirado" subtitle="Peça a quem convidou para enviar um novo convite." footer={<Link href="/login" className="text-primary hover:underline">Ir para o login</Link>}><span /></AuthShell>;
  }
  const session = await getSession();
  const role = inv.role === "manager" ? "gestor(a)" : "atendente";
  const subtitle = <>{inv.inviter ?? "Alguém"} convidou <strong>{inv.email}</strong> para a equipe de <strong>{inv.org_name}</strong> como {role}.</>;

  if (session) {
    if (session.userEmail.toLowerCase() !== inv.email.toLowerCase()) {
      return (
        <AuthShell title="Convite para outra conta" subtitle={subtitle}>
          <Notice>Você está conectado como {session.userEmail}. Saia e entre com {inv.email} para aceitar.</Notice>
          <form action={logoutAction} className="mt-4"><button className="text-sm text-primary hover:underline">Sair desta conta</button></form>
        </AuthShell>
      );
    }
    return (
      <AuthShell title={`Entrar na equipe de ${inv.org_name}`} subtitle={subtitle}>
        <ActionForm action={acceptInviteLoggedAction}><input type="hidden" name="token" value={token} /><SubmitButton className="w-full" pendingText="Entrando…">Aceitar convite</SubmitButton></ActionForm>
      </AuthShell>
    );
  }
  if (inv.existing_user_id) {
    return (
      <AuthShell title={`Entrar na equipe de ${inv.org_name}`} subtitle={subtitle}>
        <p className="text-sm">Você já tem uma conta com este e-mail. Entre para aceitar o convite.</p>
        <Link href={`/login?next=${encodeURIComponent(`/convite/${token}`)}&email=${encodeURIComponent(inv.email)}`} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-on-primary hover:bg-primary-strong">Entrar e aceitar</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Entrar na equipe de ${inv.org_name}`} subtitle={subtitle}>
      <ActionForm action={acceptInviteNewAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="E-mail" htmlFor="email"><Input id="email" value={inv.email} disabled /></Field>
        <Field label="Seu nome" htmlFor="fullName"><Input id="fullName" name="fullName" autoComplete="name" required minLength={2} /></Field>
        <Field label="Crie uma senha" htmlFor="password" hint="Mínimo de 10 caracteres."><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirme a senha" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <SubmitButton className="w-full" pendingText="Criando conta…">Criar conta e entrar</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
