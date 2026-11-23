import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import { withService, type Db } from "@/lib/db";
import { env } from "@/lib/env";
import { moveDeal } from "@/modules/crm/service";
import { isWindowOpen } from "@/modules/whatsapp/rules";
import { checkContact, loadTemplate, queueTemplateMessage, TemplateSendError, BLOCK_LABEL } from "@/modules/messaging/template-send";
import { enqueue } from "@/modules/jobs/queue";
import { definitionSchema, STEP_LABEL, type Definition, type Step, type Trigger } from "./definition";

export const MAX_DEPTH = 3; // eventos gerados por automações podem disparar no máximo 3 níveis (evita laços)
export const MAX_RUNS_PER_DAY = 2000;
const MAX_ATTEMPTS = 3;

class StepFailure extends Error { constructor(message: string, readonly retryable = false) { super(message); } }
class StopRun extends Error {}

// ---------------------------------------------------------------------------------------------
// Distribuição de eventos → execuções
// ---------------------------------------------------------------------------------------------
function matches(trigger: Trigger, ev: { type: string; payload: Record<string, unknown> }) {
  if (trigger.type !== ev.type) return false;
  if (trigger.type === "deal.stage_changed" && trigger.stageId && ev.payload.stageId !== trigger.stageId) return false;
  if (trigger.type === "appointment.status_changed" && trigger.status && ev.payload.status !== trigger.status) return false;
  return true;
}

