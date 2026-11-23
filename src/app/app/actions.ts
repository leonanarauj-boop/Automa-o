"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession, tenant } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { CrmError, addNote, createContact, createDeal, createTask, moveDeal, recordConsent, setContactTags, setTaskDone, updateContact, updateDealValue } from "@/modules/crm/service";
import { queueTemplate, queueText } from "@/modules/inbox/outbound";
import { refreshRadar } from "@/modules/radar/service";
import { removeDemo, seedDemo } from "@/modules/demo/seed";
import { connectChannel, disconnectChannel, syncTemplates } from "@/modules/whatsapp/channel";
import { audit } from "@/modules/audit/audit";
import type { SessionInfo } from "@/modules/auth/service";
import { ANALYSIS_FIELDS, analyzeConversation, applyAnalysis, recordReplyOutcome, suggestReply, type AnalysisField } from "@/modules/ai/copilot";
import { saveAgent, saveDocument, saveProduct } from "@/modules/ai/knowledge";

function requireManager(s: SessionInfo) {
  if (s.role === "agent") throw new CrmError("Apenas gestores e o dono da conta podem fazer esta alteração.");
}
const uuid = (v: string) => z.string().uuid("Identificador inválido").parse(v);

// ---------- Contatos ----------
export async function createContactAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safeAction(async () => {
    id = await tenant((db, s) => createContact(db, s.orgId, s.userId, {
      displayName: str(fd, "displayName"), phone: str(fd, "phone"), email: str(fd, "email"), company: str(fd, "company"), temperature: str(fd, "temperature") as never,
    }));
  });
  if (r?.ok) redirect(`/app/contacts/${id}`);
  return r;
}

export async function updateContactAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    await tenant((db, s) => updateContact(db, s.orgId, s.userId, id, {
      displayName: str(fd, "displayName"), phone: str(fd, "phone"), email: str(fd, "email"), company: str(fd, "company"),
      notes: str(fd, "notes"), temperature: str(fd, "temperature") as never,
    }));
    revalidatePath(`/app/contacts/${id}`);
    return "Contato atualizado.";
  });
}

export async function setTagsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    const tags = fd.getAll("tag").map((t) => uuid(String(t)));
    await tenant((db, s) => setContactTags(db, s.orgId, id, tags));
    revalidatePath(`/app/contacts/${id}`);
    return "Etiquetas salvas.";
  });
}

export async function addNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "contactId"));
    await tenant((db, s) => addNote(db, s.orgId, s.userId, id, str(fd, "body")));
    revalidatePath(`/app/contacts/${id}`);
  });
}

export async function consentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "contactId"));
    const status = z.enum(["granted", "revoked"]).parse(str(fd, "status"));
    await tenant((db, s) => recordConsent(db, s.orgId, s.userId, id, "marketing", status, str(fd, "evidence")));
    revalidatePath(`/app/contacts/${id}`);
    return "Consentimento registrado.";
  });
}

// ---------- Negócios ----------
export async function createDealAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant((db, s) => createDeal(db, s.orgId, s.userId, {
      contactId: str(fd, "contactId"), title: str(fd, "title"), value: str(fd, "value"), stageId: str(fd, "stageId") || undefined,
    }));
    revalidatePath("/app/pipeline");
    revalidatePath("/app/contacts", "layout");
    return "Negócio criado.";
  });
}

export async function moveDealAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant((db, s) => moveDeal(db, s.orgId, s.userId, uuid(str(fd, "dealId")), uuid(str(fd, "stageId")), str(fd, "lostReason")));
    revalidatePath("/app/pipeline");
    revalidatePath("/app/radar");
  });
}

export async function updateDealValueAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant((db) => updateDealValue(db, uuid(str(fd, "dealId")), str(fd, "value")));
    revalidatePath("/app/pipeline");
    revalidatePath("/app/contacts", "layout");
    return "Valor atualizado.";
  });
}

