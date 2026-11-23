"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, tenant } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { changeRole, invite, revokeInvite, sendInviteEmail, setMemberStatus } from "@/modules/team/service";
import { changePassword } from "@/modules/auth/password";
import { AuthError } from "@/modules/auth/service";

const uuid = (v: string) => z.string().uuid("Identificador inválido").parse(v);

export async function inviteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const inv = await tenant((db, s) => invite(db, s.orgId, { userId: s.userId, role: s.role, name: s.userName, orgName: s.orgName }, { email: str(fd, "email"), role: str(fd, "role") as never }));
    const s = await requireSession();
    const sent = await sendInviteEmail(s.orgId, inv);
    revalidatePath("/app/settings");
    const how = sent === "sent" ? `E-mail enviado para ${inv.email}.` : "O envio de e-mail não está configurado: envie o link abaixo para a pessoa.";
    return `${how} Link do convite (válido por 7 dias, uso único): ${inv.url}`;
  });
}

export async function revokeInviteAction(fd: FormData) {
  await tenant((db, s) => revokeInvite(db, s.orgId, { userId: s.userId, role: s.role }, uuid(str(fd, "id"))));
  revalidatePath("/app/settings");
}

export async function changeRoleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant((db, s) => changeRole(db, s.orgId, { userId: s.userId, role: s.role }, uuid(str(fd, "userId")), z.enum(["manager", "agent"]).parse(str(fd, "role"))));
    revalidatePath("/app/settings");
  });
}

export async function memberStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant((db, s) => setMemberStatus(db, s.orgId, { userId: s.userId, role: s.role }, uuid(str(fd, "userId")), z.enum(["active", "disabled"]).parse(str(fd, "status"))));
    revalidatePath("/app/settings");
  });
}

export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    if (str(fd, "next") !== str(fd, "confirm")) throw new AuthError("As senhas novas não conferem.");
    const s = await requireSession();
    await changePassword(s.userId, s.sessionId, str(fd, "current"), str(fd, "next"));
    return "Senha alterada. As outras sessões abertas foram encerradas.";
  });
}

export async function requireMfaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    if (s.role !== "owner") throw new AuthError("Apenas o dono pode alterar esta política.");
    const on = str(fd, "value") === "1";
    if (on && !s.mfaEnabled) throw new AuthError("Ative a verificação em duas etapas na sua conta antes de exigi-la da equipe.");
    await tenant(async (db) => {
      await db.query("update organizations set require_mfa = $1, updated_at = now() where id = $2", [on, s.orgId]);
      const { audit } = await import("@/modules/audit/audit");
      await audit(db, { orgId: s.orgId, actorType: "user", actorId: s.userId, action: on ? "security.mfa_required" : "security.mfa_optional" });
    });
    revalidatePath("/app", "layout");
    return on ? "Agora donos e gestores precisam da verificação em duas etapas." : "Verificação em duas etapas opcional.";
  });
}
