"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const ITEMS = [
  { href: "/app", label: "Painel", icon: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" },
  { href: "/app/inbox", label: "Conversas", icon: "M4 4h16v12H7l-3 3V4Z" },
  { href: "/app/radar", label: "Radar", icon: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5 0 7-7" },
  { href: "/app/pipeline", label: "Funil", icon: "M4 5h4v14H4V5Zm6 0h4v9h-4V5Zm6 0h4v5h-4V5Z" },
  { href: "/app/contacts", label: "Contatos", icon: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75" },
  { href: "/app/knowledge", label: "Assistente IA", icon: "M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3Zm6 11 1 2.4 2.4 1-2.4 1L18 21l-1-2.6-2.4-1 2.4-1L18 14Z" },
  { href: "/app/tasks", label: "Tarefas", icon: "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" },
  { href: "/app/settings", label: "Configurações", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" },
];

export function Nav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {ITEMS.map((it) => {
        const active = it.href === "/app" ? path === "/app" : path.startsWith(it.href);
        const badge = badges[it.href];
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
            className={cx("flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-primary-soft font-medium text-primary" : "text-muted hover:bg-surface-2 hover:text-text")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={it.icon} /></svg>
            <span>{it.label}</span>
            {badge ? <span className="ml-auto rounded-full bg-money-soft px-1.5 text-xs font-semibold text-money">{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
