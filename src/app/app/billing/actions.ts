"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { BillingError, cancelSubscription, changePlan, checkout, refreshInvoices } from "@/modules/billing/service";
import type { SessionInfo } from "@/modules/auth/service";

function requireBillingAdmin(s: SessionInfo) {
  if (s.role === "agent") throw new BillingError("Apenas o dono ou gestores podem gerenciar a assinatura.");
}

export async function checkoutAction(input: { planKey: string; name: string; document: string; email: string; billingType: string; couponCode: string }): Promise<{ url?: string | null; error?: string }> {
  const r = { url: null as string | null };
  const res = await safeAction(async () => {
    const s = await requireSession();
    requireBillingAdmin(s);
    r.url = (await checkout(s.orgId, s.userId, input as never)).invoiceUrl;
  });
  revalidatePath("/app", "layout");
  return res?.error ? { error: res.error } : { url: r.url };
}

export async function changePlanAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    requireBillingAdmin(s);
    const plan = z.enum(["starter", "professional", "business"]).parse(str(fd, "planKey"));
    const r = await changePlan(s.orgId, s.userId, plan);
    revalidatePath("/app", "layout");
    return r.upgrade ? "Plano atualizado. Os novos recursos já estão liberados; o novo valor vale a partir do próximo vencimento."
      : `Troca agendada para ${r.effectiveAt ? r.effectiveAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "o próximo ciclo"}. Até lá, seu plano atual continua valendo.`;
  });
}

export async function cancelAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    requireBillingAdmin(s);
    if (str(fd, "confirm") !== "CANCELAR") throw new BillingError("Digite CANCELAR para confirmar.");
    await cancelSubscription(s.orgId, s.userId);
    revalidatePath("/app", "layout");
    return "Assinatura cancelada. Nenhuma nova cobrança será gerada.";
  });
}

export async function refreshInvoicesAction(_: ActionResult): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    await refreshInvoices(s.orgId);
    revalidatePath("/app/billing");
    return "Faturas atualizadas.";
  });
}
