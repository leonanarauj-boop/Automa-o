import { ZodError } from "zod";
import { AuthError } from "@/modules/auth/service";
import { CrmError } from "@/modules/crm/service";
import { SendBlockedError } from "@/modules/inbox/outbound";
import { ChannelError } from "@/modules/whatsapp/channel";
import { CopilotError } from "@/modules/ai/copilot";
import { AILimitError } from "@/modules/ai/usage";
import { KnowledgeError } from "@/modules/ai/knowledge";
import { AgendaError } from "@/modules/agenda/service";
import { CampaignError } from "@/modules/campaigns/service";
import { AutomationError } from "@/modules/automations/service";
import { BillingError } from "@/modules/billing/service";
import { TeamError } from "@/modules/team/service";
import { MfaError } from "@/modules/mfa/service";
import { AdminError } from "@/modules/admin/service";
import type { ActionResult } from "@/components/action-form";

const KNOWN = [AuthError, CrmError, SendBlockedError, ChannelError, CopilotError, AILimitError, KnowledgeError, AgendaError, CampaignError, AutomationError, BillingError, TeamError, MfaError, AdminError];

/** Converte erros esperados em mensagens para o usuário; erros inesperados são logados e genéricos. */
export async function safeAction(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, message: message || undefined };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Dados inválidos." };
    if (KNOWN.some((K) => e instanceof K)) return { error: (e as Error).message };
    console.error(JSON.stringify({ level: "error", msg: "erro inesperado em ação", error: (e as Error).message, stack: (e as Error).stack }));
    return { error: "Algo deu errado. Tente novamente em instantes." };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
