import { z } from "zod";
import type { Db } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { BLOCK_LABEL, checkContact, dailyCapacity, loadTemplate, paramSourceSchema, queueTemplateMessage, renderParams, TemplateSendError, type ParamSource } from "@/modules/messaging/template-send";
import { renderTemplate } from "@/modules/whatsapp/rules";
import { assertFeature, BillingError } from "@/modules/billing/service";

export class CampaignError extends Error {}

// ---------------------------------------------------------------------------------------------
// Segmentação
// ---------------------------------------------------------------------------------------------
export const segmentSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  temperatures: z.array(z.enum(["cold", "warm", "hot"])).default([]),
  stageIds: z.array(z.string().uuid()).max(20).default([]),
  hasOpenDeal: z.boolean().nullable().default(null),
  inactiveDays: z.number().int().min(1).max(3650).nullable().default(null),
  activeDays: z.number().int().min(1).max(3650).nullable().default(null),
  createdWithinDays: z.number().int().min(1).max(3650).nullable().default(null),
});
export type Segment = z.infer<typeof segmentSchema>;

/** Monta o filtro SQL do segmento (sempre parametrizado). `$1` é a organização. */
export function segmentWhere(seg: Segment, startIndex = 2): { sql: string; params: unknown[] } {
  const parts: string[] = ["c.organization_id = $1", "c.deleted_at is null"];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${startIndex + params.length - 1}`; };
  if (seg.tagIds.length) parts.push(`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = any(${p(seg.tagIds)}::uuid[]))`);
  if (seg.temperatures.length) parts.push(`c.temperature = any(${p(seg.temperatures)}::text[])`);
  if (seg.stageIds.length) parts.push(`exists (select 1 from deals d where d.contact_id = c.id and d.stage_id = any(${p(seg.stageIds)}::uuid[]))`);
  if (seg.hasOpenDeal !== null) parts.push(`${seg.hasOpenDeal ? "" : "not "}exists (select 1 from deals d where d.contact_id = c.id and d.status = 'open')`);
  if (seg.inactiveDays) parts.push(`coalesce(greatest(c.last_inbound_at, c.last_outbound_at), c.created_at) < now() - make_interval(days => ${p(seg.inactiveDays)})`);
  if (seg.activeDays) parts.push(`greatest(c.last_inbound_at, c.last_outbound_at) >= now() - make_interval(days => ${p(seg.activeDays)})`);
  if (seg.createdWithinDays) parts.push(`c.created_at >= now() - make_interval(days => ${p(seg.createdWithinDays)})`);
  return { sql: parts.join(" and "), params };
}

type Reason = "demo" | "no_whatsapp" | "opted_out" | "no_marketing_consent" | "frequency";

/**
 * Classifica todos os contatos do segmento. Campanhas SEMPRE exigem consentimento de marketing
 * registrado, independentemente da categoria do template.
 */
async function classify(db: Db, orgId: string, seg: Segment, frequencyDays: number, campaignId: string | null) {
  const w = segmentWhere(seg, 4);
  const r = await db.query<{ id: string; display_name: string; reason: Reason | null }>(
    `select c.id, c.display_name,
       case
         when c.is_demo then 'demo'
         when c.wa_id is null then 'no_whatsapp'
         when lc.status = 'revoked' then 'opted_out'
         when lc.status is distinct from 'granted' then 'no_marketing_consent'
         when $2 > 0 and exists (select 1 from campaign_recipients cr where cr.contact_id = c.id and cr.status = 'queued' and not cr.is_test
                                 and cr.created_at > now() - make_interval(days => $2) and cr.campaign_id is distinct from $3::uuid) then 'frequency'
       end as reason
     from contacts c
     left join lateral (select status from consent_records cr where cr.contact_id = c.id and cr.purpose = 'marketing' order by recorded_at desc limit 1) lc on true
     where ${w.sql}
     order by greatest(c.last_inbound_at, c.last_outbound_at) desc nulls last, c.created_at desc`,
    [orgId, frequencyDays, campaignId, ...w.params]);
  return r.rows;
}

// ---------------------------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------------------------
export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  templateId: z.string().uuid().nullable(),
  paramMapping: z.array(paramSourceSchema).max(20),
  segment: segmentSchema,
  maxRecipients: z.number().int().min(1).max(100000).default(1000),
});

interface CampaignRow {
  id: string; organization_id: string; name: string; template_id: string | null; param_mapping: ParamSource[]; segment: Segment;
  status: string; scheduled_at: Date | null; max_recipients: number; approved_at: Date | null; started_at: Date | null; finished_at: Date | null;
}

export async function getCampaign(db: Db, id: string) {
  const r = await db.query<CampaignRow>("select * from campaigns where id = $1", [id]);
  if (!r.rowCount) throw new CampaignError("Campanha não encontrada.");
  return r.rows[0];
}

export async function saveCampaign(db: Db, orgId: string, userId: string, input: z.input<typeof campaignSchema>, id?: string) {
  const d = campaignSchema.parse(input);
  if (id) {
    const c = await getCampaign(db, id);
    if (!["draft", "pending_approval"].includes(c.status)) throw new CampaignError("Campanhas agendadas ou enviadas não podem ser editadas. Cancele ou duplique.");
    await db.query("update campaigns set name=$2, template_id=$3, param_mapping=$4, segment=$5, max_recipients=$6, status='draft', updated_at=now() where id=$1",
      [id, d.name, d.templateId, JSON.stringify(d.paramMapping), JSON.stringify(d.segment), d.maxRecipients]);
    return id;
  }
  const r = await db.query<{ id: string }>(
    "insert into campaigns (organization_id, name, template_id, param_mapping, segment, max_recipients, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [orgId, d.name, d.templateId, JSON.stringify(d.paramMapping), JSON.stringify(d.segment), d.maxRecipients, userId]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "campaign.created", targetType: "campaign", targetId: r.rows[0].id });
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------------------------
// Pré-visualização
// ---------------------------------------------------------------------------------------------
export async function preview(db: Db, orgId: string, campaignId: string) {
  const c = await getCampaign(db, campaignId);
  const org = (await db.query<{ campaign_frequency_days: number }>("select campaign_frequency_days from organizations where id = $1", [orgId])).rows[0];
  const rows = await classify(db, orgId, segmentSchema.parse(c.segment), org.campaign_frequency_days, campaignId);
  const eligible = rows.filter((r) => !r.reason);
  const excluded: Record<string, number> = {};
  for (const r of rows) if (r.reason) excluded[r.reason] = (excluded[r.reason] ?? 0) + 1;
  const capacity = await dailyCapacity(db, orgId);
  const tpl = c.template_id ? await loadTemplate(db, c.template_id) : null;
  const problems: string[] = [];
  if (!tpl) problems.push("Escolha um template.");
  else {
    if (tpl.status !== "APPROVED") problems.push("O template escolhido não está aprovado pela Meta.");
    if (c.param_mapping.length !== tpl.body_param_count) problems.push(`O template tem ${tpl.body_param_count} variável(is); configure todas.`);
    if (c.param_mapping.some((m) => m.source === "fixed" && !m.value?.trim())) problems.push("Preencha os textos fixos das variáveis.");
    const ch = await db.query<{ status: string }>("select status from channel_accounts where id = $1", [tpl.channel_account_id]);
    if (ch.rows[0]?.status !== "active") problems.push("O número de WhatsApp do template está desconectado.");
  }
  if (!eligible.length) problems.push("Nenhum contato elegível no segmento.");
  const willSend = Math.min(eligible.length, c.max_recipients, capacity.remaining);
  const samples = tpl?.body_text ? eligible.slice(0, 3).map((e) => ({ name: e.display_name, text: renderTemplate(tpl.body_text!, renderParams(c.param_mapping, e)) })) : [];
  return {
    total: rows.length, eligible: eligible.length, excluded, capacity, willSend, problems, samples,
    template: tpl ? { name: tpl.name, category: tpl.category, status: tpl.status } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Fluxo de aprovação
// ---------------------------------------------------------------------------------------------
export async function requestApproval(db: Db, orgId: string, userId: string, campaignId: string) {
  const c = await getCampaign(db, campaignId);
  if (c.status !== "draft") throw new CampaignError("Só rascunhos podem ser enviados para aprovação.");
  const pv = await preview(db, orgId, campaignId);
  if (pv.problems.length) throw new CampaignError(pv.problems[0]);
  await db.query("update campaigns set status = 'pending_approval', updated_at = now() where id = $1", [campaignId]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "campaign.approval_requested", targetType: "campaign", targetId: campaignId });
}

/** Aprovação (somente gestor/dono): valida tudo de novo e agenda. */
export async function approve(db: Db, orgId: string, userId: string, campaignId: string, scheduledAt: Date) {
  const c = await getCampaign(db, campaignId);
  if (!["draft", "pending_approval"].includes(c.status)) throw new CampaignError("Esta campanha não pode ser aprovada no estado atual.");
  try { await assertFeature(db, orgId, "campaigns"); } catch (e) { if (e instanceof BillingError) throw new CampaignError(e.message); throw e; }
  if (scheduledAt.getTime() < Date.now() - 60_000) throw new CampaignError("A data de envio não pode estar no passado.");
  const pv = await preview(db, orgId, campaignId);
  if (pv.problems.length) throw new CampaignError(pv.problems[0]);
  await db.query("update campaigns set status = 'scheduled', scheduled_at = $2, approved_by = $3, approved_at = now(), updated_at = now() where id = $1",
    [campaignId, scheduledAt, userId]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "campaign.approved", targetType: "campaign", targetId: campaignId, metadata: { scheduledAt, eligible: pv.eligible } });
}

export async function cancel(db: Db, orgId: string, userId: string, campaignId: string) {
  const c = await getCampaign(db, campaignId);
  if (c.status === "canceled") return;
  if (c.status === "done" || c.status === "sending") {
    // interrompe o que ainda não saiu
    await db.query(
      `update messages set status = 'failed', error = 'Campanha cancelada' where status = 'pending'
       and id in (select message_id from campaign_recipients where campaign_id = $1 and message_id is not null)`, [campaignId]);
    await db.query("update campaign_recipients set status = 'canceled' where campaign_id = $1 and message_id in (select id from messages where status = 'failed' and error = 'Campanha cancelada')", [campaignId]);
  }
  await db.query("update campaigns set status = 'canceled', updated_at = now(), finished_at = coalesce(finished_at, now()) where id = $1", [campaignId]);
  await audit(db, { orgId, actorType: "user", actorId: userId, action: "campaign.canceled", targetType: "campaign", targetId: campaignId });
}

/** Envio de teste para UM contato (que também precisa ter consentimento). */
export async function sendTest(db: Db, orgId: string, userId: string, campaignId: string, contactId: string) {
  const c = await getCampaign(db, campaignId);
  if (!c.template_id) throw new CampaignError("Escolha um template.");
  const tpl = await loadTemplate(db, c.template_id);
  if (!tpl) throw new CampaignError("Template não encontrado.");
  const block = await checkContact(db, contactId, tpl, { requireMarketingConsent: true });
  if (block) throw new CampaignError(`Este contato não pode receber: ${BLOCK_LABEL[block]}.`);
  const contact = (await db.query<{ id: string; display_name: string }>("select id, display_name from contacts where id = $1", [contactId])).rows[0];
  try {
    const messageId = await queueTemplateMessage(db, orgId, contact, tpl, c.param_mapping, { idempotencyKey: `campaign-test:${campaignId}:${contactId}:${Date.now()}`, senderUserId: userId });
    await db.query("insert into campaign_recipients (organization_id, campaign_id, contact_id, status, message_id, is_test) values ($1,$2,$3,'queued',$4,true)", [orgId, campaignId, contactId, messageId]);
  } catch (e) {
    if (e instanceof TemplateSendError) throw new CampaignError(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Disparo (worker, contexto de serviço)
// ---------------------------------------------------------------------------------------------
const SPACING_MS = 200; // ~5 mensagens por segundo

export async function dispatchDueCampaigns(db: Db) {
  const due = await db.query<CampaignRow & { campaign_frequency_days: number }>(
    `select c.*, o.campaign_frequency_days from campaigns c join organizations o on o.id = c.organization_id and o.status in ('trial','active','past_due')
     where c.status = 'scheduled' and c.scheduled_at <= now()
       and o.plan in ('trial','professional','business') -- planos com campanhas (ver billing/plans.ts)
     order by c.scheduled_at limit 5 for update of c skip locked`);
  let total = 0;
  for (const c of due.rows) {
    await db.query("update campaigns set status = 'sending', started_at = now() where id = $1", [c.id]);
    const tpl = c.template_id ? await loadTemplate(db, c.template_id) : null;
    const rows = await classify(db, c.organization_id, segmentSchema.parse(c.segment), c.campaign_frequency_days, c.id);
    const capacity = await dailyCapacity(db, c.organization_id);
    let sent = 0;
    for (const r of rows) {
      let reason: string | null = r.reason;
      if (!reason && !tpl) reason = "template_not_approved";
      if (!reason && sent >= c.max_recipients) reason = "max_recipients";
      if (!reason && sent >= capacity.remaining) reason = "daily_limit";
      if (!reason && tpl) {
        const block = await checkContact(db, r.id, tpl, { requireMarketingConsent: true });
        if (block) reason = block;
      }
      if (reason) {
        await db.query(`insert into campaign_recipients (organization_id, campaign_id, contact_id, status, skip_reason) values ($1,$2,$3,'skipped',$4)
                        on conflict (campaign_id, contact_id) where not is_test do nothing`, [c.organization_id, c.id, r.id, reason]);
        continue;
      }
      try {
        const messageId = await queueTemplateMessage(db, c.organization_id, r, tpl!, c.param_mapping,
          { idempotencyKey: `campaign:${c.id}:${r.id}`, runAt: new Date(Date.now() + sent * SPACING_MS) });
        await db.query(`insert into campaign_recipients (organization_id, campaign_id, contact_id, status, message_id) values ($1,$2,$3,'queued',$4)
                        on conflict (campaign_id, contact_id) where not is_test do nothing`, [c.organization_id, c.id, r.id, messageId]);
        sent++;
      } catch (e) {
        if (!(e instanceof TemplateSendError)) throw e;
        await db.query(`insert into campaign_recipients (organization_id, campaign_id, contact_id, status, skip_reason) values ($1,$2,$3,'skipped',$4)
                        on conflict (campaign_id, contact_id) where not is_test do nothing`, [c.organization_id, c.id, r.id, e.reason]);
      }
    }
    await db.query("update campaigns set status = 'done', finished_at = now() where id = $1", [c.id]);
    await audit(db, { orgId: c.organization_id, actorType: "system", action: "campaign.dispatched", targetType: "campaign", targetId: c.id, metadata: { sent, considered: rows.length } });
    total += sent;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------------------------
export async function campaignStats(db: Db, campaignId: string) {
  const r = await db.query<{ queued: string; skipped: string; canceled: string; sent: string; delivered: string; read: string; failed: string; pending: string; replied: string }>(
    `select
       count(*) filter (where cr.status = 'queued') queued,
       count(*) filter (where cr.status = 'skipped') skipped,
       count(*) filter (where cr.status = 'canceled') canceled,
       count(*) filter (where m.status in ('sent','delivered','read')) sent,
       count(*) filter (where m.status in ('delivered','read')) delivered,
       count(*) filter (where m.status = 'read') read,
       count(*) filter (where m.status = 'failed' and cr.status = 'queued') failed,
       count(*) filter (where m.status = 'pending') pending,
       count(*) filter (where exists (select 1 from messages i where i.conversation_id = m.conversation_id and i.direction = 'inbound'
                                       and i.sent_at > m.sent_at and i.sent_at < m.sent_at + interval '72 hours')) replied
     from campaign_recipients cr left join messages m on m.id = cr.message_id
     where cr.campaign_id = $1 and not cr.is_test`, [campaignId]);
  const reasons = await db.query<{ skip_reason: string; n: string }>(
    "select skip_reason, count(*) n from campaign_recipients where campaign_id = $1 and status = 'skipped' group by skip_reason order by n desc", [campaignId]);
  const x = r.rows[0];
  const num = (v: string) => Number(v);
  return {
    queued: num(x.queued), skipped: num(x.skipped), canceled: num(x.canceled), sent: num(x.sent), delivered: num(x.delivered), read: num(x.read),
    failed: num(x.failed), pending: num(x.pending), replied: num(x.replied),
    skipReasons: reasons.rows.map((y) => ({ reason: y.skip_reason, n: Number(y.n) })),
  };
}
