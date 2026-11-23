import { z } from "zod";
import { withService, type Db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, randomToken, sha256 } from "@/lib/crypto";
import { audit } from "@/modules/audit/audit";
import { getPlan } from "@/modules/billing/plans";
import { layout, sendEmail } from "@/modules/email/mailer";
import { SESSION_TTL_DAYS } from "@/modules/auth/service";

export class TeamError extends Error {}

type Role = "owner" | "manager" | "agent";
const INVITE_DAYS = 7;
const appUrl = () => env().APP_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------------------------
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(200),
  role: z.enum(["manager", "agent"]),
});

/** Membros ativos + convites pendentes não podem passar do limite de usuários do plano. */
async function seatsAvailable(db: Db, orgId: string) {
  const r = (await db.query<{ plan: string; members: string; pending: string }>(
    `select o.plan,
       (select count(*) from memberships where organization_id = $1 and status = 'active') members,
       (select count(*) from invitations where organization_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()) pending
     from organizations o where o.id = $1`, [orgId])).rows[0];
  const limit = getPlan(r.plan).limits.users;
  return { limit, used: Number(r.members) + Number(r.pending) };
}

export async function invite(db: Db, orgId: string, actor: { userId: string; role: Role; name: string; orgName: string }, input: z.input<typeof inviteSchema>) {
  const d = inviteSchema.parse(input);
  if (actor.role === "agent") throw new TeamError("Apenas o dono e gestores podem convidar.");
  if (d.role === "manager" && actor.role !== "owner") throw new TeamError("Apenas o dono pode convidar gestores.");
  const member = await db.query("select 1 from memberships m join users u on u.id = m.user_id where m.organization_id = $1 and lower(u.email) = $2 and m.status = 'active'", [orgId, d.email]);
  if (member.rowCount) throw new TeamError("Esta pessoa já faz parte da equipe.");
  // convite pendente anterior para o mesmo e-mail é substituído
  await db.query("update invitations set revoked_at = now() where organization_id = $1 and lower(email) = $2 and accepted_at is null and revoked_at is null", [orgId, d.email]);
  const seats = await seatsAvailable(db, orgId);
  if (seats.used >= seats.limit) throw new TeamError(`Seu plano permite ${seats.limit} usuários (incluindo convites pendentes). Faça upgrade em Assinatura.`);
  const token = randomToken();
  const r = await db.query<{ id: string }>(
    `insert into invitations (organization_id, email, role, token_hash, invited_by, expires_at)
     values ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) returning id`,
    [orgId, d.email, d.role, sha256(token), actor.userId, INVITE_DAYS]);
  await audit(db, { orgId, actorType: "user", actorId: actor.userId, action: "team.invited", targetType: "invitation", targetId: r.rows[0].id, metadata: { email: d.email, role: d.role } });
  const url = `${appUrl()}/convite/${token}`;
  return { id: r.rows[0].id, url, email: d.email, role: d.role, inviter: actor.name, orgName: actor.orgName };
}

export async function sendInviteEmail(orgId: string, i: { url: string; email: string; role: string; inviter: string; orgName: string }) {
  const { html, text } = layout(
    `Convite para ${i.orgName}`,
    [`${i.inviter} convidou você para a equipe de ${i.orgName} na Retoma, como ${i.role === "manager" ? "gestor(a)" : "atendente"}.`, `O convite vale por ${INVITE_DAYS} dias.`],
    { label: "Aceitar convite", url: i.url },
    "Se você não esperava este convite, pode ignorar este e-mail.",
  );
  return sendEmail("invite", orgId, { to: i.email, subject: `Convite para a equipe de ${i.orgName}`, html, text });
}

export async function revokeInvite(db: Db, orgId: string, actor: { userId: string; role: Role }, inviteId: string) {
  if (actor.role === "agent") throw new TeamError("Sem permissão.");
  const r = await db.query("update invitations set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null", [inviteId]);
  if (!r.rowCount) throw new TeamError("Convite não encontrado.");
  await audit(db, { orgId, actorType: "user", actorId: actor.userId, action: "team.invite_revoked", targetType: "invitation", targetId: inviteId });
}

export interface InviteInfo { id: string; organization_id: string; org_name: string; email: string; role: string; inviter: string | null; existing_user_id: string | null }

/** Lê um convite válido pelo token (contexto de serviço: quem abre o link ainda não está na org). */
export async function findInvite(token: string): Promise<InviteInfo | null> {
  if (!token || token.length > 200) return null;
  return withService(async (db) => (await db.query<InviteInfo>(
    `select i.id, i.organization_id, o.name as org_name, i.email, i.role, u.full_name as inviter,
            (select id from users where lower(email) = lower(i.email)) as existing_user_id
     from invitations i join organizations o on o.id = i.organization_id left join users u on u.id = i.invited_by
     where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`, [sha256(token)])).rows[0] ?? null);
}

async function createSession(db: Db, userId: string, orgId: string) {
  const token = randomToken();
  await db.query(`insert into sessions (token_hash, user_id, active_org_id, expires_at) values ($1,$2,$3, now() + make_interval(days => $4))`,
    [sha256(token), userId, orgId, SESSION_TTL_DAYS]);
  return token;
}

