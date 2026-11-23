import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../helpers";
import { closePool, withService } from "@/lib/db";
import { authenticate, getSessionByToken, login, signup, SESSION_TTL_DAYS } from "@/modules/auth/service";
import { completeChallenge, confirmEnrollment, disableMfa, MfaError, startEnrollment } from "@/modules/mfa/service";
import { base32Decode, currentStep, hotp } from "@/modules/mfa/totp";
import { requestPasswordReset, resetPassword } from "@/modules/auth/password";
import { setMailer, type OutgoingEmail } from "@/modules/email/mailer";

const outbox: OutgoingEmail[] = [];
setMailer({ configured: () => true, async send(m) { outbox.push(m); } });
let A: { userId: string; orgId: string; token: string };
let secret = "";
let recovery: string[] = [];
const codeAt = (offsetSteps = 0) => hotp(base32Decode(secret), currentStep() + offsetSteps);

beforeAll(async () => {
  await resetDb();
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
});
afterAll(async () => { setMailer(null); await closePool(); });

describe("verificação em duas etapas", () => {
  it("ativação exige código válido e gera 10 códigos de recuperação; encerra outras sessões", async () => {
    const other = await login("ana@a.com", "senha-forte-123");
    secret = (await startEnrollment(A.userId, "ana@a.com")).secret;
    const sess = (await getSessionByToken(A.token))!;
    await expect(confirmEnrollment(A.userId, sess.sessionId, "000000")).rejects.toThrow(MfaError);
    recovery = await confirmEnrollment(A.userId, sess.sessionId, codeAt(-1)); // passo anterior, para não reutilizar o atual depois
    expect(recovery).toHaveLength(10);
    expect(new Set(recovery).size).toBe(10);
    expect((await getSessionByToken(A.token))!).toMatchObject({ mfaEnabled: true, mfaVerified: true });
    expect(await getSessionByToken(other.token)).toBeNull();
  });

  it("login passa a exigir o código; o mesmo código não pode ser reutilizado", async () => {
    await expect(login("ana@a.com", "senha-forte-123")).rejects.toThrow(/código de verificação/);
    const r1 = await authenticate("ana@a.com", "senha-forte-123", undefined, undefined, "/app/agenda");
    expect(r1.token).toBeUndefined();
    await expect(completeChallenge(r1.challenge!, "123456", SESSION_TTL_DAYS)).rejects.toThrow(/incorreto/);
    const code = codeAt();
    const ok = await completeChallenge(r1.challenge!, code, SESSION_TTL_DAYS);
    expect(ok.next).toBe("/app/agenda");
    expect((await getSessionByToken(ok.token))!.mfaVerified).toBe(true);
    const r2 = await authenticate("ana@a.com", "senha-forte-123");
    await expect(completeChallenge(r2.challenge!, code, SESSION_TTL_DAYS)).rejects.toThrow(/incorreto/); // reuso bloqueado
  });

  it("código de recuperação funciona uma única vez", async () => {
    const r = await authenticate("ana@a.com", "senha-forte-123");
    const ok = await completeChallenge(r.challenge!, recovery[0].toUpperCase(), SESSION_TTL_DAYS);
    expect(ok.usedRecovery).toBe(true);
    const r2 = await authenticate("ana@a.com", "senha-forte-123");
    await expect(completeChallenge(r2.challenge!, recovery[0], SESSION_TTL_DAYS)).rejects.toThrow(/incorreto/);
  });

  it("5 tentativas erradas invalidam o desafio", async () => {
    const r = await authenticate("ana@a.com", "senha-forte-123");
    for (let i = 0; i < 4; i++) await expect(completeChallenge(r.challenge!, "000000", SESSION_TTL_DAYS)).rejects.toThrow(/incorreto/);
    await expect(completeChallenge(r.challenge!, "000000", SESSION_TTL_DAYS)).rejects.toThrow(/Muitas tentativas/);
    await expect(completeChallenge(r.challenge!, recovery[1], SESSION_TTL_DAYS)).rejects.toThrow(/expirou/);
  });

  it("redefinir a senha não dispensa o código", async () => {
    await requestPasswordReset("ana@a.com");
    const token = outbox.at(-1)!.text.match(/redefinir-senha\/([A-Za-z0-9_-]+)/)![1];
    const r = await resetPassword(token, "nova-senha-segura-1");
    expect(r.token).toBeUndefined();
    expect(r.challenge).toBeTruthy();
    const ok = await completeChallenge(r.challenge!, recovery[2], SESSION_TTL_DAYS);
    expect(await getSessionByToken(ok.token)).not.toBeNull();
  });

  it("desativar exige senha e código", async () => {
    await expect(disableMfa(A.userId, "errada", recovery[3])).rejects.toThrow(/Senha incorreta/);
    await expect(disableMfa(A.userId, "nova-senha-segura-1", "000000")).rejects.toThrow(/incorreto/);
    await disableMfa(A.userId, "nova-senha-segura-1", recovery[3]);
    await expect(login("ana@a.com", "nova-senha-segura-1")).resolves.toHaveProperty("token");
    expect((await withService((db) => db.query("select * from mfa_recovery_codes where user_id = $1", [A.userId]))).rowCount).toBe(0);
  });
});
