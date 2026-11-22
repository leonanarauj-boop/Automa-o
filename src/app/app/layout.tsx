import { requireSession, tenant } from "@/lib/session";
import { logoutAction } from "../auth-actions";
import { Nav } from "@/components/nav";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const counts = await tenant(async (db) => {
    const r = await db.query<{ awaiting: string; signals: string }>(
      `select (select count(*) from conversations where status = 'open' and unread_count > 0) as awaiting,
              (select count(*) from opportunity_signals where status = 'open') as signals`,
    );
    return r.rows[0];
  });
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
          <p className="truncate text-sm font-medium">{s.orgName}</p>
          <p className="truncate text-xs text-muted">{s.userName}</p>
          <form action={logoutAction} className="mt-3"><button className="text-sm text-muted hover:text-text">Sair</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
