import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex justify-center"><Logo className="text-lg" /></Link>
        <div className="rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <p className="mt-6 text-center text-sm text-muted">{footer}</p>}
      </div>
    </main>
  );
}