async function joinOrg(db: Db, inv: { id: string; organization_id: string; role: string }, userId: string) {
  const seats = await seatsAvailable(db, inv.organization_id);
  // o convite já ocupa uma vaga; aceitar não muda o total
  if (seats.used > seats.limit) throw new TeamError("A equipe atingiu o limite de usuários do plano. Peça para quem convidou fazer upgrade.");
  await db.query(
    `insert into memberships (organization_id, user_id, role, status) values ($1,$2,$3,'active')
     on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active'`, [inv.organization_id, userId, inv.role]);
  await db.query("update invitations set accepted_at = now(), accepted_by = $2 where id = $1", [inv.id, userId]);
  await audit(db, { orgId: inv.organization_id, actorType: "user", actorId: userId, action: "team.invite_accepted", targetType: "invitation", targetId: inv.id });
}

/** Aceite por quem já tem conta e está logado com o MESMO e-mail do convite. */
export async function acceptAsUser(token: string, user: { id: string; email: string }) {
  return withService(async (db) => {
    const inv = (await db.query<{ id: string; organization_id: string; role: string; email: string }>(
      "select id, organization_id, role, email from invitations where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update", [sha256(token)])).rows[0];
    if (!inv) throw new TeamError("Convite inválido, expirado ou já utilizado.");
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new TeamError(`Este convite é para ${inv.email}. Entre com essa conta para aceitar.`);
    await joinOrg(db, inv, user.id);
    return inv.organization_id;
  });
}

export const newAccountSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome").max(120),
  password: z.string().min(10, "A senha precisa ter pelo menos 10 caracteres").max(200),
});

/** Aceite criando a conta (o e-mail vem do convite: quem tem o link prova acesso ao e-mail). */
export async function acceptWithNewAccount(token: string, input: z.input<typeof newAccountSchema>) {
  const d = newAccountSchema.parse(input);
  const hash = await hashPassword(d.password);
  return withService(async (db) => {
    const inv = (await db.query<{ id: string; organization_id: string; role: string; email: string }>(
      "select id, organization_id, role, email from invitations where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update", [sha256(token)])).rows[0];
    if (!inv) throw new TeamError("Convite inválido, expirado ou já utilizado.");
    if ((await db.query("select 1 from users where lower(email) = lower($1)", [inv.email])).rowCount) throw new TeamError("Já existe uma conta com este e-mail. Entre para aceitar o convite.");
    const u = await db.query<{ id: string }>("insert into users (email, full_name, password_hash) values ($1,$2,$3) returning id", [inv.email.toLowerCase(), d.fullName, hash]);
    await joinOrg(db, inv, u.rows[0].id);
    return { token: await createSession(db, u.rows[0].id, inv.organization_id), orgId: inv.organization_id };
  });
}

// ---------------------------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------------------------
export async function changeRole(db: Db, orgId: string, actor: { userId: string; role: Role }, userId: string, role: "manager" | "agent") {
  if (actor.role !== "owner") throw new TeamError("Apenas o dono pode alterar papéis.");
  if (userId === actor.userId) throw new TeamError("Você não pode alterar o próprio papel.");
  const r = await db.query("update memberships set role = $2 where user_id = $1 and role <> 'owner'", [userId, role]);
  if (!r.rowCount) throw new TeamError("Membro não encontrado (o papel de dono não pode ser alterado aqui).");
  await audit(db, { orgId, actorType: "user", actorId: actor.userId, action: "team.role_changed", targetType: "user", targetId: userId, metadata: { role } });
}

/** Desativa o acesso. As sessões deixam de valer imediatamente (a sessão exige vínculo ativo). */
export async function setMemberStatus(db: Db, orgId: string, actor: { userId: string; role: Role }, userId: string, status: "active" | "disabled") {
  if (actor.role === "agent") throw new TeamError("Sem permissão.");
  if (userId === actor.userId) throw new TeamError("Você não pode desativar a si mesmo.");
  const target = (await db.query<{ role: Role }>("select role from memberships where user_id = $1", [userId])).rows[0];
  if (!target) throw new TeamError("Membro não encontrado.");
  if (target.role === "owner") throw new TeamError("O dono da conta não pode ser desativado.");
  if (target.role === "manager" && actor.role !== "owner") throw new TeamError("Apenas o dono pode desativar gestores.");
  if (status === "active") {
    const seats = await seatsAvailable(db, orgId);
    if (seats.used >= seats.limit) throw new TeamError(`Seu plano permite ${seats.limit} usuários. Faça upgrade para reativar.`);
  }
  await db.query("update memberships set status = $2 where user_id = $1", [userId, status]);
  await db.query("update contacts set owner_user_id = null where owner_user_id = $1 and $2 = 'disabled'", [userId, status]);
  await audit(db, { orgId, actorType: "user", actorId: actor.userId, action: `team.member_${status}`, targetType: "user", targetId: userId });
}

export async function switchOrg(sessionTokenHash: string, userId: string, orgId: string) {
  return withService(async (db) => {
    const m = await db.query("select 1 from memberships where user_id = $1 and organization_id = $2 and status = 'active'", [userId, orgId]);
    if (!m.rowCount) throw new TeamError("Você não faz parte desta empresa.");
    await db.query("update sessions set active_org_id = $3 where token_hash = $1 and user_id = $2", [sessionTokenHash, userId, orgId]);
  });
}