async function createRun(db: Db, orgId: string, a: { id: string; version_id: string }, eventKey: string,
  refs: { contactId: string | null; dealId?: string | null; appointmentId?: string | null }, depth: number) {
  const today = await db.query<{ n: string }>("select count(*) n from workflow_runs where organization_id = $1 and started_at > now() - interval '24 hours'", [orgId]);
  if (Number(today.rows[0].n) >= MAX_RUNS_PER_DAY) return false;
  const r = await db.query(
    `insert into workflow_runs (organization_id, automation_id, version_id, event_key, contact_id, deal_id, appointment_id, depth)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
    [orgId, a.id, a.version_id, eventKey, refs.contactId, refs.dealId ?? null, refs.appointmentId ?? null, depth]);
  return (r.rowCount ?? 0) > 0;
}

export async function processEvents(db: Db, limit = 200) {
  const evs = await db.query<{ id: string; organization_id: string; type: string; contact_id: string | null; deal_id: string | null; appointment_id: string | null; payload: Record<string, unknown>; depth: number; created_at: Date }>(
    "select * from domain_events where processed_at is null order by id limit $1 for update skip locked", [limit]);
  let created = 0;
  for (const ev of evs.rows) {
    if (ev.depth < MAX_DEPTH && ev.contact_id) {
      const autos = await db.query<{ id: string; version_id: string; definition: Definition }>(
        `select a.id, v.id as version_id, v.definition from automations a join automation_versions v on v.id = a.current_version_id
         where a.organization_id = $1 and a.status = 'active' and a.trigger_type = $2 and a.activated_at <= $3`, [ev.organization_id, ev.type, ev.created_at]);
      for (const a of autos.rows) {
        if (!matches(a.definition.trigger, ev)) continue;
        if (await createRun(db, ev.organization_id, a, `event:${ev.id}`, { contactId: ev.contact_id, dealId: ev.deal_id, appointmentId: ev.appointment_id }, ev.depth)) created++;
      }
    }
    await db.query("update domain_events set processed_at = now() where id = $1", [ev.id]);
  }
  return created;
}

/** Gatilho por tempo: cliente sem responder há N horas depois da última mensagem da equipe. Uma execução por "silêncio". */
export async function scanNoReply(db: Db) {
  const autos = await db.query<{ id: string; organization_id: string; version_id: string; definition: Definition; activated_at: Date }>(
    `select a.id, a.organization_id, v.id as version_id, v.definition, a.activated_at from automations a join automation_versions v on v.id = a.current_version_id
     where a.status = 'active' and a.trigger_type = 'conversation.no_reply'`);
  let created = 0;
  for (const a of autos.rows) {
    const t = a.definition.trigger;
    if (t.type !== "conversation.no_reply") continue;
    const rows = await db.query<{ id: string; ts: string }>(
      `select c.id, extract(epoch from c.last_outbound_at)::bigint::text as ts from contacts c
       where c.organization_id = $1 and c.deleted_at is null and not c.is_demo
         and c.last_outbound_at is not null and (c.last_inbound_at is null or c.last_inbound_at < c.last_outbound_at)
         and c.last_outbound_at < now() - make_interval(hours => $2) and c.last_outbound_at > now() - make_interval(hours => $2 + 168)
         and c.last_outbound_at + make_interval(hours => $2) >= $3
       limit 500`, [a.organization_id, t.hours, a.activated_at]);
    for (const r of rows.rows) {
      if (await createRun(db, a.organization_id, a, `noreply:${r.id}:${r.ts}`, { contactId: r.id }, 0)) created++;
    }
  }
  return created;
}

// ---------------------------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------------------------
interface Run {
  id: string; organization_id: string; automation_id: string; version_id: string; contact_id: string | null; deal_id: string | null;
  depth: number; status: string; current_step: number; attempts: number; started_at: Date; definition: Definition;
}

async function log(db: Db, run: Run, index: number, type: string, status: "ok" | "stopped" | "failed" | "waiting" | "skipped", detail: string) {
  await db.query("insert into workflow_run_steps (organization_id, run_id, step_index, step_type, status, detail) values ($1,$2,$3,$4,$5,$6)",
    [run.organization_id, run.id, index, type, status, detail.slice(0, 1000)]);
}

async function openDeal(db: Db, run: Run) {
  if (run.deal_id) {
    const d = await db.query<{ id: string; status: string }>("select id, status from deals where id = $1", [run.deal_id]);
    if (d.rows[0]?.status === "open") return d.rows[0].id;
  }
  const d = await db.query<{ id: string }>("select id from deals where contact_id = $1 and status = 'open' order by created_at desc limit 1", [run.contact_id]);
  return d.rows[0]?.id ?? null;
}

export async function evaluateCondition(db: Db, ctx: { contactId: string; dealId: string | null; startedAt: Date }, check: Extract<Step, { type: "condition" }>["check"]): Promise<boolean> {
  switch (check.kind) {
    case "has_tag": return !!(await db.query("select 1 from contact_tags where contact_id = $1 and tag_id = $2", [ctx.contactId, check.tagId])).rowCount;
    case "temperature_is": return !!(await db.query("select 1 from contacts where id = $1 and temperature = $2", [ctx.contactId, check.value])).rowCount;
    case "has_open_deal": return !!(await db.query("select 1 from deals where contact_id = $1 and status = 'open'", [ctx.contactId])).rowCount;
    case "deal_in_stage": return !!(await db.query("select 1 from deals where contact_id = $1 and stage_id = $2 and status = 'open'", [ctx.contactId, check.stageId])).rowCount;
    case "replied_since_start": return !!(await db.query("select 1 from contacts where id = $1 and last_inbound_at > $2", [ctx.contactId, ctx.startedAt])).rowCount;
    case "marketing_consent": return (await db.query<{ status: string }>("select status from consent_records where contact_id = $1 and purpose = 'marketing' order by recorded_at desc limit 1", [ctx.contactId])).rows[0]?.status === "granted";
  }
}

/** Bloqueia webhooks para a rede interna (proteção contra SSRF). */
export async function assertPublicUrl(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new StepFailure("Webhook precisa usar https.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new StepFailure("Não foi possível resolver o endereço do webhook.", true); });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address) || /^(::1|fc|fd|fe80|::ffff:(10|127|192\.168|169\.254)\.)/i.test(address) || address === "::") {
      throw new StepFailure("Webhook aponta para um endereço interno e foi bloqueado.");
    }
  }
}

async function executeStep(db: Db, run: Run, index: number, step: Step): Promise<{ status: "ok" | "skipped" | "waiting"; detail: string; resumeAt?: Date }> {
  const contactId = run.contact_id!;
  const orgId = run.organization_id;
  switch (step.type) {
    case "wait": {
      const resumeAt = new Date(Date.now() + step.minutes * 60_000);
      return { status: "waiting", detail: `Aguardando até ${resumeAt.toISOString()}`, resumeAt };
    }
    case "condition": {
      const ok = await evaluateCondition(db, { contactId, dealId: run.deal_id, startedAt: run.started_at }, step.check);
      if (ok === step.negate) throw new StopRun(`Condição não atendida (${step.check.kind}${step.negate ? ", negada" : ""}).`);
      return { status: "ok", detail: "Condição atendida." };
    }
    case "add_tag":
      await db.query("insert into contact_tags (organization_id, contact_id, tag_id) select $1, $2, id from tags where id = $3 and organization_id = $1 on conflict do nothing", [orgId, contactId, step.tagId]);
      return { status: "ok", detail: "Etiqueta adicionada." };
    case "remove_tag":
      await db.query("delete from contact_tags where contact_id = $1 and tag_id = $2", [contactId, step.tagId]);
      return { status: "ok", detail: "Etiqueta removida." };
    case "set_temperature":
      await db.query("update contacts set temperature = $2, updated_at = now() where id = $1 and organization_id = $3", [contactId, step.value, orgId]);
      return { status: "ok", detail: `Temperatura definida: ${step.value}.` };
    case "assign_owner": {
      let userId = step.userId;
      if (step.mode === "round_robin") {
        // quem tem menos contatos atribuídos nos últimos 30 dias
        const u = await db.query<{ user_id: string }>(
          `select m.user_id from memberships m
           left join contacts c on c.owner_user_id = m.user_id and c.organization_id = m.organization_id and c.created_at > now() - interval '30 days'
           where m.organization_id = $1 and m.status = 'active' group by m.user_id, m.created_at order by count(c.id), m.created_at limit 1`, [orgId]);
        userId = u.rows[0]?.user_id ?? null;
      } else if (userId && !(await db.query("select 1 from memberships where organization_id = $1 and user_id = $2 and status = 'active'", [orgId, userId])).rowCount) {
        throw new StepFailure("Usuário escolhido não faz mais parte da equipe.");
      }
      if (!userId) throw new StepFailure("Nenhum membro ativo para atribuir.");
      await db.query("update contacts set owner_user_id = $2, updated_at = now() where id = $1", [contactId, userId]);
      await db.query("update deals set owner_user_id = $2 where contact_id = $1 and status = 'open' and owner_user_id is null", [contactId, userId]);
      return { status: "ok", detail: "Responsável atribuído." };
    }
    case "create_task": {
      const owner = await db.query<{ owner_user_id: string | null }>("select owner_user_id from contacts where id = $1", [contactId]);
      await db.query(
        "insert into tasks (organization_id, contact_id, deal_id, assignee_user_id, title, due_at, created_by_type) values ($1,$2,$3,$4,$5, now() + make_interval(hours => $6), 'system')",
        [orgId, contactId, await openDeal(db, run), owner.rows[0]?.owner_user_id ?? null, step.title, step.dueHours]);
      return { status: "ok", detail: "Tarefa criada." };
    }
    case "move_deal": {
      const dealId = await openDeal(db, run);
      if (!dealId) return { status: "skipped", detail: "Contato sem negócio aberto." };
      const st = await db.query("select 1 from pipeline_stages where id = $1 and organization_id = $2", [step.stageId, orgId]);
      if (!st.rowCount) throw new StepFailure("Etapa configurada não existe mais.");
      await moveDeal(db, orgId, null, dealId, step.stageId, undefined, { depth: run.depth + 1 });
      return { status: "ok", detail: "Negócio movido." };
    }
    case "send_template": {
      const tpl = await loadTemplate(db, step.templateId);
      if (!tpl) throw new StepFailure("Template não encontrado.");
      const block = await checkContact(db, contactId, tpl);
      if (block) return { status: "skipped", detail: `Envio não permitido: ${BLOCK_LABEL[block]}.` };
      const contact = (await db.query<{ id: string; display_name: string }>("select id, display_name from contacts where id = $1", [contactId])).rows[0];
      try {
        await queueTemplateMessage(db, orgId, contact, tpl, step.params, { idempotencyKey: `run:${run.id}:${index}` });
      } catch (e) {
        if (e instanceof TemplateSendError) throw new StepFailure(e.message);
        throw e;
      }
      return { status: "ok", detail: `Template "${tpl.name}" enfileirado.` };
    }
    case "send_text": {
      const conv = await db.query<{ id: string; service_window_expires_at: Date | null; channel_account_id: string | null }>(
        "select id, service_window_expires_at, channel_account_id from conversations where contact_id = $1 and channel_account_id is not null order by last_message_at desc nulls last limit 1", [contactId]);
      const c = conv.rows[0];
      if (!c || !isWindowOpen(c.service_window_expires_at)) return { status: "skipped", detail: "Janela de 24h fechada: texto livre não permitido." };
      const m = await db.query<{ id: string }>(
        `insert into messages (organization_id, conversation_id, direction, sender_type, type, body, status, idempotency_key)
         values ($1,$2,'outbound','system','text',$3,'pending',$4) on conflict (organization_id, idempotency_key) do nothing returning id`,
        [orgId, c.id, step.text, `run:${run.id}:${index}`]);
      if (m.rowCount) await enqueue(db, "whatsapp.send", { messageId: m.rows[0].id, orgId });
      return { status: "ok", detail: "Texto enfileirado." };
    }
    case "webhook": {
      await assertPublicUrl(step.url);
      const contact = (await db.query("select id, display_name, phone_e164, email, temperature, source, created_at from contacts where id = $1", [contactId])).rows[0];
      const body = JSON.stringify({ event: "automation.step", automationId: run.automation_id, runId: run.id, step: index, contact, sentAt: new Date().toISOString() });
      const sig = createHmac("sha256", env().ENCRYPTION_KEY + ":webhook:" + orgId).update(body).digest("hex");
      let res: Response;
      try {
        res = await fetch(step.url, { method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/json", "X-Retoma-Signature": `sha256=${sig}`, "Idempotency-Key": `${run.id}:${index}` } });
      } catch (e) {
        throw new StepFailure(`Falha de rede no webhook: ${(e as Error).message}`, true);
      }
      if (res.status >= 500 || res.status === 429) throw new StepFailure(`Webhook respondeu ${res.status}.`, true);
      if (res.status >= 300) throw new StepFailure(`Webhook respondeu ${res.status}.`);
      return { status: "ok", detail: `Webhook respondeu ${res.status}.` };
    }
  }
}

/** Avança uma execução: cada passo em sua própria transação (efeitos colaterais confirmados um a um). */
export async function advanceRun(runId: string) {
  for (let guard = 0; guard < 25; guard++) {
    const outcome = await withService(async (db) => {
      const r = await db.query<Run>(
        `select r.*, v.definition from workflow_runs r join automation_versions v on v.id = r.version_id
         where r.id = $1 and r.status in ('running','waiting') and r.resume_at <= now() for update of r skip locked`, [runId]);
      const run = r.rows[0];
      if (!run) return "done";
      const def = definitionSchema.parse(run.definition);
      if (!run.contact_id) { await db.query("update workflow_runs set status = 'stopped', finished_at = now(), error = 'Contato removido' where id = $1", [run.id]); return "done"; }
      const contactOk = await db.query("select 1 from contacts where id = $1 and deleted_at is null", [run.contact_id]);
      if (!contactOk.rowCount) { await db.query("update workflow_runs set status = 'stopped', finished_at = now(), error = 'Contato removido' where id = $1", [run.id]); return "done"; }
      if (run.current_step >= def.steps.length) {
        await db.query("update workflow_runs set status = 'succeeded', finished_at = now() where id = $1", [run.id]);
        return "done";
      }
      const i = run.current_step;
      const step = def.steps[i];
      await db.query("savepoint step");
      try {
        const res = await executeStep(db, run, i, step);
        await db.query("release savepoint step");
        await log(db, run, i, step.type, res.status, res.detail);
        if (res.status === "waiting") {
          await db.query("update workflow_runs set status = 'waiting', current_step = $2, resume_at = $3, attempts = 0 where id = $1", [run.id, i + 1, res.resumeAt]);
          return "done";
        }
        await db.query("update workflow_runs set status = 'running', current_step = $2, attempts = 0, resume_at = now() where id = $1", [run.id, i + 1]);
        return "continue";
      } catch (e) {
        await db.query("rollback to savepoint step");
        if (e instanceof StopRun) {
          await log(db, run, i, step.type, "stopped", e.message);
          await db.query("update workflow_runs set status = 'stopped', finished_at = now() where id = $1", [run.id]);
          return "done";
        }
        const fail = e instanceof StepFailure ? e : new StepFailure((e as Error).message);
        const attempts = run.attempts + 1;
        if (fail.retryable && attempts < MAX_ATTEMPTS) {
          await log(db, run, i, step.type, "failed", `${fail.message} Nova tentativa agendada.`);
          await db.query("update workflow_runs set attempts = $2, resume_at = now() + make_interval(mins => $3), error = $4 where id = $1", [run.id, attempts, 2 ** attempts, fail.message]);
        } else {
          await log(db, run, i, step.type, "failed", fail.message);
          await db.query("update workflow_runs set status = 'failed', attempts = $2, error = $3, finished_at = now() where id = $1", [run.id, attempts, `Passo ${i + 1} (${STEP_LABEL[step.type]}): ${fail.message}`]);
        }
        return "done";
      }
    });
    if (outcome === "done") return;
  }
}

export async function runDueWorkflows(limit = 50) {
  const due = await withService((db) => db.query<{ id: string }>(
    "select id from workflow_runs where status in ('running','waiting') and resume_at <= now() order by resume_at limit $1", [limit]));
  for (const r of due.rows) await advanceRun(r.id);
  return due.rows.length;
}

// ---------------------------------------------------------------------------------------------
// Simulação (sem efeitos): mostra o que aconteceria para um contato agora
// ---------------------------------------------------------------------------------------------
export async function simulate(db: Db, def: Definition, contactId: string) {
  const out: { step: number; label: string; result: string }[] = [];
  const deal = await db.query<{ id: string }>("select id from deals where contact_id = $1 and status = 'open' order by created_at desc limit 1", [contactId]);
  for (const [i, step] of def.steps.entries()) {
    const label = STEP_LABEL[step.type];
    if (step.type === "condition") {
      const ok = await evaluateCondition(db, { contactId, dealId: deal.rows[0]?.id ?? null, startedAt: new Date() }, step.check);
      if (ok === step.negate) { out.push({ step: i + 1, label, result: "não atendida — a execução pararia aqui" }); break; }
      out.push({ step: i + 1, label, result: "atendida" });
    } else if (step.type === "wait") {
      out.push({ step: i + 1, label, result: `esperaria ${step.minutes >= 1440 ? `${Math.round(step.minutes / 1440)} dia(s)` : step.minutes >= 60 ? `${Math.round(step.minutes / 60)} hora(s)` : `${step.minutes} min`} (condições seguintes são avaliadas com os dados de agora)` });
    } else if (step.type === "send_template") {
      const tpl = await loadTemplate(db, step.templateId);
      const block = tpl ? await checkContact(db, contactId, tpl) : "template_not_approved";
      out.push({ step: i + 1, label, result: block ? `seria pulado: ${BLOCK_LABEL[block]}` : `enviaria "${tpl!.name}"` });
    } else if (step.type === "move_deal" && !deal.rowCount) {
      out.push({ step: i + 1, label, result: "seria pulado: contato sem negócio aberto" });
    } else {
      out.push({ step: i + 1, label, result: "executaria" });
    }
  }
  return out;
}
