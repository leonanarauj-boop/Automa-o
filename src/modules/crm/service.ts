import { z } from "zod";
import type { Db } from "@/lib/db";
import { normalizePhone } from "@/modules/whatsapp/rules";
import { audit } from "@/modules/audit/audit";
import { markRecovered } from "@/modules/radar/service";

export class CrmError extends Error {}

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const contactSchema = z.object({
  displayName: z.string().trim().min(1, "Informe o nome").max(160),
  phone: optional(40),
  email: z.string().trim().max(200).optional().transform((v) => (v ? v : null))
    .refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
  company: optional(160),
  notes: optional(4000),
  temperature: z.enum(["cold", "warm", "hot", ""]).optional().transform((v) => (v ? v : null)),
});

function phoneOrThrow(phone: string | null) {
  if (!phone) return null;
  const p = normalizePhone(phone);
  if (!p) throw new CrmError("Telefone inválido. Use DDD + número, por exemplo (11) 91234-5678.");
  return p;
}

export async function createContact(db: Db, orgId: string, userId: string, input: z.input<typeof contactSchema>) {
  const d = contactSchema.parse(input);
  const phone = phoneOrThrow(d.phone);
  try {
    const r = await db.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, phone_e164, wa_id, email, company, notes, temperature, owner_user_id, source)
       values ($1,$2,$3,$3,$4,$5,$6,$7,$8,'manual') returning id`,
      [orgId, d.displayName, phone, d.email, d.company, d.notes, d.temperature, userId],
    );
    await audit(db, { orgId, actorType: "user", actorId: userId, action: "contact.created", targetType: "contact", targetId: r.rows[0].id });
    return r.rows[0].id;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new CrmError("Já existe um contato com este telefone.");
    throw e;
  }
}

export async function updateContact(db: Db, orgId: string, userId: string, contactId: string, input: z.input<typeof contactSchema>) {
  const d = contactSchema.parse(input);
  const phone = phoneOrThrow(d.phone);
  try {
    const r = await db.query(
      `update contacts set display_name=$2, phone_e164=$3, wa_id=coalesce(wa_id,$3), email=$4, company=$5, notes=$6, temperature=$7, updated_at=now()
       where id=$1 and deleted_at is null`,
      [contactId, d.displayName, phone, d.email, d.company, d.notes, d.temperature],
    );
    if (!r.rowCount) throw new CrmError("Contato não encontrado.");
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new CrmError("Já existe um contato com este telefone.");
    throw e;
  }
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "contact.updated", targetType: "contact", targetId: contactId });
}

export async function listContacts(db: Db, opts: { q?: string; tagId?: string; limit?: number; offset?: number }) {
  const q = opts.q?.trim() ? `%${opts.q.trim().replace(/[%_]/g, "\\$&")}%` : null;
  const r = await db.query<{
    id: string; display_name: string; phone_e164: string | null; email: string | null; company: string | null;
    temperature: string | null; is_demo: boolean; last_activity: Date | null; tags: string[] | null; total: string;
  }>(
    `select c.id, c.display_name, c.phone_e164, c.email, c.company, c.temperature, c.is_demo,
            greatest(c.last_inbound_at, c.last_outbound_at) as last_activity,
            (select array_agg(t.name order by t.name) from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = c.id) as tags,
            count(*) over() as total
     from contacts c
     where c.deleted_at is null
       and ($1::text is null or c.display_name ilike $1 or c.phone_e164 ilike $1 or c.email ilike $1 or c.company ilike $1)
       and ($2::uuid is null or exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = $2))
     order by greatest(c.last_inbound_at, c.last_outbound_at, c.created_at) desc nulls last
     limit $3 offset $4`,
    [q, opts.tagId ?? null, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows: r.rows, total: Number(r.rows[0]?.total ?? 0) };
}

export async function getContact(db: Db, contactId: string) {
  const c = await db.query<{
    id: string; display_name: string; phone_e164: string | null; wa_id: string | null; email: string | null; company: string | null;
    notes: string | null; temperature: string | null; source: string; is_demo: boolean; created_at: Date;
    last_inbound_at: Date | null; last_outbound_at: Date | null; ai_summary: string | null; ai_summary_updated_at: Date | null;
  }>("select * from contacts where id = $1 and deleted_at is null", [contactId]);
  if (!c.rowCount) return null;
  const [tags, deals, notes, tasks, conv, consent] = await Promise.all([
    db.query<{ id: string; name: string }>("select t.id, t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 order by t.name", [contactId]),
    db.query<{ id: string; title: string; value_cents: string; status: string; stage_name: string; created_at: Date }>(
      "select d.id, d.title, d.value_cents, d.status, s.name as stage_name, d.created_at from deals d join pipeline_stages s on s.id = d.stage_id where d.contact_id = $1 order by d.created_at desc", [contactId]),
    db.query<{ id: string; body: string; created_at: Date; author: string | null }>(
      "select n.id, n.body, n.created_at, u.full_name as author from contact_notes n left join users u on u.id = n.author_user_id where n.contact_id = $1 order by n.created_at desc", [contactId]),
    db.query<{ id: string; title: string; due_at: Date | null; status: string }>("select id, title, due_at, status from tasks where contact_id = $1 order by status, due_at nulls last", [contactId]),
    db.query<{ id: string }>("select id from conversations where contact_id = $1 order by last_message_at desc nulls last limit 1", [contactId]),
    db.query<{ purpose: string; status: string; recorded_at: Date; source: string }>(
      "select distinct on (purpose) purpose, status, recorded_at, source from consent_records where contact_id = $1 order by purpose, recorded_at desc", [contactId]),
  ]);
  return { contact: c.rows[0], tags: tags.rows, deals: deals.rows, notes: notes.rows, tasks: tasks.rows, conversationId: conv.rows[0]?.id ?? null, consent: consent.rows };
}

export async function setContactTags(db: Db, orgId: string, contactId: string, tagIds: string[]) {
  await db.query("delete from contact_tags where contact_id = $1", [contactId]);
  for (const tagId of tagIds) {
    await db.query("insert into contact_tags (organization_id, contact_id, tag_id) values ($1,$2,$3) on conflict do nothing", [orgId, contactId, tagId]);
  }
}

export async function addNote(db: Db, orgId: string, userId: string, contactId: string, body: string) {
  const text = z.string().trim().min(1, "Nota vazia").max(4000).parse(body);
  await db.query("insert into contact_notes (organization_id, contact_id, author_user_id, body) values ($1,$2,$3,$4)", [orgId, contactId, userId, text]);
}

export async function recordConsent(db: Db, orgId: string, userId: string, contactId: string, purpose: "marketing" | "service", status: "granted" | "revoked", evidence: string) {
  const ev = z.string().trim().min(3, "Descreva como o consentimento foi obtido").max(500).parse(evidence);
  await db.query(
    "insert into consent_records (organization_id, contact_id, purpose, status, source, evidence, recorded_by) values ($1,$2,$3,$4,'manual',$5,$6)",
    [orgId, contactId, purpose, status, ev, userId],
  );
  await audit(db, { orgId, actorType: "user", actorId: userId, action: `consent.${purpose}.${status}`, targetType: "contact", targetId: contactId });
}

// ---------------- Negócios / funil ----------------

export const dealSchema = z.object({
  contactId: z.string().uuid("Selecione um contato"),
  title: z.string().trim().min(1, "Informe um título").max(160),
  value: z.string().optional().transform((v, ctx) => {
    if (!v || !v.trim()) return 0;
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 1e10) { ctx.addIssue({ code: "custom", message: "Valor inválido" }); return z.NEVER; }
    return Math.round(n * 100);
  }),
  stageId: z.string().uuid().optional(),
});

export async function getDefaultPipeline(db: Db) {
  const p = await db.query<{ id: string; name: string }>("select id, name from pipelines where is_default limit 1");
  if (!p.rowCount) throw new CrmError("Funil padrão não encontrado.");
  const stages = await db.query<{ id: string; name: string; position: number; kind: "open" | "won" | "lost" }>(
    "select id, name, position, kind from pipeline_stages where pipeline_id = $1 order by position", [p.rows[0].id]);
  return { ...p.rows[0], stages: stages.rows };
}

export async function createDeal(db: Db, orgId: string, userId: string, input: z.input<typeof dealSchema>) {
  const d = dealSchema.parse(input);
  const pipe = await getDefaultPipeline(db);
  const stage = pipe.stages.find((s) => s.id === d.stageId) ?? pipe.stages.find((s) => s.kind === "open")!;
  const contact = await db.query("select 1 from contacts where id = $1 and deleted_at is null", [d.contactId]);
  if (!contact.rowCount) throw new CrmError("Contato não encontrado.");
  const r = await db.query<{ id: string }>(
    `insert into deals (organization_id, contact_id, pipeline_id, stage_id, owner_user_id, title, value_cents, status, won_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, case when $8 = 'won' then now() end) returning id`,
    [orgId, d.contactId, pipe.id, stage.id, userId, d.title, d.value, stage.kind],
  );
  await db.query("insert into deal_stage_history (organization_id, deal_id, to_stage_id, changed_by) values ($1,$2,$3,$4)", [orgId, r.rows[0].id, stage.id, userId]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "deal.created", targetType: "deal", targetId: r.rows[0].id });
  return r.rows[0].id;
}

export async function moveDeal(db: Db, orgId: string, userId: string, dealId: string, stageId: string, lostReason?: string) {
  const cur = await db.query<{ stage_id: string; pipeline_id: string }>("select stage_id, pipeline_id from deals where id = $1 for update", [dealId]);
  if (!cur.rowCount) throw new CrmError("Negócio não encontrado.");
  const st = await db.query<{ kind: "open" | "won" | "lost" }>("select kind from pipeline_stages where id = $1 and pipeline_id = $2", [stageId, cur.rows[0].pipeline_id]);
  if (!st.rowCount) throw new CrmError("Etapa inválida.");
  if (cur.rows[0].stage_id === stageId) return;
  const kind = st.rows[0].kind;
  await db.query(
    `update deals set stage_id = $2, status = $3, won_at = case when $3 = 'won' then now() else null end,
       lost_reason = case when $3 = 'lost' then $4 else null end, last_activity_at = now(), updated_at = now()
     where id = $1`,
    [dealId, stageId, kind, lostReason?.trim().slice(0, 300) || null],
  );
  await db.query("insert into deal_stage_history (organization_id, deal_id, from_stage_id, to_stage_id, changed_by) values ($1,$2,$3,$4,$5)",
    [orgId, dealId, cur.rows[0].stage_id, stageId, userId]);
  if (kind === "won") await markRecovered(db, orgId, dealId);
  if (kind === "lost") {
    await db.query("update opportunity_signals set status = 'resolved', resolved_at = now() where deal_id = $1 and status = 'open'", [dealId]);
  }
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "deal.moved", targetType: "deal", targetId: dealId, metadata: { stageId, kind } });
}

export async function updateDealValue(db: Db, dealId: string, value: string) {
  const parsed = dealSchema.shape.value.parse(value);
  const r = await db.query("update deals set value_cents = $2, updated_at = now() where id = $1", [dealId, parsed]);
  if (!r.rowCount) throw new CrmError("Negócio não encontrado.");
}

export async function boardDeals(db: Db, pipelineId: string) {
  const r = await db.query<{
    id: string; title: string; value_cents: string; stage_id: string; status: string; contact_id: string; contact_name: string;
    is_demo: boolean; last_activity_at: Date; owner_name: string | null;
  }>(
    `select d.id, d.title, d.value_cents, d.stage_id, d.status, d.contact_id, c.display_name as contact_name, d.is_demo, d.last_activity_at,
            u.full_name as owner_name
     from deals d join contacts c on c.id = d.contact_id left join users u on u.id = d.owner_user_id
     where d.pipeline_id = $1 and c.deleted_at is null
       and (d.status = 'open' or d.updated_at > now() - interval '30 days')
     order by d.last_activity_at desc`,
    [pipelineId],
  );
  return r.rows;
}

// ---------------- Tarefas ----------------

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Informe a tarefa").max(200),
  dueAt: z.string().optional().transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) { ctx.addIssue({ code: "custom", message: "Data inválida" }); return z.NEVER; }
    return d;
  }),
  contactId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
});

export async function createTask(db: Db, orgId: string, userId: string, input: z.input<typeof taskSchema>) {
  const d = taskSchema.parse(input);
  await db.query(
    "insert into tasks (organization_id, contact_id, assignee_user_id, title, due_at) values ($1,$2,$3,$4,$5)",
    [orgId, d.contactId, userId, d.title, d.dueAt],
  );
}

export async function setTaskDone(db: Db, taskId: string, done: boolean) {
  await db.query("update tasks set status = $2, completed_at = case when $2 = 'done' then now() end where id = $1", [taskId, done ? "done" : "open"]);
}
