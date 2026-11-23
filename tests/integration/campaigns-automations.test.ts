import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../helpers";
import { closePool, withService, withTenant } from "@/lib/db";
import { signup } from "@/modules/auth/service";
import { createContact, createDeal, getDefaultPipeline, moveDeal } from "@/modules/crm/service";
import { approve, campaignStats, cancel, CampaignError, dispatchDueCampaigns, preview, requestApproval, saveCampaign, sendTest } from "@/modules/campaigns/service";
import { createAutomation, reprocessRun, saveVersion, setAutomationStatus } from "@/modules/automations/service";
import { assertPublicUrl, processEvents, runDueWorkflows, scanNoReply, simulate } from "@/modules/automations/engine";
import { definitionSchema } from "@/modules/automations/definition";
import { encryptSecret } from "@/lib/crypto";

let A: { userId: string; orgId: string };
let B: { userId: string; orgId: string };
let tplMk: string; let tplUt: string; let tagVip: string;
const consented: string[] = [];
let noConsent: string; let optedOut: string; let noPhone: string;
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withService((db) => db.query<T>(sql, p)).then((r) => r.rows);
const tick = async (rounds = 3) => { for (let i = 0; i < rounds; i++) { await withService((db) => processEvents(db)); await runDueWorkflows(); } };

beforeAll(async () => {
  await resetDb();
  A = await signup({ fullName: "Ana", email: "ana@a.com", password: "senha-forte-123", orgName: "Clínica A", segment: "clinica" });
  B = await signup({ fullName: "Beto", email: "beto@b.com", password: "senha-forte-456", orgName: "Clínica B", segment: "clinica" });
  const ch = (await q<{ id: string }>("insert into channel_accounts (organization_id, waba_id, phone_number_id, access_token_encrypted) values ($1,'1','PH_C',$2) returning id", [A.orgId, encryptSecret("t")]))[0].id;
  tplMk = (await q<{ id: string }>(`insert into message_templates (organization_id, channel_account_id, name, language, category, status, body_text, body_param_count)
    values ($1,$2,'promo','pt_BR','MARKETING','APPROVED','Oi {{1}}! Novidade: {{2}}',2) returning id`, [A.orgId, ch]))[0].id;
  tplUt = (await q<{ id: string }>(`insert into message_templates (organization_id, channel_account_id, name, language, category, status, body_text, body_param_count)
    values ($1,$2,'aviso','pt_BR','UTILITY','APPROVED','Olá {{1}}, temos uma atualização.',1) returning id`, [A.orgId, ch]))[0].id;
  tagVip = (await q<{ id: string }>("insert into tags (organization_id, name) values ($1,'VIP') returning id", [A.orgId]))[0].id;
  await withTenant(A, async (db) => {
    for (let i = 0; i < 4; i++) {
      const id = await createContact(db, A.orgId, A.userId, { displayName: `Cliente ${i} Silva`, phone: `1191111000${i}` });
      await db.query("insert into consent_records (organization_id, contact_id, purpose, status, source, evidence) values ($1,$2,'marketing','granted','manual','formulário')", [A.orgId, id]);
      await db.query("insert into contact_tags (organization_id, contact_id, tag_id) values ($1,$2,$3)", [A.orgId, id, tagVip]);
      consented.push(id);
    }
    noConsent = await createContact(db, A.orgId, A.userId, { displayName: "Sem Consentimento", phone: "11922220000" });
    optedOut = await createContact(db, A.orgId, A.userId, { displayName: "Saiu", phone: "11922220001" });
    await db.query("insert into consent_records (organization_id, contact_id, purpose, status, source) values ($1,$2,'marketing','revoked','inbound_keyword')", [A.orgId, optedOut]);
    noPhone = await createContact(db, A.orgId, A.userId, { displayName: "Sem Telefone" });
    for (const id of [noConsent, optedOut, noPhone]) await db.query("insert into contact_tags (organization_id, contact_id, tag_id) values ($1,$2,$3)", [A.orgId, id, tagVip]);
  });
  // eventos de criação dos contatos acima não devem disparar nada (nenhuma automação ainda)
  await withService((db) => processEvents(db));
});
afterAll(closePool);