// ---------- Tarefas ----------
export async function createTaskAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant((db, s) => createTask(db, s.orgId, s.userId, { title: str(fd, "title"), dueAt: str(fd, "dueAt"), contactId: str(fd, "contactId") }));
    revalidatePath("/app/tasks");
    revalidatePath("/app/contacts", "layout");
  });
}

export async function toggleTaskAction(fd: FormData) {
  await tenant((db) => setTaskDone(db, uuid(str(fd, "taskId")), str(fd, "done") === "1"));
  revalidatePath("/app/tasks");
  revalidatePath("/app/contacts", "layout");
}

// ---------- Conversas ----------
export async function sendTextAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => {
      await queueText(db, s.userId, { conversationId: str(fd, "conversationId"), body: str(fd, "body") });
      const sid = str(fd, "suggestionId");
      if (sid) await recordReplyOutcome(db, s.userId, uuid(sid), str(fd, "body"));
    });
    revalidatePath("/app/inbox");
  });
}

export async function sendTemplateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const params = fd.getAll("param").map(String);
    await tenant((db, s) => queueTemplate(db, s.userId, { conversationId: str(fd, "conversationId"), templateId: str(fd, "templateId"), params }));
    revalidatePath("/app/inbox");
    return "Template enviado para a fila.";
  });
}

export async function markReadAction(fd: FormData) {
  await tenant((db) => db.query("update conversations set unread_count = 0 where id = $1", [uuid(str(fd, "conversationId"))]));
  revalidatePath("/app/inbox");
}

// ---------- Radar ----------
export async function refreshRadarAction(): Promise<void> {
  await tenant((db, s) => refreshRadar(db, s.orgId));
  revalidatePath("/app/radar");
  revalidatePath("/app");
}

export async function dismissSignalAction(fd: FormData) {
  await tenant(async (db, s) => {
    const id = uuid(str(fd, "signalId"));
    await db.query("update opportunity_signals set status = 'dismissed', resolved_at = now() where id = $1 and status = 'open'", [id]);
    await audit(db, { orgId: s.orgId, actorType: "user", actorId: s.userId, action: "signal.dismissed", targetType: "signal", targetId: id });
  });
  revalidatePath("/app/radar");
}

export async function updateRulesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => {
      requireManager(s);
      for (const kind of ["awaiting_reply", "lead_silent", "deal_stale", "appointment_unconfirmed", "no_show"] as const) {
        const hours = z.coerce.number().int("Use horas inteiras").min(1, "Mínimo de 1 hora").max(24 * 90, "Máximo de 90 dias").parse(str(fd, kind));
        await db.query("update opportunity_rules set threshold_hours = $2, active = $3 where kind = $1", [kind, hours, fd.get(`${kind}_active`) === "on"]);
      }
      await refreshRadar(db, s.orgId);
    });
    revalidatePath("/app/radar");
    revalidatePath("/app/settings");
    return "Regras atualizadas e Radar recalculado.";
  });
}

// ---------- Demonstração ----------
export async function seedDemoAction() {
  await tenant(async (db, s) => { requireManager(s); await seedDemo(db, s.orgId, s.userId); await refreshRadar(db, s.orgId); });
  revalidatePath("/app", "layout");
}

export async function removeDemoAction() {
  await tenant(async (db, s) => { requireManager(s); await removeDemo(db); await refreshRadar(db, s.orgId); });
  revalidatePath("/app", "layout");
}

// ---------- WhatsApp ----------
export async function connectChannelAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    requireManager(s);
    const phone = await connectChannel(s.orgId, s.userId, { wabaId: str(fd, "wabaId"), phoneNumberId: str(fd, "phoneNumberId"), accessToken: str(fd, "accessToken") });
    revalidatePath("/app/settings");
    return `Número ${phone} conectado.`;
  });
}

export async function disconnectChannelAction(fd: FormData) {
  const s = await requireSession();
  requireManager(s);
  await disconnectChannel(s.orgId, s.userId, uuid(str(fd, "channelId")));
  revalidatePath("/app/settings");
}

