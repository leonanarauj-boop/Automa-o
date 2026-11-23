"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { login, logout, signup } from "@/modules/auth/service";
import { clearSessionCookie, clientIp, SESSION_COOKIE, setSessionCookie, userAgent } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { requestPasswordReset, resetPassword } from "@/modules/auth/password";
import { acceptAsUser, acceptWithNewAccount, switchOrg } from "@/modules/team/service";
import { getSession } from "@/lib/session";
import { sha256 } from "@/lib/crypto";

/** Só aceita caminhos internos (evita redirecionamento aberto). */
function safeNext(v: string) {
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/app";
}

export async function signupAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await safeAction(async () => {
    const r = await signup({
      fullName: str(fd, "fullName"), email: str(fd, "email"), password: str(fd, "password"),
      orgName: str(fd, "orgName"), segment: str(fd, "segment"),
    }, await userAgent());
    await setSessionCookie(r.token);
  });
  if (res?.ok) redirect("/app?bemvindo=1");
  return res;
}

export async function loginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await safeAction(async () => {
    const r = await login(str(fd, "email"), str(fd, "password"), await clientIp(), await userAgent());
    await setSessionCookie(r.token);
  });
  if (res?.ok) redirect(safeNext(str(fd, "next")));
  return res;
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(token);
  await clearSessionCookie();
  redirect("/login");
}

export async function forgotPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await requestPasswordReset(str(fd, "email"), await clientIp());
    return "Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha. Ele vale por 60 minutos.";
  });
}

export async function resetPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await safeAction(async () => {
    if (str(fd, "password") !== str(fd, "confirm")) throw new (await import("@/modules/auth/service")).AuthError("As senhas não conferem.");
    const r = await resetPassword(str(fd, "token"), str(fd, "password"));
    await setSessionCookie(r.token);
  });
  if (res?.ok) redirect("/app");
  return res;
}

export async function acceptInviteNewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await safeAction(async () => {
    if (str(fd, "password") !== str(fd, "confirm")) throw new (await import("@/modules/auth/service")).AuthError("As senhas não conferem.");
    const r = await acceptWithNewAccount(str(fd, "token"), { fullName: str(fd, "fullName"), password: str(fd, "password") });
    await setSessionCookie(r.token);
  });
  if (res?.ok) redirect("/app");
  return res;
}

export async function acceptInviteLoggedAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await safeAction(async () => {
    const s = await getSession();
    if (!s) throw new (await import("@/modules/auth/service")).AuthError("Entre na sua conta para aceitar.");
    const orgId = await acceptAsUser(str(fd, "token"), { id: s.userId, email: s.userEmail });
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) await switchOrg(sha256(token), s.userId, orgId);
  });
  if (res?.ok) redirect("/app");
  return res;
}

export async function switchOrgAction(fd: FormData) {
  const s = await getSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (s && token) await switchOrg(sha256(token), s.userId, str(fd, "orgId"));
  redirect("/app");
}