const seg = (o: Partial<{ tagIds: string[] }> = {}) => ({ tagIds: o.tagIds ?? [], temperatures: [], stageIds: [], hasOpenDeal: null, inactiveDays: null, activeDays: null, createdWithinDays: null });

describe("campanhas", () => {
  let c1: string;
  it("pré-visualização separa elegíveis e motivos de exclusão", async () => {
    c1 = await withTenant(A, (db) => saveCampaign(db, A.orgId, A.userId, { name: "Promo", templateId: tplMk, paramMapping: [{ source: "first_name" }, { source: "fixed", value: "clareamento com 10% off" }], segment: seg({ tagIds: [tagVip] }) }));
    const pv = await withTenant(A, (db) => preview(db, A.orgId, c1));
    expect(pv.total).toBe(7);
    expect(pv.eligible).toBe(4);
    expect(pv.excluded).toEqual({ no_marketing_consent: 1, opted_out: 1, no_whatsapp: 1 });
    expect(pv.samples[0].text).toMatch(/^Oi Cliente! Novidade: clareamento com 10% off$/);
    expect(pv.problems).toEqual([]);
  });

  it("teste só vai para contato com consentimento", async () => {
    await expect(withTenant(A, (db) => sendTest(db, A.orgId, A.userId, c1, noConsent))).rejects.toThrow(/consentimento/);
    await withTenant(A, (db) => sendTest(db, A.orgId, A.userId, c1, consented[0]));
  });

  it("aprovação, disparo e limite diário", async () => {
    await withTenant(A, (db) => requestApproval(db, A.orgId, A.userId, c1));
    await withService((db) => db.query("update organizations set daily_template_limit = 4 where id = $1", [A.orgId])); // 1 já usado pelo teste
    await withTenant(A, (db) => approve(db, A.orgId, A.userId, c1, new Date()));
    expect(await withService((db) => dispatchDueCampaigns(db))).toBe(3);
    const st = await withTenant(A, (db) => campaignStats(db, c1));
    expect(st.queued).toBe(3);
    expect(st.skipReasons.find((r) => r.reason === "daily_limit")?.n).toBe(1);
    expect(st.skipped).toBe(4); // 3 sem permissão + 1 pelo limite
    expect((await q("select * from campaigns where id = $1 and status = 'done'", [c1]))).toHaveLength(1);
    expect(await withService((db) => dispatchDueCampaigns(db))).toBe(0); // não dispara de novo
  });

  it("controle de frequência exclui quem recebeu campanha recentemente", async () => {
    await withService((db) => db.query("update organizations set daily_template_limit = 1000 where id = $1", [A.orgId]));
    const c2 = await withTenant(A, (db) => saveCampaign(db, A.orgId, A.userId, { name: "Promo 2", templateId: tplMk, paramMapping: [{ source: "first_name" }, { source: "fixed", value: "x" }], segment: seg({ tagIds: [tagVip] }) }));
    const pv = await withTenant(A, (db) => preview(db, A.orgId, c2));
    expect(pv.excluded.frequency).toBe(3);
    expect(pv.eligible).toBe(1);
  });

  it("cancelar interrompe mensagens ainda não enviadas", async () => {
    const pending = await q<{ n: string }>("select count(*) n from messages m join campaign_recipients cr on cr.message_id = m.id where cr.campaign_id = $1 and m.status = 'pending' and not cr.is_test", [c1]);
    expect(Number(pending[0].n)).toBe(3);
    await withTenant(A, (db) => cancel(db, A.orgId, A.userId, c1));
    const after = await q<{ n: string }>("select count(*) n from messages m join campaign_recipients cr on cr.message_id = m.id where cr.campaign_id = $1 and m.status = 'pending'", [c1]);
    expect(Number(after[0].n)).toBe(0);
  });

  it("não aprova sem template válido, nem no passado; outra empresa não vê", async () => {
    const c3 = await withTenant(A, (db) => saveCampaign(db, A.orgId, A.userId, { name: "Sem template", templateId: null, paramMapping: [], segment: seg() }));
    await expect(withTenant(A, (db) => approve(db, A.orgId, A.userId, c3, new Date()))).rejects.toThrow(CampaignError);
    await expect(withTenant(A, (db) => approve(db, A.orgId, A.userId, c3, new Date(Date.now() - 3600_000)))).rejects.toThrow(/passado/);
    expect((await withTenant(B, (db) => db.query("select * from campaigns"))).rowCount).toBe(0);
  });
});

