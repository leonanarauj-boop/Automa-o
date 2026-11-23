import { requireSession, tenant } from "@/lib/session";
import { redirect } from "next/navigation";
import { logoutAction, switchOrgAction } from "../auth-actions";
import { withService } from "@/lib/db";
import { Nav } from "@/components/nav";
import { Logo } from "@/components/logo";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  // Política da empresa: donos e gestores precisam da verificação em duas etapas
  if (s.requireMfa && s.role !== "agent" && !s.mfaEnabled) redirect("/conta/seguranca?obrigatorio=1");
  const counts = await tenant(async (db) => {
    const r = await db.query<{ awaiting: string; signals: string; status: string; trial_ends_at: Date }>(
      `select (select count(*) from conversations where status = 'open' and unread_count > 0) as awaiting,
              (select count(*) from opportunity_signals where status = 'open') as signals,
              o.status, o.trial_ends_at from organizations o limit 1`,
    );
    return r.rows[0];
  });
  const orgs = await withService((db) => db.query<{ id: string; name: string }>(
    "select o.id, o.name from memberships m join organizations o on o.id = m.organization_id where m.user_id = $1 and m.status = 'active' order by o.name", [s.userId])).then((r) => r.rows);
  return (
    <div className="min-h-dvh md:flex">
      <aside className="border-b border-border bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
          <Logo />
          <form action={logoutAction} className="md:hidden"><button className="text-sm text-muted hover:text-text">Sair</button></form>
        </div>
        <div className="px-2 pb-2 md:flex-1 md:px-3">
          <Nav badges={{ "/app/inbox": Number(counts.awaiting), "/app/radar": Number(counts.signals) }} />
        </div>
        <div className="hidden border-t border-border px-5 py-4 md:block">
          {orgs.length > 1 ? (
            <form action={switchOrgAction} className="flex gap-1">
              <select name="orgId" defaultValue={s.orgId} aria-label="Empresa" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-1 text-sm font-medium">
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button className="text-xs text-muted hover:text-text">Trocar</button>
            </form>
          ) : <p className="truncate text-sm font-medium">{s.orgName}</p>}
          <p className="truncate text-xs text-muted">{s.userName}</p>
          <form action={logoutAction} className="mt-3"><button className="text-sm text-muted hover:text-text">Sair</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <BillingBanner status={counts.status} trialEndsAt={counts.trial_ends_at} />
        {children}
      </main>
    </div>
  );
}

function BillingBanner({ status, trialEndsAt }: { status: string; trialEndsAt: Date }) {
  const days = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400_000);
  const msg = status === "suspended" ? { t: "Acesso restrito: envios, campanhas, automações e IA estão pausados.", c: "bg-danger-soft text-danger" }
    : status === "past_due" ? { t: "Há uma fatura vencida. Regularize para evitar a pausa dos envios.", c: "bg-money-soft text-money" }
    : status === "canceled" ? { t: "Assinatura encerrada. Escolha um plano para voltar a enviar mensagens.", c: "bg-danger-soft text-danger" }
    : status === "trial" && days <= 5 ? { t: `Seu teste grátis termina em ${Math.max(days, 0)} dia(s).`, c: "bg-info-soft text-text" } : null;
  if (!msg) return null;
  return (
    <div className={`mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-sm ${msg.c}`} role="status">
      <span>{msg.t}</span><Link href="/app/billing" className="font-medium underline">Ver assinatura</Link>
    </div>
  );
}
