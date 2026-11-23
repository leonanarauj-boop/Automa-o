import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../helpers";
import { closePool, withService, withTenant } from "@/lib/db";
import { getSessionByToken, login, signup } from "@/modules/auth/service";
import { setMailer, type OutgoingEmail } from "@/modules/email/mailer";
import { acceptAsUser, acceptWithNewAccount, changeRole, findInvite, invite, revokeInvite, sendInviteEmail, setMemberStatus, switchOrg, TeamError } from "@/modules/team/service";
import { changePassword, isResetTokenValid, requestPasswordReset, resetPassword } from "@/modules/auth/password";
import { sha256 } from "@/lib/crypto";

const outbox: OutgoingEmail[] = [];
setMailer({ configured: () => true, async send(m) { outbox.push(m); } });
const linkFrom = (m: OutgoingEmail, path: string) => m.text.match(new RegExp(`${path}/([A-Za-z0-9_-]+)`))![1];
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withService((db) => db.query<T>(sql, p)).then((r) => r.rows);

let A: { userId: string; orgId: string; token: string };
let B: { userId: string; orgId: string; token: string };
const ownerA = () => ({ userId: A.userId, role: "owner" as const, name: "Ana", orgName: "Clínica A" });

beforeAll(async () => {
  await resetDb();
  A = await signup({ fullName: "Ana Dona", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
  B = await signup({ fullName: "Beto", email: "beto@b.com", password: "senha-forte-456", orgName: "Clínica B", segment: "clinica" });
});
afterAll(async () => { setMailer(null); await closePool(); });

describe("convites", () => {
  let agentId: string;
  it("convida por e-mail; nova pessoa cria conta e entra na equipe", async () => {
    const inv = await withTenant(A, (db) => invite(db, A.orgId, ownerA(), { email: "Carla@A.com", role: "agent" }));
    expect(await sendInviteEmail(A.orgId, inv)).toBe("sent");
    const token = linkFrom(outbox.at(-1)!, "/convite");
    expect(outbox.at(-1)!.to).toBe("carla@a.com");
    const info = await findInvite(token);
    expect(info).toMatchObject({ org_name: "Clínica A", role: "agent", email: "carla@a.com", existing_user_id: null });
    const r = await acceptWithNewAccount(token, { fullName: "Carla Atendente", password: "senha-da-carla-1" });
    const s = await getSessionByToken(r.token);
    expect(s).toMatchObject({ orgId: A.orgId, role: "agent", userEmail: "carla@a.com" });
    agentId = s!.userId;
    expect(await findInvite(token)).toBeNull(); // uso único
    await expect(acceptWithNewAccount(token, { fullName: "Outra", password: "senha-da-carla-1" })).rejects.toThrow(/inválido/);
  });

  it("pessoa com conta em outra empresa aceita logada com o mesmo e-mail e pode alternar", async () => {
    const inv = await withTenant(A, (db) => invite(db, A.orgId, ownerA(), { email: "beto@b.com", role: "agent" }));
    const token = inv.url.split("/").at(-1)!;
    await expect(acceptAsUser(token, { id: A.userId, email: "ana@a.com" })).rejects.toThrow(/Este convite é para beto@b.com/);
    await acceptAsUser(token, { id: B.userId, email: "beto@b.com" });
    await switchOrg(sha256(B.token), B.userId, A.orgId);
    expect((await getSessionByToken(B.token))!.orgId).toBe(A.orgId);
    await switchOrg(sha256(B.token), B.userId, B.orgId);
    await expect(switchOrg(sha256(A.token), A.userId, B.orgId)).rejects.toThrow(/não faz parte/);
  });

  it("permissões: atendente não convida; gestor não convida gestor", async () => {
    await expect(withTenant(A, (db) => invite(db, A.orgId, { ...ownerA(), userId: agentId, role: "agent" }, { email: "x@x.com", role: "agent" }))).rejects.toThrow(/Apenas o dono e gestores/);
    await expect(withTenant(A, (db) => invite(db, A.orgId, { ...ownerA(), role: "manager" }, { email: "x@x.com", role: "manager" }))).rejects.toThrow(/Apenas o dono pode convidar gestores/);
  });

  it("limite de usuários do plano conta convites pendentes; revogar libera a vaga", async () => {
    // teste grátis: 3 usuários (Ana, Carla, Beto)
    await expect(withTenant(A, (db) => invite(db, A.orgId, ownerA(), { email: "d@a.com", role: "agent" }))).rejects.toThrow(/permite 3 usuários/);
    await q("update organizations set plan = 'professional' where id = $1", [A.orgId]); // 5
    const i1 = await withTenant(A, (db) => invite(db, A.orgId, ownerA(), { email: "d@a.com", role: "agent" }));
    await withTenant(A, (db) => invite(db, A.orgId, ownerA(), { email: "e@a.com", role: "agent" }));
    await expect(withTenant(A, (db) => invite(db, A.orgId, ownerA(), { email: "f@a.com", role: "agent" }))).rejects.toThrow(/permite 5/);
    await withTenant(A, (db) => revokeInvite(db, A.orgId, ownerA(), i1.id));
    await withTenant(A, (db) => invite(db, A.orgId, ownerA(), { email: "f@a.com", role: "agent" }));
    expect(await findInvite(i1.url.split("/").at(-1)!)).toBeNull();
  });

  it("convite expirado não vale; outra empresa não vê convites", async () => {
    await q("update invitations set expires_at = now() - interval '1 minute' where email = 'f@a.com'");
    expect((await withTenant(B, (db) => db.query("select * from invitations"))).rowCount).toBe(0);
  });

  it("dono muda papel; desativar derruba a sessão na hora", async () => {
    await withTenant(A, (db) => changeRole(db, A.orgId, ownerA(), agentId, "manager"));
    await expect(withTenant(A, (db) => changeRole(db, A.orgId, ownerA(), A.userId, "agent"))).rejects.toThrow(/próprio papel/);
    const carla = await login("carla@a.com", "senha-da-carla-1");
    expect((await getSessionByToken(carla.token))!.role).toBe("manager");
    await expect(withTenant(A, (db) => setMemberStatus(db, A.orgId, { userId: agentId, role: "manager" }, A.userId, "disabled"))).rejects.toThrow(TeamError);
    await withTenant(A, (db) => setMemberStatus(db, A.orgId, ownerA(), agentId, "disabled"));
    expect(await getSessionByToken(carla.token)).toBeNull();
  });
});

describe("senha", () => {
  it("e-mail desconhecido: mesma resposta e nenhum e-mail", async () => {
    const before = outbox.length;
    await requestPasswordReset("ninguem@x.com", "1.1.1.1");
    expect(outbox.length).toBe(before);
  });

  it("link de uso único troca a senha e encerra todas as sessões", async () => {
    const old = await login("ana@a.com", "senha-forte-123");
    await requestPasswordReset("ANA@a.com", "2.2.2.2");
    const token = linkFrom(outbox.at(-1)!, "/redefinir-senha");
    expect(await isResetTokenValid(token)).toBe(true);
    await expect(resetPassword(token, "curta")).rejects.toThrow(/10 caracteres/);
    const r = await resetPassword(token, "nova-senha-segura-1");
    expect(await getSessionByToken(old.token)).toBeNull();
    expect((await getSessionByToken(r.token!))!.orgId).toBe(A.orgId);
    await expect(resetPassword(token, "outra-senha-segura")).rejects.toThrow(/inválido/);
    await expect(login("ana@a.com", "senha-forte-123")).rejects.toThrow(/incorretos/);
    await login("ana@a.com", "nova-senha-segura-1");
  });

  it("limite de pedidos por e-mail e link expirado", async () => {
    const before = outbox.length;
    for (let i = 0; i < 5; i++) await requestPasswordReset("beto@b.com", `3.3.3.${i}`);
    expect(outbox.length - before).toBe(3);
    const token = linkFrom(outbox.at(-1)!, "/redefinir-senha");
    await q("update password_resets set expires_at = now() - interval '1 second' where token_hash = $1", [sha256(token)]);
    expect(await isResetTokenValid(token)).toBe(false);
  });

  it("alterar senha exige a atual e encerra as outras sessões", async () => {
    const s1 = await login("beto@b.com", "senha-forte-456");
    const s2 = await login("beto@b.com", "senha-forte-456");
    const sess1 = (await getSessionByToken(s1.token))!;
    await expect(changePassword(B.userId, sess1.sessionId, "errada", "outra-senha-boa-1")).rejects.toThrow(/atual incorreta/);
    await changePassword(B.userId, sess1.sessionId, "senha-forte-456", "outra-senha-boa-1");
    expect(await getSessionByToken(s1.token)).not.toBeNull();
    expect(await getSessionByToken(s2.token)).toBeNull();
  });
});
