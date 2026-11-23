import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "./session";
import { isPlatformAdmin } from "@/modules/admin/service";

/**
 * Acesso ao painel da plataforma: administrador cadastrado + verificação em duas etapas ativa
 * e confirmada nesta sessão. Quem não é administrador recebe 404 (o painel não se revela).
 */
export async function requireAdmin() {
  const s = await requireSession();
  if (!(await isPlatformAdmin(s.userId))) notFound();
  if (!s.mfaEnabled) redirect("/conta/seguranca");
  if (!s.mfaVerified) redirect("/login?next=/admin");
  return s;
}
