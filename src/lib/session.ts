import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionByToken, SESSION_TTL_DAYS, type SessionInfo } from "@/modules/auth/service";
import { withTenant, type Db } from "./db";

export const SESSION_COOKIE = "retoma_sid";

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionInfo | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionByToken(token);
}

/** Exige sessão válida; redireciona para o login caso contrário. */
export async function requireSession(): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Atalho: executa no contexto do tenant da sessão atual (com RLS). */
export async function tenant<T>(fn: (db: Db, s: SessionInfo) => Promise<T>): Promise<T> {
  const s = await requireSession();
  return withTenant({ userId: s.userId, orgId: s.orgId }, (db) => fn(db, s));
}

export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

export async function userAgent(): Promise<string | undefined> {
  return (await headers()).get("user-agent") ?? undefined;
}