describe("automações", () => {
  it("valida referências: etiqueta de outra empresa é recusada", async () => {
    await expect(withTenant(B, (db) => createAutomation(db, B.orgId, B.userId, "X", { trigger: { type: "contact.created" }, steps: [{ type: "add_tag", tagId: tagVip }] })))
      .rejects.toThrow(/Etiqueta inválida/);
  });

  it("novo contato: atribui responsável, etiqueta e cria tarefa", async () => {
    const id = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Novo lead", { trigger: { type: "contact.created" }, steps: [
      { type: "assign_owner", mode: "round_robin" }, { type: "add_tag", tagId: tagVip }, { type: "create_task", title: "Primeiro contato", dueHours: 1 },
    ] }));
    // rascunho não dispara
    const c0 = await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Antes de ativar" }));
    await tick();
    expect(await q("select * from workflow_runs where contact_id = $1", [c0])).toHaveLength(0);
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"));
    const c = await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Lead Novo" }));
    await tick();
    const [run] = await q<{ status: string }>("select status from workflow_runs where contact_id = $1", [c]);
    expect(run.status).toBe("succeeded");
    expect(await q("select * from contact_tags where contact_id = $1 and tag_id = $2", [c, tagVip])).toHaveLength(1);
    expect(await q("select * from tasks where contact_id = $1 and title = 'Primeiro contato'", [c])).toHaveLength(1);
    expect((await q<{ owner_user_id: string }>("select owner_user_id from contacts where id = $1", [c]))[0].owner_user_id).toBe(A.userId);
    expect(await q("select * from workflow_run_steps where run_id = (select id from workflow_runs where contact_id = $1)", [c])).toHaveLength(3);
  });

  it("proposta parada: espera, confere a etapa e para se o cliente avançou", async () => {
    const pipe = await withTenant(A, (db) => getDefaultPipeline(db));
    const proposal = pipe.stages.find((s) => s.name === "Orçamento enviado")!;
    const nego = pipe.stages.find((s) => s.name === "Negociação")!;
    const id = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Proposta", { trigger: { type: "deal.stage_changed", stageId: proposal.id }, steps: [
      { type: "wait", minutes: 4320 }, { type: "condition", check: { kind: "deal_in_stage", stageId: proposal.id } }, { type: "create_task", title: "Retomar proposta", dueHours: 4 },
    ] }));
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"));
    const [d1, d2] = await withTenant(A, async (db) => [
      await createDeal(db, A.orgId, A.userId, { contactId: consented[1], title: "P1" }), await createDeal(db, A.orgId, A.userId, { contactId: consented[2], title: "P2" })]);
    await withTenant(A, async (db) => { await moveDeal(db, A.orgId, A.userId, d1, proposal.id); await moveDeal(db, A.orgId, A.userId, d2, proposal.id); });
    await tick();
    const runs = await q<{ id: string; status: string; contact_id: string }>("select id, status, contact_id from workflow_runs where automation_id = $1", [id]);
    expect(runs.map((r) => r.status)).toEqual(["waiting", "waiting"]);
    await withTenant(A, (db) => moveDeal(db, A.orgId, A.userId, d2, nego.id)); // cliente 2 avançou
    await q("update workflow_runs set resume_at = now() where automation_id = $1", [id]); // simula a passagem de 3 dias
    await tick();
    const after = await q<{ status: string; contact_id: string }>("select status, contact_id from workflow_runs where automation_id = $1", [id]);
    expect(after.find((r) => r.contact_id === consented[1])!.status).toBe("succeeded");
    expect(after.find((r) => r.contact_id === consented[2])!.status).toBe("stopped");
    expect(await q("select * from tasks where title = 'Retomar proposta'")).toHaveLength(1);
  });

  it("laço entre automações é interrompido pelo limite de profundidade", async () => {
    const pipe = await withTenant(A, (db) => getDefaultPipeline(db));
    const [s0, s1] = [pipe.stages[0], pipe.stages[1]];
    const a1 = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Ping", { trigger: { type: "deal.stage_changed", stageId: s0.id }, steps: [{ type: "move_deal", stageId: s1.id }] }));
    const a2 = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Pong", { trigger: { type: "deal.stage_changed", stageId: s1.id }, steps: [{ type: "move_deal", stageId: s0.id }] }));
    for (const a of [a1, a2]) await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, a, "active"));
    const d = await withTenant(A, (db) => createDeal(db, A.orgId, A.userId, { contactId: consented[3], title: "Loop", stageId: s1.id }));
    await withTenant(A, (db) => moveDeal(db, A.orgId, A.userId, d, s0.id));
    await tick(10);
    const n = (await q<{ n: string }>("select count(*) n from workflow_runs where automation_id = any($1)", [[a1, a2]]))[0].n;
    expect(Number(n)).toBeLessThanOrEqual(3);
    expect(await q("select * from domain_events where processed_at is null")).toHaveLength(0);
    for (const a of [a1, a2]) await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, a, "paused"));
  });

  it("template de marketing sem consentimento é pulado; utilidade é enviada", async () => {
    const id = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Mensagens", { trigger: { type: "message.received" }, steps: [
      { type: "send_template", templateId: tplMk, params: [{ source: "first_name" }, { source: "fixed", value: "x" }] },
      { type: "send_template", templateId: tplUt, params: [{ source: "first_name" }] },
    ] }));
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"));
    const { emitEvent } = await import("@/modules/automations/events");
    await withService((db) => emitEvent(db, A.orgId, "message.received", { contactId: noConsent }));
    await tick();
    const steps = await q<{ status: string; detail: string }>("select s.status, s.detail from workflow_run_steps s join workflow_runs r on r.id = s.run_id where r.automation_id = $1 order by s.id", [id]);
    expect(steps[0]).toMatchObject({ status: "skipped" });
    expect(steps[0].detail).toMatch(/consentimento/);
    expect(steps[1]).toMatchObject({ status: "ok" });
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "paused"));
  });

  it("falha fica registrada e o reprocessamento continua do passo que falhou", async () => {
    const other = (await q<{ id: string }>("insert into users (email, full_name, password_hash) values ('x@x.com','Ex','x') returning id"))[0].id;
    await q("insert into memberships (organization_id, user_id, role) values ($1,$2,'agent')", [A.orgId, other]);
    const id = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Atribuir", { trigger: { type: "contact.created" }, steps: [
      { type: "add_tag", tagId: tagVip }, { type: "assign_owner", mode: "user", userId: other }, { type: "create_task", title: "Após atribuir", dueHours: 1 },
    ] }));
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"));
    await q("update memberships set status = 'disabled' where user_id = $1", [other]);
    const c = await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Falha" }));
    await tick();
    const [run] = await q<{ id: string; status: string; current_step: number; error: string }>("select id, status, current_step, error from workflow_runs where automation_id = $1", [id]);
    expect(run).toMatchObject({ status: "failed", current_step: 1 });
    expect(run.error).toMatch(/Passo 2/);
    await q("update memberships set status = 'active' where user_id = $1", [other]);
    await withTenant(A, (db) => reprocessRun(db, A.orgId, A.userId, run.id));
    await tick();
    expect((await q<{ status: string }>("select status from workflow_runs where id = $1", [run.id]))[0].status).toBe("succeeded");
    expect(await q("select * from tasks where contact_id = $1 and title = 'Após atribuir'", [c])).toHaveLength(1);
    const okTags = await q("select s.* from workflow_run_steps s where s.run_id = $1 and s.step_type = 'add_tag'", [run.id]);
    expect(okTags).toHaveLength(1); // o passo 1 não se repetiu
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "paused"));
  });

  it("versões: edição cria versão nova; pausa cancela execuções em espera", async () => {
    const id = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Espera", { trigger: { type: "contact.created" }, steps: [{ type: "wait", minutes: 60 }, { type: "create_task", title: "v1", dueHours: 1 }] }));
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"));
    await withTenant(A, (db) => createContact(db, A.orgId, A.userId, { displayName: "Versão" }));
    await tick();
    const v = await withTenant(A, (db) => saveVersion(db, A.orgId, A.userId, id, "Espera", { trigger: { type: "contact.created" }, steps: [{ type: "create_task", title: "v2", dueHours: 1 }] }));
    expect(v).toBe(2);
    const [run] = await q<{ status: string; version: number }>("select r.status, v.version from workflow_runs r join automation_versions v on v.id = r.version_id where r.automation_id = $1", [id]);
    expect(run).toMatchObject({ status: "waiting", version: 1 });
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "paused"));
    expect((await q<{ status: string }>("select status from workflow_runs where automation_id = $1", [id]))[0].status).toBe("canceled");
  });

  it("gatilho 'sem resposta' dispara uma vez por silêncio", async () => {
    const id = await withTenant(A, (db) => createAutomation(db, A.orgId, A.userId, "Sem resposta", { trigger: { type: "conversation.no_reply", hours: 24 }, steps: [{ type: "create_task", title: "Sem resposta", dueHours: 1 }] }));
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "active"));
    await q("update contacts set last_inbound_at = now() - interval '3 days', last_outbound_at = now() - interval '2 days' where id = $1", [consented[0]]);
    expect(await withService((db) => scanNoReply(db))).toBe(1);
    expect(await withService((db) => scanNoReply(db))).toBe(0);
    await withTenant(A, (db) => setAutomationStatus(db, A.orgId, A.userId, id, "paused"));
  });

  it("webhook: só https e nunca para rede interna", async () => {
    expect(() => definitionSchema.parse({ trigger: { type: "contact.created" }, steps: [{ type: "webhook", url: "http://exemplo.com" }] })).toThrow();
    for (const u of ["https://127.0.0.1/x", "https://10.0.0.5/", "https://192.168.1.1/", "https://169.254.169.254/latest", "https://[::1]/"]) {
      await expect(assertPublicUrl(u), u).rejects.toThrow(/interno/);
    }
  });

  it("simulação mostra o caminho sem executar nada", async () => {
    const def = definitionSchema.parse({ trigger: { type: "contact.created" }, steps: [
      { type: "condition", check: { kind: "marketing_consent" } }, { type: "send_template", templateId: tplMk, params: [{ source: "first_name" }, { source: "fixed", value: "x" }] },
    ] });
    const ok = await withTenant(A, (db) => simulate(db, def, consented[0]));
    expect(ok.map((s) => s.result)).toEqual(["atendida", 'enviaria "promo"']);
    const stop = await withTenant(A, (db) => simulate(db, def, noConsent));
    expect(stop[0].result).toMatch(/pararia/);
    expect(stop).toHaveLength(1);
  });
});
