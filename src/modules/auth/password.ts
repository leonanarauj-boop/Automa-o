import { z } from "zod";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { audit } from "@/modules/audit/audit";
import { layout, sendEmail } from "@/modules/email/mailer";
import { AuthError, SESSION_TTL_DAYS } from "./service";

const RESET_MINUTES = 60;
const MAX_PER_EMAIL_HOUR = 3;
const MAX_PER_IP_HOUR = 10;

/**
 * Pedido de redefinição. A resposta é SEMPRE a mesma (não revela se o e-mail tem conta).
 * Limites por e-mail e por IP contra abuso. O token vale 1 hora e uma única vez.
 */
export async function requestPasswordReset(emailRaw: string, ip?: string) {
  const email = z.string().trim().toLowerCase().email("E-mail inválido").max(200).parse(emailRaw);
  const prepared = await withService(async (db) => {
    if (ip) {
      const byIp = await db.query<{ n: string }>("select count(*) n from password_resets where ip = $1 and created_at > now() - interval '1 hour'", [ip]);
      if (Number(byIp.rows[0].n) >= MAX_PER_IP_HOUR) return null;
    }
    const u = (await db.query<{ id: string; full_name: string }>("select id, full_name from users where lower(email) = $1", [email])).rows[0];
    if (!u) return null;
    const recent = await db.query<{ n: string }>("select count(*) n from password_resets where user_id = $1 and created_at > now() - interval '1 hour'", [u.id]);
    if (Number(recent.rows[0].n) >= MAX_PER_EMAIL_HOUR) return null;
    const token = randomToken();
    await db.query("insert into password_resets (user_id, token_hash, ip, expires_at) values ($1,$2,$3, now() + make_interval(mins => $4))", [u.id, sha256(token), ip ?? null, RESET_MINUTES]);
    await audit(db, { orgId: null, actorType: "system", actorId: u.id, action: "auth.password_reset_requested" });
    return { token, name: u.full_name };
  });
  if (prepared) {
    const url = `${env().APP_URL.replace(/\/$/, "")}/redefinir-senha/${prepared.token}`;
    const { html, text } = layout("Redefinir sua senha",
      [`Olá, ${prepared.name.split(" ")[0]}. Recebemos um pedido para redefinir a senha da sua conta.`, `O link vale por ${RESET_MINUTES} minutos e pode ser usado uma única vez.`],
      { label: "Criar nova senha", url }, "Se você não pediu, ignore este e-mail: sua senha continua a mesma.");
    await sendEmail("password_reset", null, { to: email, subject: "Redefinição de senha", html, text });
  }
}

export async function isResetTokenValid(token: string) {
  if (!token || token.length > 200) return false;
  return withService(async (db) => !!(await db.query("select 1 from password_resets where token_hash = $1 and used_at is null and expires_at > now()", [sha256(token)])).rowCount);
}

export const newPasswordSchema = z.string().min(10, "A senha precisa ter pelo menos 10 caracteres").max(200);

/** Troca a senha, invalida o token e TODAS as sessões abertas, e devolve uma sessão nova. */
export async function resetPassword(token: string, password: string) {
  const pw = newPasswordSchema.parse(password);
  const hash = await hashPassword(pw);
  return withService(async (db) => {
    const r = (await db.query<{ id: string; user_id: string }>(
      "select id, user_id from password_resets where token_hash = $1 and used_at is null and expires_at > now() for update", [sha256(token)])).rows[0];
    if (!r) throw new AuthError("Link inválido ou expirado. Peça um novo.");
    await db.query("update users set password_hash = $2, updated_at = now() where id = $1", [r.user_id, hash]);
    await db.query("update password_resets set used_at = now() where user_id = $1 and used_at is null", [r.user_id]);
    await db.query("delete from sessions where user_id = $1", [r.user_id]);
    await db.query("delete from auth_attempts where lower(email) = (select lower(email) from users where id = $1) and success = false", [r.user_id]);
    const m = (await db.query<{ organization_id: string }>("select organization_id from memberships where user_id = $1 and status = 'active' order by created_at limit 1", [r.user_id])).rows[0];
    // redefinir a senha não dispensa a verificação em duas etapas
    const mfa = (await db.query<{ on: boolean }>("select mfa_enabled_at is not null as on from users where id = $1", [r.user_id])).rows[0].on;
    if (mfa) {
      const { createChallenge } = await import("@/modules/mfa/service");
      await audit(db, { orgId: m?.organization_id ?? null, actorType: "user", actorId: r.user_id, action: "auth.password_reset" });
      return { challenge: await createChallenge(db, r.user_id, m?.organization_id ?? null), hasOrg: !!m } as const;
    }
    const sessionToken = randomToken();
    await db.query("insert into sessions (token_hash, user_id, active_org_id, expires_at) values ($1,$2,$3, now() + make_interval(days => $4))",
      [sha256(sessionToken), r.user_id, m?.organization_id ?? null, SESSION_TTL_DAYS]);
    await audit(db, { orgId: m?.organization_id ?? null, actorType: "user", actorId: r.user_id, action: "auth.password_reset" });
    return { token: sessionToken, hasOrg: !!m } as const;
  });
}

/** Alteração pelo próprio usuário logado: exige a senha atual e encerra as outras sessões. */
export async function changePassword(userId: string, currentSessionId: string, current: string, next: string) {
  const pw = newPasswordSchema.parse(next);
  const u = await withService(async (db) => (await db.query<{ password_hash: string }>("select password_hash from users where id = $1", [userId])).rows[0]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw new AuthError("Senha atual incorreta.");
  const hash = await hashPassword(pw);
  await withService(async (db) => {
    await db.query("update users set password_hash = $2, updated_at = now() where id = $1", [userId, hash]);
    await db.query("delete from sessions where user_id = $1 and id <> $2", [userId, currentSessionId]);
    await audit(db, { orgId: null, actorType: "user", actorId: userId, action: "auth.password_changed" });
  });
}