export async function syncTemplatesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    const n = await syncTemplates(s.orgId, uuid(str(fd, "channelId")));
    revalidatePath("/app/settings");
    return `${n} template(s) sincronizado(s).`;
  });
}

// ---------- IA: copiloto ----------
export async function suggestReplyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    await suggestReply({ userId: s.userId, orgId: s.orgId }, uuid(str(fd, "conversationId")));
    revalidatePath("/app/inbox");
  });
}

export async function discardReplyAction(fd: FormData) {
  await tenant((db, s) => recordReplyOutcome(db, s.userId, uuid(str(fd, "suggestionId")), null));
  revalidatePath("/app/inbox");
}

export async function analyzeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const s = await requireSession();
    await analyzeConversation({ userId: s.userId, orgId: s.orgId }, uuid(str(fd, "conversationId")));
    revalidatePath("/app/inbox");
    revalidatePath("/app/contacts", "layout");
  });
}

export async function applyAnalysisAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const fields = fd.getAll("field").map(String).filter((f): f is AnalysisField => (ANALYSIS_FIELDS as readonly string[]).includes(f));
    await tenant((db, s) => applyAnalysis(db, s.orgId, s.userId, uuid(str(fd, "suggestionId")), fields));
    revalidatePath("/app", "layout");
    return fields.length ? "Alterações aplicadas." : "Sugestão descartada.";
  });
}

// ---------- IA: base de conhecimento e configuração ----------
export async function saveAgentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => {
      requireManager(s);
      await saveAgent(db, s.orgId, s.userId, {
        name: str(fd, "name"), tone: str(fd, "tone"), formality: str(fd, "formality") as never, businessDescription: str(fd, "businessDescription"),
        businessHours: str(fd, "businessHours"), policies: str(fd, "policies"), handoffRules: str(fd, "handoffRules"), forbiddenTopics: str(fd, "forbiddenTopics"),
      });
      await audit(db, { orgId: s.orgId, actorType: "user", actorId: s.userId, action: "ai.agent.updated" });
    });
    revalidatePath("/app/knowledge");
    return "Configuração salva.";
  });
}

export async function saveProductAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => {
      requireManager(s);
      const id = str(fd, "id");
      await saveProduct(db, s.orgId, { name: str(fd, "name"), description: str(fd, "description"), price: str(fd, "price"), priceType: str(fd, "priceType") as never, durationMin: str(fd, "durationMin") }, id ? uuid(id) : undefined);
    });
    revalidatePath("/app/knowledge");
    return "Item salvo.";
  });
}

export async function toggleProductAction(fd: FormData) {
  await tenant(async (db, s) => { requireManager(s); await db.query("update products_services set active = not active, updated_at = now() where id = $1", [uuid(str(fd, "id"))]); });
  revalidatePath("/app/knowledge");
}

export async function addDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    await tenant(async (db, s) => { requireManager(s); await saveDocument(db, s.orgId, s.userId, { title: str(fd, "title"), kind: str(fd, "kind") as never, content: str(fd, "content") }); });
    revalidatePath("/app/knowledge");
    return "Documento adicionado à base.";
  });
}

export async function deleteDocumentAction(fd: FormData) {
  await tenant(async (db, s) => {
    requireManager(s);
    const id = uuid(str(fd, "id"));
    await db.query("delete from knowledge_documents where id = $1", [id]);
    await audit(db, { orgId: s.orgId, actorType: "user", actorId: s.userId, action: "ai.document.deleted", targetType: "document", targetId: id });
  });
  revalidatePath("/app/knowledge");
}

export async function toggleAiAction(fd: FormData) {
  await tenant(async (db, s) => {
    requireManager(s);
    const on = str(fd, "enabled") === "1";
    await db.query("update organizations set ai_enabled = $1, updated_at = now() where id = $2", [on, s.orgId]);
    await audit(db, { orgId: s.orgId, actorType: "user", actorId: s.userId, action: on ? "ai.enabled" : "ai.disabled" });
  });
  revalidatePath("/app/knowledge");
}
