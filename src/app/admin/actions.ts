"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { AdminError, createCoupon, extendTrial, retryJob, setAiOverride, setBlocked, setCouponActive } from "@/modules/admin/service";

const uuid = (v: string) => z.string().uuid().parse(v);
const wrap = (fn: (adminId: string) => Promise<string | void>) => safeAction(async () => {
  const s = await requireAdmin();
  try { return await fn(s.userId); } catch (e) { if (e instanceof z.ZodError) throw new AdminError(e.issues[0].message); throw e; }
});

export async function extendTrialAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return wrap(async (a) => { const id = uuid(str(fd, "orgId")); await extendTrial(a, id, Number(str(fd, "days"))); revalidatePath(`/admin/empresas/${id}`); return "Teste estendido."; });
}
export async function aiOverrideAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return wrap(async (a) => {
    const id = uuid(str(fd, "orgId"));
    const v = str(fd, "credits");
    await setAiOverride(a, id, v === "" ? null : Number(v));
    revalidatePath(`/admin/empresas/${id}`);
    return v === "" ? "Créditos voltaram ao padrão do plano." : "Créditos de IA ajustados.";
  });
}
export async function blockAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return wrap(async (a) => {
    const id = uuid(str(fd, "orgId"));
    const unblock = str(fd, "unblock") === "1";
    await setBlocked(a, id, unblock ? null : str(fd, "reason"));
    revalidatePath(`/admin/empresas/${id}`);
    return unblock ? "Bloqueio removido." : "Empresa bloqueada.";
  });
}
export async function createCouponAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return wrap(async (a) => {
    await createCoupon(a, { code: str(fd, "code"), percentOff: str(fd, "percentOff"), durationMonths: str(fd, "durationMonths"), maxRedemptions: str(fd, "maxRedemptions"), validUntil: str(fd, "validUntil") });
    revalidatePath("/admin/cupons");
    return "Cupom criado.";
  });
}
export async function couponActiveAction(fd: FormData) {
  const s = await requireAdmin();
  await setCouponActive(s.userId, str(fd, "code"), str(fd, "active") === "1");
  revalidatePath("/admin/cupons");
}
export async function retryJobAction(fd: FormData) {
  const s = await requireAdmin();
  await retryJob(s.userId, str(fd, "id"));
  revalidatePath("/admin/saude");
}
