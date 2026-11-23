import QRCode from "qrcode";
import { withService, type Db } from "@/lib/db";
import { decryptSecret, encryptSecret, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { audit } from "@/modules/audit/audit";
import { generateSecret, otpauthUrl, verifyTotp } from "./totp";

export class MfaError extends Error {}

const CHALLENGE_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RECOVERY_CODES = 10;

function newRecoveryCode() {
  const raw = randomToken(8).replace(/[^A-Za-z0-9]/g, "").toLowerCase().padEnd(10, "x").slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}
const normalizeRecovery = (c: string) => c.trim().toLowerCase().replace(/\s/g, "");

// ---------------------------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------------------------
export async function startEnrollment(userId: string, email: string) {
  const secret = generateSecret();
  await withService(async (db) => {
    const u = (await db.query<{ mfa_enabled_at: Date | null }>("select mfa_enabled_at from users where id = $1", [userId])).rows[0];
    if (u?.mfa_enabled_at) throw new MfaError("A verificação em duas etapas já está ativa.");
    await db.query("update users set mfa_pending_secret_encrypted = $2 where id = $1", [userId, encryptSecret(secret)]);
  });
  const url = otpauthUrl(secret, email);
  return { secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

async function issueRecoveryCodes(db: Db, userId: string) {
  await db.query("delete from mfa_recovery_codes where user_id = $1", [userId]);
  const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  for (const c of codes) await db.query("insert into mfa_recovery_codes (user_id, code_hash) values ($1,$2)", [userId, sha256(normalizeRecovery(c))]);
  return codes;
}

/** Confirma com um código do app; devolve os códigos de recuperação (mostrados uma única vez). */
export async function confirmEnrollment(userId: string, sessionId: string, code: string) {
  return withService(async (db) => {
    const u = (await db.query<{ mfa_pending_secret_encrypted: string | null; mfa_enabled_at: Date | null }>(
      "select mfa_pending_secret_encrypted, mfa_enabled_at from users where id = $1 for update", [userId])).rows[0];
    if (u.mfa_enabled_at) throw new MfaError("A verificação em duas etapas já está ativa.");
    if (!u.mfa_pending_secret_encrypted) throw new MfaError("Comece a configuração novamente.");
    const secret = decryptSecret(u.mfa_pending_secret_encrypted);
    const step = verifyTotp(secret, code);
    if (step === null) throw new MfaError("Código incorreto. Confira o horário do celular e tente o código atual.");
    await db.query(
      "update users set mfa_secret_encrypted = mfa_pending_secret_encrypted, mfa_pending_secret_encrypted = null, mfa_enabled_at = now(), mfa_last_step = $2 where id = $1",
      [userId, step]);
    const codes = await issueRecoveryCodes(db, userId);
    await db.query("update sessions set mfa_verified_at = now() where id = $1", [sessionId]);
    // outras sessões abertas antes da ativação precisam entrar de novo com o código
    await db.query("delete from sessions where user_id = $1 and id <> $2", [userId, sessionId]);
    await audit(db, { orgId: null, actorType: "user", actorId: userId, action: "auth.mfa_enabled" });
    return codes;
  });
}

/** Confere TOTP (sem reuso do mesmo código) ou um código de recuperação (uso único). */
async function checkSecondFactor(db: Db, userId: string, code: string): Promise<"totp" | "recovery" | null> {
  const u = (await db.query<{ mfa_secret_encrypted: string | null; mfa_last_step: string | null }>(
    "select mfa_secret_encrypted, mfa_last_step from users where id = $1 for update", [userId])).rows[0];
  if (!u?.mfa_secret_encrypted) return null;
  const step = verifyTotp(decryptSecret(u.mfa_secret_encrypted), code, { lastStep: u.mfa_last_step === null ? null : Number(u.mfa_last_step) });
  if (step !== null) {
    await db.query("update users set mfa_last_step = $2 where id = $1", [userId, step]);
    return "totp";
  }
  const r = await db.query("update mfa_recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null", [userId, sha256(normalizeRecovery(code))]);
  return r.rowCount ? "recovery" : null;
}

export async function disableMfa(userId: string, password: string, code: string) {
  await withService(async (db) => {
    const u = (await db.query<{ password_hash: string }>("select password_hash from users where id = $1", [userId])).rows[0];
    if (!(await verifyPassword(password, u.password_hash))) throw new MfaError("Senha incorreta.");
    if (!(await checkSecondFactor(db, userId, code))) throw new MfaError("Código de verificação incorreto.");
    if ((await db.query("select 1 from platform_admins where user_id = $1", [userId])).rowCount) throw new MfaError("Administradores da plataforma não podem desativar a verificação em duas etapas.");
    await db.query("update users set mfa_secret_encrypted = null, mfa_pending_secret_encrypted = null, mfa_enabled_at = null, mfa_last_step = null where id = $1", [userId]);
    await db.query("delete from mfa_recovery_codes where user_id = $1", [userId]);
    await audit(db, { orgId: null, actorType: "user", actorId: userId, action: "auth.mfa_disabled" });
  });
}

export async function regenerateRecoveryCodes(userId: string, code: string) {
  return withService(async (db) => {
    if ((await checkSecondFactor(db, userId, code)) !== "totp") throw new MfaError("Use um código do aplicativo autenticador.");
    const codes = await issueRecoveryCodes(db, userId);
    await audit(db, { orgId: null, actorType: "user", actorId: userId, action: "auth.mfa_recovery_regenerated" });
    return codes;
  });
}

// ---------------------------------------------------------------------------------------------
// Login em duas etapas
// ---------------------------------------------------------------------------------------------
export async function createChallenge(db: Db, userId: string, activeOrgId: string | null, opts: { next?: string; userAgent?: string } = {}) {
  const token = randomToken();
  await db.query(
    "insert into mfa_challenges (token_hash, user_id, active_org_id, next_path, user_agent, expires_at) values ($1,$2,$3,$4,$5, now() + make_interval(mins => $6))",
    [sha256(token), userId, activeOrgId, opts.next ?? null, opts.userAgent?.slice(0, 300) ?? null, CHALLENGE_MINUTES]);
  return token;
}

export async function challengeIsValid(token: string) {
  if (!token) return false;
  return withService(async (db) => !!(await db.query("select 1 from mfa_challenges where token_hash = $1 and expires_at > now() and attempts < $2", [sha256(token), MAX_ATTEMPTS])).rowCount);
}

/** Conclui o login: valida o código, cria a sessão marcada como verificada. Máximo de 5 tentativas por desafio. */
export async function completeChallenge(token: string, code: string, sessionTtlDays: number) {
  const out = await withService(async (db) => {
    const c = (await db.query<{ id: string; user_id: string; active_org_id: string | null; next_path: string | null; attempts: number; user_agent: string | null }>(
      "select * from mfa_challenges where token_hash = $1 and expires_at > now() for update", [sha256(token)])).rows[0];
    if (!c || c.attempts >= MAX_ATTEMPTS) return { error: "A verificação expirou. Entre novamente com e-mail e senha." } as const;
    const kind = await checkSecondFactor(db, c.user_id, code);
    if (!kind) {
      await db.query("update mfa_challenges set attempts = attempts + 1 where id = $1", [c.id]);
      return { error: c.attempts + 1 >= MAX_ATTEMPTS ? "Muitas tentativas. Entre novamente com e-mail e senha." : "Código incorreto." } as const;
    }
    await db.query("delete from mfa_challenges where id = $1", [c.id]);
    const sessionToken = randomToken();
    await db.query(
      "insert into sessions (token_hash, user_id, active_org_id, user_agent, mfa_verified_at, expires_at) values ($1,$2,$3,$4, now(), now() + make_interval(days => $5))",
      [sha256(sessionToken), c.user_id, c.active_org_id, c.user_agent, sessionTtlDays]);
    if (kind === "recovery") await audit(db, { orgId: c.active_org_id, actorType: "user", actorId: c.user_id, action: "auth.mfa_recovery_used" });
    return { token: sessionToken, next: c.next_path, usedRecovery: kind === "recovery" } as const;
  });
  if ("error" in out) throw new MfaError(out.error);
  return out;
}

export async function mfaStatus(userId: string) {
  return withService(async (db) => {
    const r = (await db.query<{ enabled: Date | null; remaining: string }>(
      "select mfa_enabled_at enabled, (select count(*) from mfa_recovery_codes where user_id = $1 and used_at is null) remaining from users where id = $1", [userId])).rows[0];
    return { enabled: !!r.enabled, enabledAt: r.enabled, recoveryRemaining: Number(r.remaining) };
  });
}
