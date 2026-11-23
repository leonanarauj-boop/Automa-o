"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { tenant } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { AutomationError, cancelRun, createAutomation, duplicateAutomation, reprocessRun, saveVersion, setAutomationStatus } from "@/modules/automations/service";
import { definitionSchema, RECIPES } from "@/modules/automations/definition";
import { simulate } from "@/modules/automations/engine";
import { getDefaultPipeline } from "@/modules/crm/service";
import type { SessionInfo } from "@/modules/auth/service";

const uuid = (v: string) => z.string().uuid("Identificador inválido").parse(v);
function requireManager(s: SessionInfo) {
  if (s.role === "agent") throw new AutomationError("Apenas gestores e o dono da conta podem alterar automações.");
}
const refresh = (id?: string) => { revalidatePath("/app/automations"); if (id) revalidatePath(`/app/automations/${id}`); };

export async function createFromRecipeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safeAction(async () => {
    const recipe = RECIPES.find((x) => x.key === str(fd, "recipe"));
    if (!recipe) throw new AutomationError("Modelo não encontrado.");
    id = await tenant(async (db, s) => {
      requireManager(s);
      const pipe = await getDefaultPipeline(db);
      const proposal = pipe.stages.find((st) => /or[çc]amento|proposta/i.test(st.name)) ?? pipe.stages.find((st) => st.kind === "open" && st.position > 0);
      const tag = (await db.query<{ id: string }>("select id from tags order by name limit 1")).rows[0];
      const def = recipe.build({ firstOpenStageId: pipe.stages[0]?.id, proposalStageId: proposal?.id, tagId: tag?.id });
      if (!def) throw new AutomationError("Este modelo precisa de uma etapa de proposta no funil.");
      return createAutomation(db, s.orgId, s.userId, recipe.name, def);
    });
  });
  if (r?.ok) redirect(`/app/automations/${id}`);
  return r;
}

export async function saveAutomationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    const def = JSON.parse(str(fd, "definition") || "{}");
    const v = await tenant(async (db, s) => { requireManager(s); return saveVersion(db, s.orgId, s.userId, id, str(fd, "name"), def); });
    refresh(id);
    return `Versão ${v} salva. Execuções em andamento continuam na versão em que começaram.`;
  });
}

export async function setStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    const status = z.enum(["active", "paused"]).parse(str(fd, "status"));
    await tenant(async (db, s) => { requireManager(s); await setAutomationStatus(db, s.orgId, s.userId, id, status); });
    refresh(id);
    return status === "active" ? "Automação ativada." : "Automação pausada. Execuções em espera foram canceladas.";
  });
}

export async function duplicateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safeAction(async () => {
    id = await tenant(async (db, s) => { requireManager(s); return duplicateAutomation(db, s.orgId, s.userId, uuid(str(fd, "id"))); });
  });
  if (r?.ok) redirect(`/app/automations/${id}`);
  return r;
}

export async function reprocessAction(fd: FormData) {
  const id = uuid(str(fd, "runId"));
  await tenant(async (db, s) => { requireManager(s); await reprocessRun(db, s.orgId, s.userId, id); });
  refresh(str(fd, "automationId"));
}

export async function cancelRunAction(fd: FormData) {
  await tenant(async (db, s) => { requireManager(s); await cancelRun(db, uuid(str(fd, "runId"))); });
  refresh(str(fd, "automationId"));
}

export async function simulateAction(definitionJson: string, contactId: string): Promise<{ result?: { step: number; label: string; result: string }[]; error?: string }> {
  try {
    const def = definitionSchema.parse(JSON.parse(definitionJson));
    return { result: await tenant((db) => simulate(db, def, uuid(contactId))) };
  } catch (e) {
    return { error: e instanceof z.ZodError ? `Definição incompleta: ${e.issues[0].message}` : "Não foi possível simular." };
  }
}
