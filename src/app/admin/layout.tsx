import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Administração", template: "%s · Administração" }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Logo /><span className="rounded bg-money-soft px-2 py-0.5 text-xs font-semibold text-money">Administração da plataforma</span>
          <nav className="flex gap-1 text-sm" aria-label="Administração">
            {[["/admin", "Visão geral"], ["/admin/empresas", "Empresas"], ["/admin/cupons", "Cupons"], ["/admin/saude", "Saúde"]].map(([h, l]) => (
              <Link key={h} href={h} className="rounded-md px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">{l}</Link>
            ))}
          </nav>
          <span className="ml-auto text-xs text-muted">{s.userEmail} · <Link href="/app" className="hover:underline">voltar ao app</Link></span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="mb-6 text-xs text-muted">Este painel mostra apenas dados agregados e operacionais. Conversas, contatos e conteúdos dos clientes não são acessíveis aqui. Todas as ações ficam registradas, inclusive no histórico da empresa afetada.</p>
        {children}
      </main>
    </div>
  );
}
