import { z } from "zod";
import type { Db } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { definitionSchema, type Definition } from "./definition";

export class AutomationError extends Error {}

/** Valida referências da definição contra os dados da PRÓPRIA organização (RLS). */
async function validateRefs(db: Db, def: Definition) {
  const ids = { tags: new Set<string>(), stages: new Set<string>(), templates: new Set<string>(), users: new Set<string>() };
  if (def.trigger.type === "deal.stage_changed" && def.trigger.stageId) ids.stages.add(def.trigger.stageId);
  for (const s of def.steps) {
    if (s.type === "add_tag" || s.type === "remove_tag") ids.tags.add(s.tagId);
    if (s.type === "move_deal") ids.stages.add(s.stageId);
    if (s.type === "condition" && s.check.kind === "has_tag") ids.tags.add(s.check.tagId);
    if (s.type === "condition" && s.check.kind === "deal_in_stage") ids.stages.add(s.check.stageId);
    if (s.type === "send_template") ids.templates.add(s.templateId);
    if (s.type === "assign_owner" && s.mode === "user") { if (!s.userId) throw new AutomationError("Escolha o usuário responsável."); ids.users.add(s.userId); }
    if (s.type === "send_template" && s.params.some((p) => p.source === "fixed" && !p.value?.trim())) throw new AutomationError("Preencha os textos fixos das variáveis do template.");
  }
  const check = async (sql: string, set: Set<string>, msg: string) => {
    if (!set.size) return;
    const r = await db.query<{ n: string }>(sql, [[...set]]);
    if (Number(r.rows[0].n) !== set.size) throw new AutomationError(msg);
  };
  await check("select count(*) n from tags where id = any($1::uuid[])", ids.tags, "Etiqueta inválida.");
  await check("select count(*) n from pipeline_stages where id = any($1::uuid[])", ids.stages, "Etapa inválida.");
  await check("select count(*) n from memberships where user_id = any($1::uuid[]) and status = 'active'", ids.users, "Usuário inválido.");
  if (ids.templates.size) {
    const t = await db.query<{ id: string; body_param_count: number }>("select id, body_param_count from message_templates where id = any($1::uuid[])", [[...ids.templates]]);
    if (t.rowCount !== ids.templates.size) throw new AutomationError("Template inválido.");
    for (const s of def.steps) if (s.type === "send_template" && t.rows.find((x) => x.id === s.templateId)!.body_param_count !== s.params.length) throw new AutomationError("Configure todas as variáveis do template.");
  }
}

export async function createAutomation(db: Db, orgId: string, userId: string, name: string, def: unknown) {
  const d = definitionSchema.parse(def);
  const n = z.string().trim().min(1, "Informe o nome").max(120).parse(name);
  await validateRefs(db, d);
  const a = await db.query<{ id: string }>("insert into automations (organization_id, name, trigger_type, created_by) values ($1,$2,$3,$4) returning id", [orgId, n, d.trigger.type, userId]);
  const v = await db.query<{ id: string }>("insert into automation_versions (organization_id, automation_id, version, definition, created_by) values ($1,$2,1,$3,$4) returning id", [orgId, a.rows[0].id, JSON.stringify(d), userId]);
  await db.query("update automations set current_version_id = $2 where id = $1", [a.rows[0].id, v.rows[0].id]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "automation.created", targetType: "automation", targetId: a.rows[0].id });
  return a.rows[0].id;
}

/** Salvar sempre cria uma nova versão; execuções em andamento continuam na versão em que começaram. */
export async function saveVersion(db: Db, orgId: string, userId: string, automationId: string, name: string, def: unknown) {
  const d = definitionSchema.parse(def);
  const n = z.string().trim().min(1, "Informe o nome").max(120).parse(name);
  await validateRefs(db, d);
  const cur = await db.query<{ max: number | null }>("select max(version) max from automation_versions where automation_id = $1", [automationId]);
  if (cur.rows[0].max === null) throw new AutomationError("Automação não encontrada.");
  const v = await db.query<{ id: string }>("insert into automation_versions (organization_id, automation_id, version, definition, created_by) values ($1,$2,$3,$4,$5) returning id",
    [orgId, automationId, cur.rows[0].max + 1, JSON.stringify(d), userId]);
  await db.query("update automations set name = $2, trigger_type = $3, current_version_id = $4, updated_at = now() where id = $1", [automationId, n, d.trigger.type, v.rows[0].id]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "automation.versioned", targetType: "automation", targetId: automationId, metadata: { version: cur.rows[0].max + 1 } });
  return cur.rows[0].max + 1;
}

export async function setAutomationStatus(db: Db, orgId: string, userId: string, id: string, status: "active" | "paused") {
  const r = await db.query("update automations set status = $2, updated_at = now() where id = $1", [id, status]);
  if (!r.rowCount) throw new AutomationError("Automação não encontrada.");
  if (status === "paused") {
    // execuções em espera também pausam: são canceladas para não agir depois da pausa
    await db.query("update workflow_runs set status = 'canceled', finished_at = now(), error = 'Automação pausada' where automation_id = $1 and status in ('running','waiting')", [id]);
  }
  await audit(db, { orgId, actorType: "user", actorId: userId, action: `automation.${status}`, targetType: "automation", targetId: id });
}

export async function duplicateAutomation(db: Db, orgId: string, userId: string, id: string) {
  const a = await db.query<{ name: string; definition: Definition }>(
    "select a.name, v.definition from automations a join automation_versions v on v.id = a.current_version_id where a.id = $1", [id]);
  if (!a.rowCount) throw new AutomationError("Automação não encontrada.");
  return createAutomation(db, orgId, userId, `${a.rows[0].name} (cópia)`, a.rows[0].definition);
}

/** Reprocessa uma execução que falhou, a partir do passo que falhou (passos anteriores não se repetem). */
export async function reprocessRun(db: Db, orgId: string, userId: string, runId: string) {
  const r = await db.query("update workflow_runs set status = 'running', attempts = 0, error = null, finished_at = null, resume_at = now() where id = $1 and status = 'failed'", [runId]);
  if (!r.rowCount) throw new AutomationError("Só execuções com falha podem ser reprocessadas.");
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "automation.run_reprocessed", targetType: "workflow_run", targetId: runId });
}

export async function cancelRun(db: Db, runId: string) {
  await db.query("update workflow_runs set status = 'canceled', finished_at = now() where id = $1 and status in ('running','waiting')", [runId]);
}
