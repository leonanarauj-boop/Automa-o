/**
 * Regras do Radar de Oportunidades (funções puras, testáveis).
 * Princípio: valor POTENCIAL é sempre estimativa; valor RECUPERADO só existe quando um negócio
 * ligado ao sinal é marcado como ganho.
 */
export type RuleKind = "awaiting_reply" | "lead_silent" | "deal_stale";

export const RULE_LABELS: Record<RuleKind, string> = {
  awaiting_reply: "Cliente aguardando resposta",
  lead_silent: "Cliente parou de responder",
  deal_stale: "Negócio parado",
};

/** Prioridade quando o mesmo contato dispara mais de uma regra (menor = mais urgente). */
const PRIORITY: Record<RuleKind, number> = { awaiting_reply: 0, lead_silent: 1, deal_stale: 2 };

export interface RadarRow {
  contactId: string;
  contactName: string;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  windowExpiresAt: Date | null;
  dealId: string | null;
  dealValueCents: number | null;
  dealStageName: string | null;
  dealLastActivityAt: Date | null;
}

export interface Candidate {
  ruleKind: RuleKind;
  contactId: string;
  dealId: string | null;
  potentialValueCents: number | null;
  valueBasis: "deal_value" | "avg_ticket" | "unknown";
  reason: string;
  recommendedAction: string;
}

const HOUR = 3600 * 1000;

export function formatElapsed(ms: number): string {
  const h = Math.floor(ms / HOUR);
  if (h < 1) return "menos de 1 hora";
  if (h < 48) return `${h} hora${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} dias`;
}

export function evaluateRadar(
  rows: RadarRow[],
  thresholds: Partial<Record<RuleKind, number>>, // horas; regra ausente = desativada
  avgTicketCents: number | null,
  now = new Date(),
): Candidate[] {
  const best = new Map<string, Candidate>();
  const value = (r: RadarRow): Pick<Candidate, "potentialValueCents" | "valueBasis"> =>
    r.dealValueCents && r.dealValueCents > 0
      ? { potentialValueCents: r.dealValueCents, valueBasis: "deal_value" }
      : avgTicketCents && avgTicketCents > 0
        ? { potentialValueCents: avgTicketCents, valueBasis: "avg_ticket" }
        : { potentialValueCents: null, valueBasis: "unknown" };
  const windowClosed = (r: RadarRow) => !r.windowExpiresAt || r.windowExpiresAt.getTime() <= now.getTime();

  const push = (c: Candidate) => {
    const cur = best.get(c.contactId);
    if (!cur || PRIORITY[c.ruleKind] < PRIORITY[cur.ruleKind]) best.set(c.contactId, c);
  };

  for (const r of rows) {
    const t = thresholds;
    const inb = r.lastInboundAt?.getTime() ?? null;
    const out = r.lastOutboundAt?.getTime() ?? null;

    if (t.awaiting_reply && inb !== null && (out === null || out < inb) && now.getTime() - inb >= t.awaiting_reply * HOUR) {
      push({
        ruleKind: "awaiting_reply", contactId: r.contactId, dealId: r.dealId, ...value(r),
        reason: `${r.contactName} enviou mensagem há ${formatElapsed(now.getTime() - inb)} e ainda não recebeu resposta.`,
        recommendedAction: windowClosed(r)
          ? "Responder com um template aprovado (a janela de 24h já fechou) e pedir desculpas pela demora."
          : "Responder agora — a janela de 24h ainda está aberta para mensagem livre.",
      });
    }
    if (t.lead_silent && r.dealId && out !== null && (inb === null || inb < out) && now.getTime() - out >= t.lead_silent * HOUR) {
      push({
        ruleKind: "lead_silent", contactId: r.contactId, dealId: r.dealId, ...value(r),
        reason: `Sua equipe falou com ${r.contactName} há ${formatElapsed(now.getTime() - out)} e o cliente não retornou${r.dealStageName ? ` (etapa: ${r.dealStageName})` : ""}.`,
        recommendedAction: windowClosed(r)
          ? "Retomar o contato com um template de follow-up, citando o interesse demonstrado."
          : "Enviar uma mensagem curta de retomada, com uma pergunta objetiva.",
      });
    }
    const act = r.dealLastActivityAt?.getTime() ?? null;
    if (t.deal_stale && r.dealId && act !== null && now.getTime() - act >= t.deal_stale * HOUR) {
      push({
        ruleKind: "deal_stale", contactId: r.contactId, dealId: r.dealId, ...value(r),
        reason: `Negócio sem nenhuma interação há ${formatElapsed(now.getTime() - act)}${r.dealStageName ? ` na etapa "${r.dealStageName}"` : ""}.`,
        recommendedAction: "Revisar o negócio: atualizar a etapa, marcar como perdido ou retomar o contato.",
      });
    }
  }
  return [...best.values()];
}
