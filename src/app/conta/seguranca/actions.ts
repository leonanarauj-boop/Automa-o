"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { confirmEnrollment, disableMfa, regenerateRecoveryCodes, startEnrollment } from "@/modules/mfa/service";

export async function startEnrollmentAction(): Promise<{ secret?: string; qr?: string; error?: string }> {
  try {
    const s = await requireSession();
    const r = await startEnrollment(s.userId, s.userEmail);
    return { secret: r.secret, qr: r.qr };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function confirmEnrollmentAction(code: string): Promise<{ codes?: string[]; error?: string }> {
  const r = await safeAction(async () => {
    const s = await requireSession();
    const codes = await confirmEnrollment(s.userId, s.sessionId, code);
    return codes.join(",");
  });
  revalidatePath("/", "layout");
  return r?.error ? { error: r.error } : { codes: r?.message?.split(",") };
}

export async function disableMfaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    await disableMfa(s.userId, str(fd, "password"), str(fd, "code"));
    revalidatePath("/", "layout");
    return "Verificação em duas etapas desativada.";
  });
}

export async function regenerateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    const codes = await regenerateRecoveryCodes(s.userId, str(fd, "code"));
    return `Novos códigos (os anteriores deixaram de valer). Guarde agora: ${codes.join("  ")}`;
  });
}
