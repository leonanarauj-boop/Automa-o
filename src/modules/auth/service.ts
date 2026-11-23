import { z } from "zod";
import { withService, type Db } from "@/lib/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { getSegment, SEGMENTS } from "@/modules/onboarding/segments";
import { audit } from "@/modules/audit/audit";

export const SESSION_TTL_DAYS = 30;
const MAX_FAILED_LOGINS = 5;
const LOCK_WINDOW_MIN = 15;

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(200),
  password: z.string().min(10, "A senha precisa ter pelo menos 10 caracteres").max(200),
  orgName: z.string().trim().min(2, "Informe o nome da empresa").max(120),
  segment: z.enum(SEGMENTS.map((s) => s.key) as [string, ...string[]]),
});
export type SignupInput = z.infer<typeof signupSchema>;

export class AuthError extends Error {}

/** Aplica o preset do segmento na organização (funil, etiquetas, regras do Radar). */
export async function seedOrganization(db: Db, orgId: string, segmentKey: string) {
  const seg = getSegment(segmentKey);
  const { rows } = await db.query<{ id: string }>(
    "insert into pipelines (organization_id, name, is_default) values ($1, $2, true) returning id",
    [orgId, "Funil de vendas"],
  );
  const pipelineId = rows[0].id;
  for (const [i, st] of seg.stages.entries()) {
    await db.query(
      "insert into pipeline_stages (organization_id, pipeline_id, name, position, kind) values ($1,$2,$3,$4,$5)",
      [orgId, pipelineId, st.name, i, st.kind],
    );
  }
  for (const tag of seg.tags) {
    await db.query("insert into tags (organization_id, name) values ($1,$2) on conflict do nothing", [orgId, tag]);
  }
  for (const [kind, hours] of Object.entries({ ...seg.radar, appointment_unconfirmed: 24, no_show: 24 })) {
    await db.query(
      "insert into opportunity_rules (organization_id, kind, threshold_hours) values ($1,$2,$3) on conflict do nothing",
      [orgId, kind, hours],
    );
  }
}

async function createSession(db: Db, userId: string, orgId: string | null, userAgent?: string) {
  const token = randomToken();
  await db.query(
    `insert into sessions (token_hash, user_id, active_org_id, user_agent, expires_at)
     values ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`,
    [sha256(token), userId, orgId, userAgent?.slice(0, 300) ?? null, String(SESSION_TTL_DAYS)],
  );
  return token;
}

export async function signup(input: SignupInput, userAgent?: string) {
  const data = signupSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return withService(async (db) => {
    const exists = await db.query("select 1 from users where lower(email) = lower($1)", [data.email]);
    if (exists.rowCount) throw new AuthError("Já existe uma conta com este e-mail.");
    const user = await db.query<{ id: string }>(
      "insert into users (email, full_name, password_hash) values ($1,$2,$3) returning id",
      [data.email, data.fullName, passwordHash],
    );
    const org = await db.query<{ id: string }>(
      "insert into organizations (name, segment) values ($1,$2) returning id",
      [data.orgName, data.segment],
    );
    const userId = user.rows[0].id;
    const orgId = org.rows[0].id;
    await db.query("insert into memberships (organization_id, user_id, role) values ($1,$2,'owner')", [orgId, userId]);
    await seedOrganization(db, orgId, data.segment);
    await audit(db, { orgId, actorType: "user", actorId: userId, action: "organization.created" });
    const token = await createSession(db, userId, orgId, userAgent);
    return { token, userId, orgId };
  });
}

export async function login(emailRaw: string, password: string, ip?: string, userAgent?: string) {
  const email = emailRaw.trim().toLowerCase();
  // A tentativa é registrada numa transação que sempre faz commit; o erro é lançado depois,
  // para que falhas não sejam desfeitas pelo rollback (senão o bloqueio nunca dispararia).
  const result = await withService(async (db) => {
    const failures = await db.query<{ n: string }>(
      `select count(*) n from auth_attempts
       where lower(email) = $1 and success = false and created_at > now() - ($2 || ' minutes')::interval`,
      [email, String(LOCK_WINDOW_MIN)],
    );
    if (Number(failures.rows[0].n) >= MAX_FAILED_LOGINS) return { error: `Muitas tentativas. Tente novamente em ${LOCK_WINDOW_MIN} minutos.` } as const;
    const u = await db.query<{ id: string; password_hash: string }>(
      "select id, password_hash from users where lower(email) = $1",
      [email],
    );
    const ok = u.rowCount ? await verifyPassword(password, u.rows[0].password_hash) : false;
    await db.query("insert into auth_attempts (email, ip, success) values ($1,$2,$3)", [email, ip ?? null, ok]);
    if (!ok) return { error: "E-mail ou senha incorretos." } as const;
    const userId = u.rows[0].id;
    const m = await db.query<{ organization_id: string }>(
      "select organization_id from memberships where user_id = $1 and status = 'active' order by created_at limit 1",
      [userId],
    );
    const token = await createSession(db, userId, m.rows[0]?.organization_id ?? null, userAgent);
    return { token, userId } as const;
  });
  if ("error" in result) throw new AuthError(result.error);
  return result;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  orgId: string;
  role: "owner" | "manager" | "agent";
  userName: string;
  userEmail: string;
  orgName: string;
  segment: string;
}

export async function getSessionByToken(token: string): Promise<SessionInfo | null> {
  return withService(async (db) => {
    const r = await db.query<SessionInfo & { session_id: string }>(
      `select s.id as "sessionId", u.id as "userId", m.organization_id as "orgId", m.role,
              u.full_name as "userName", u.email as "userEmail", o.name as "orgName", o.segment
       from sessions s
       join users u on u.id = s.user_id
       join memberships m on m.user_id = u.id and m.organization_id = s.active_org_id and m.status = 'active'
       join organizations o on o.id = m.organization_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    );
    return r.rows[0] ?? null;
  });
}

export async function logout(token: string) {
  await withService((db) => db.query("delete from sessions where token_hash = $1", [sha256(token)]));
}
