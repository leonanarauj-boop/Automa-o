"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { login, logout, signup } from "@/modules/auth/service";
import { clearSessionCookie, clientIp, SESSION_COOKIE, setSessionCookie, userAgent } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";

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
  if (res?.ok) redirect("/app");
  return res;
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(token);
  await clearSessionCookie();
  redirect("/login");
}
