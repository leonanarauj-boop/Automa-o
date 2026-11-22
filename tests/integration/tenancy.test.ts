import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../helpers";
import { closePool, pool, withService, withTenant } from "@/lib/db";
import { signup, login, getSessionByToken, AuthError } from "@/modules/auth/service";
import { createContact, createDeal, getDefaultPipeline } from "@/modules/crm/service";
import { seedDemo } from "@/modules/demo/seed";

let A: { userId: string; orgId: string; token: string };
let B: { userId: string; orgId: string; token: string };

beforeAll(async () => {
  await resetDb();
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
  B = await signup({ fullName: "Beto", email: "beto@b.com", password: "senha-forte-456", orgName: "Imob B", segment: "imobiliaria" });
  await withTenant(A, (db) => seedDemo(db, A.orgId, A.userId));
  await withTenant(B, (db) => seedDemo(db, B.orgId, B.userId));
  await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Contato A", phone: "11911112222" }));
});
afterAll(closePool);

describe("cadastro e login", () => {
  it("onboarding aplica o funil do segmento", async () => {
    const pa = await withTenant(A, (db) => getDefaultPipeline(db));
    const pb = await withTenant(B, (db) => getDefaultPipeline(db));
    expect(pa.stages.map((s) => s.name)).toContain("Avaliação agendada");
    expect(pb.stages.map((s) => s.name)).toContain("Visita agendada");
  });
  it("sessão válida resolve usuário e organização", async () => {
    const s = await getSessionByToken(A.token);
    expect(s).toMatchObject({ userId: A.userId, orgId: A.orgId, role: "owner", orgName: "Clínica A" });
    expect(await getSessionByToken("token-invalido")).toBeNull();
  });
  it("e-mail duplicado é recusado", async () => {
    await expect(signup({ fullName: "Xavier", email: "ANA@a.com", password: "senha-forte-123", orgName: "Outra", segment: "outro" })).rejects.toThrow(AuthError);
  });
  it("login bloqueia após 5 falhas", async () => {
    await expect(login("ana@a.com", "senha-forte-123")).resolves.toHaveProperty("token");
    for (let i = 0; i < 5; i++) await expect(login("ana@a.com", "errada")).rejects.toThrow("incorretos");
    await expect(login("ana@a.com", "senha-forte-123")).rejects.toThrow("Muitas tentativas");
  });
});

describe("isolamento multi-tenant (RLS)", () => {
  it("toda tabela com organization_id tem RLS habilitado e política", async () => {
    const r = await pool().query<{ table_name: string; rls: boolean; policies: string }>(
      `select c.table_name, cl.relrowsecurity as rls,
              (select count(*) from pg_policies p where p.tablename = c.table_name) as policies
       from information_schema.columns c join pg_class cl on cl.relname = c.table_name
       join information_schema.tables t on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'organization_id'`,
    );
    expect(r.rows.length).toBeGreaterThan(15);
    for (const row of r.rows) {
      expect(row.rls, `RLS em ${row.table_name}`).toBe(true);
      expect(Number(row.policies), `política em ${row.table_name}`).toBeGreaterThan(0);
    }
  });

  it("cada org vê apenas os próprios dados em todas as tabelas", async () => {
    const tables = (await pool().query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'organization_id'`,
    )).rows.map((r) => r.table_name);
    for (const ctx of [A, B]) {
      await withTenant(ctx, async (db) => {
        for (const t of tables) {
          if (t === "channel_accounts") continue; // coluna de token não é legível; testado abaixo
          const r = await db.query(`select count(*) filter (where organization_id <> $1) as foreign from ${t}`, [ctx.orgId]);
          expect(Number(r.rows[0].foreign), `vazamento em ${t}`).toBe(0);
        }
      });
    }
    const aContacts = await withTenant(A, (db) => db.query("select count(*) n from contacts"));
    expect(Number(aContacts.rows[0].n)).toBe(7);
  });

  it("não é possível inserir dados em outra organização", async () => {
    await expect(withTenant(A, (db) =>
      db.query("insert into contacts (organization_id, display_name) values ($1, 'invasor')", [B.orgId]),
    )).rejects.toThrow(/row-level security/);
  });

  it("não é possível alterar ou apagar dados de outra organização", async () => {
    const bContact = (await withService((db) => db.query<{ id: string }>("select id from contacts where organization_id = $1 limit 1", [B.orgId]))).rows[0].id;
    const upd = await withTenant(A, (db) => db.query("update contacts set display_name = 'hack' where id = $1", [bContact]));
    const del = await withTenant(A, (db) => db.query("delete from contacts where id = $1", [bContact]));
    expect(upd.rowCount).toBe(0);
    expect(del.rowCount).toBe(0);
  });

  it("forjar app.org_id sem ser membro não dá acesso", async () => {
    const r = await withTenant({ userId: A.userId, orgId: B.orgId }, (db) => db.query("select count(*) n from contacts"));
    expect(Number(r.rows[0].n)).toBe(0);
  });

  it("criar negócio com contato de outra org falha", async () => {
    const bContact = (await withService((db) => db.query<{ id: string }>("select id from contacts where organization_id = $1 limit 1", [B.orgId]))).rows[0].id;
    await expect(withTenant(A, (db) => createDeal(db, A.orgId, A.userId, { contactId: bContact, title: "x" }))).rejects.toThrow();
  });

  it("app_user não acessa tabelas globais nem o token criptografado", async () => {
    for (const sql of ["select * from sessions", "select * from jobs", "select * from webhook_events", "select password_hash from users", "select access_token_encrypted from channel_accounts"]) {
      await expect(withTenant(A, (db) => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("usuários de outra org não aparecem", async () => {
    const r = await withTenant(A, (db) => db.query<{ email: string }>("select email from users"));
    expect(r.rows.map((x) => x.email)).toEqual(["ana@a.com"]);
  });
});

describe("painel", async () => {
  const { dashboardMetrics, stageFunnel } = await import("@/modules/dashboard/metrics");
  it("calcula indicadores a partir dos dados (demo inclusa)", async () => {
    const m = await withTenant(A, (db) => dashboardMetrics(db, A.orgId));
    expect(m.demoContacts).toBe(6);
    expect(m.wonCount).toBe(1);
    expect(m.wonValue).toBe(220000);
    expect(m.openDeals).toBe(4);
    expect(m.avgFirstResponseMin).not.toBeNull();
    const f = await withTenant(A, (db) => stageFunnel(db));
    expect(f.reduce((a, s) => a + s.count, 0)).toBe(6);
  });
});
