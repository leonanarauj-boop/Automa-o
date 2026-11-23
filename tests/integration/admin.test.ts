import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../helpers";
import { closePool, withService, withTenant } from "@/lib/db";
import { signup } from "@/modules/auth/service";
import { AdminError, createCoupon, extendTrial, isPlatformAdmin, listOrgs, orgDetail, overview, retryJob, setAiOverride, setBlocked } from "@/modules/admin/service";
import { recompute } from "@/modules/billing/service";
import { queueText, SendBlockedError } from "@/modules/inbox/outbound";

let admin: { userId: string; orgId: string };
let A: { userId: string; orgId: string };
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withService((db) => db.query<T>(sql, p)).then((r) => r.rows);

beforeAll(async () => {
  await resetDb();
  admin = await signup({ fullName: "Equipe Retoma", email: "ops@retoma.app", password: "senha-forte-123", orgName: "Retoma Interna", segment: "outro" });
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
  await q("insert into platform_admins (user_id) values ($1)", [admin.userId]);
});
afterAll(closePool);

describe("painel da plataforma", () => {
  it("só administradores cadastrados", async () => {
    expect(await isPlatformAdmin(admin.userId)).toBe(true);
    expect(await isPlatformAdmin(A.userId)).toBe(false);
  });

  it("visão geral e lista de empresas", async () => {
    const o = await overview();
    expect(o.orgs).toBe(2);
    expect(o.trial).toBe(2);
    const list = await listOrgs({ q: "clínica" });
    expect(list.map((x) => x.name)).toEqual(["Clínica A"]);
  });

  it("estender teste fica registrado no histórico visível ao cliente", async () => {
    const before = (await q<{ t: Date }>("select trial_ends_at t from organizations where id = $1", [A.orgId]))[0].t;
    await extendTrial(admin.userId, A.orgId, 10);
    const after = (await q<{ t: Date }>("select trial_ends_at t from organizations where id = $1", [A.orgId]))[0].t;
    expect(Math.round((after.getTime() - before.getTime()) / 86400_000)).toBe(10);
    const seen = await withTenant(A, (db) => db.query<{ action: string; actor_type: string }>("select action, actor_type from audit_logs where action like 'platform.%'"));
    expect(seen.rows[0]).toMatchObject({ action: "platform.trial_extended", actor_type: "platform_admin" });
    await expect(extendTrial(admin.userId, A.orgId, 999)).rejects.toThrow();
  });

  it("créditos de IA personalizados sobrevivem ao recálculo do plano", async () => {
    await setAiOverride(admin.userId, A.orgId, 50);
    await withService((db) => recompute(db, A.orgId));
    expect((await q<{ c: number }>("select ai_monthly_credits c from organizations where id = $1", [A.orgId]))[0].c).toBe(50);
    await setAiOverride(admin.userId, A.orgId, null);
    expect((await q<{ c: number }>("select ai_monthly_credits c from organizations where id = $1", [A.orgId]))[0].c).toBe(300);
  });

  it("bloqueio manual restringe envios; desbloqueio volta ao status calculado", async () => {
    await expect(setBlocked(admin.userId, A.orgId, "x")).rejects.toThrow();
    await setBlocked(admin.userId, A.orgId, "Envio de spam reportado");
    expect((await q<{ status: string }>("select status from organizations where id = $1", [A.orgId]))[0].status).toBe("suspended");
    const conv = (await q<{ id: string }>(`insert into contacts (organization_id, display_name, wa_id) values ($1,'X','5511999990000') returning id`, [A.orgId]))[0].id;
    const cv = (await q<{ id: string }>("insert into conversations (organization_id, contact_id) values ($1,$2) returning id", [A.orgId, conv]))[0].id;
    await expect(withTenant(A, (db) => queueText(db, A.userId, { conversationId: cv, body: "oi" }))).rejects.toThrow(SendBlockedError);
    await setBlocked(admin.userId, A.orgId, null);
    expect((await q<{ status: string }>("select status from organizations where id = $1", [A.orgId]))[0].status).toBe("trial");
  });

  it("detalhe da empresa traz só contagens e metadados", async () => {
    const d = await orgDetail(A.orgId);
    expect(d!.usage.contacts).toBe("1");
    expect(Object.keys(d!)).toEqual(["org", "sub", "invoices", "usage", "members", "audit"]);
    expect(JSON.stringify(d)).not.toContain("5511999990000");
  });

  it("cupons e reprocessamento de jobs", async () => {
    await createCoupon(admin.userId, { code: "lancamento", percentOff: "30", durationMonths: "3", maxRedemptions: "", validUntil: "" });
    await expect(createCoupon(admin.userId, { code: "LANCAMENTO", percentOff: "10" })).rejects.toThrow(AdminError);
    expect((await q<{ code: string; duration_months: number }>("select code, duration_months from coupons"))[0]).toEqual({ code: "LANCAMENTO", duration_months: 3 });
    const job = (await q<{ id: string }>("insert into jobs (type, payload, status, attempts, last_error) values ('radar.refresh_all','{}','failed',5,'erro') returning id"))[0].id;
    await retryJob(admin.userId, job);
    expect((await q<{ status: string }>("select status from jobs where id = $1", [job]))[0].status).toBe("queued");
    await expect(retryJob(admin.userId, job)).rejects.toThrow(/não está com falha/);
    expect((await q("select * from admin_audit")).length).toBeGreaterThanOrEqual(6);
  });
});
