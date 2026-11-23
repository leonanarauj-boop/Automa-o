"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { tenant } from "@/lib/session";
import { safeAction, str } from "@/lib/action";
import type { ActionResult } from "@/components/action-form";
import { approve, cancel, CampaignError, requestApproval, saveCampaign, sendTest } from "@/modules/campaigns/service";
import type { SessionInfo } from "@/modules/auth/service";

const uuid = (v: string) => z.string().uuid("Identificador inválido").parse(v);
function requireManager(s: SessionInfo) {
  if (s.role === "agent") throw new CampaignError("Apenas gestores e o dono da conta podem aprovar ou cancelar campanhas.");
}
const refresh = (id?: string) => { revalidatePath("/app/campaigns"); if (id) revalidatePath(`/app/campaigns/${id}`); };

export async function createCampaignAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safeAction(async () => {
    id = await tenant((db, s) => saveCampaign(db, s.orgId, s.userId, { name: str(fd, "name"), templateId: null, paramMapping: [], segment: {} as never }));
  });
  if (r?.ok) redirect(`/app/campaigns/${id}`);
  return r;
}

export async function saveCampaignAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    const data = JSON.parse(str(fd, "payload") || "{}");
    await tenant((db, s) => saveCampaign(db, s.orgId, s.userId, data, id));
    refresh(id);
    return "Campanha salva. Confira a pré-visualização.";
  });
}

export async function requestApprovalAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    await tenant((db, s) => requestApproval(db, s.orgId, s.userId, id));
    refresh(id);
    return "Enviada para aprovação de um gestor.";
  });
}

export async function approveAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    const when = str(fd, "when");
    const date = when ? new Date(`${when}:00-03:00`) : new Date();
    if (Number.isNaN(date.getTime())) throw new CampaignError("Data de envio inválida.");
    await tenant(async (db, s) => { requireManager(s); await approve(db, s.orgId, s.userId, id, date); });
    refresh(id);
    return when ? "Campanha aprovada e agendada." : "Campanha aprovada. O envio começa em até 1 minuto.";
  });
}

export async function cancelCampaignAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    await tenant(async (db, s) => { requireManager(s); await cancel(db, s.orgId, s.userId, id); });
    refresh(id);
    return "Campanha cancelada.";
  });
}

export async function testSendAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const id = uuid(str(fd, "id"));
    await tenant((db, s) => sendTest(db, s.orgId, s.userId, id, uuid(str(fd, "contactId"))));
    refresh(id);
    return "Mensagem de teste enfileirada.";
  });
}

export async function saveLimitsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safeAction(async () => {
    const daily = z.coerce.number().int().min(0).max(100000).parse(str(fd, "daily"));
    const freq = z.coerce.number().int().min(0).max(90).parse(str(fd, "frequency"));
    await tenant(async (db, s) => {
      requireManager(s);
      await db.query("update organizations set daily_template_limit = $1, campaign_frequency_days = $2, updated_at = now() where id = $3", [daily, freq, s.orgId]);
    });
    refresh();
    return "Limites salvos.";
  });
}
