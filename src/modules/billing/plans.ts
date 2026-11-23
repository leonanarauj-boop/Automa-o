/**
 * Planos e limites. Preços são HIPÓTESES iniciais do planejamento (validar com clientes);
 * alterar aqui não muda assinaturas existentes, que guardam o preço contratado.
 */
export type PlanKey = "trial" | "starter" | "professional" | "business";

export interface Plan {
  key: PlanKey;
  name: string;
  priceCents: number; // mensal
  description: string;
  limits: { users: number; contacts: number; aiCredits: number; activeAutomations: number };
  features: { ai: boolean; campaigns: boolean; automations: boolean; agenda: boolean };
  highlights: string[];
}

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

export const PLANS: Record<PlanKey, Plan> = {
  trial: {
    key: "trial", name: "Teste grátis", priceCents: 0, description: `${TRIAL_DAYS} dias com os recursos do Profissional.`,
    limits: { users: 3, contacts: 1000, aiCredits: 300, activeAutomations: 10 },
    features: { ai: true, campaigns: true, automations: true, agenda: true }, highlights: [],
  },
  starter: {
    key: "starter", name: "Essencial", priceCents: 14900, description: "Para organizar o atendimento e não perder clientes.",
    limits: { users: 2, contacts: 2000, aiCredits: 0, activeAutomations: 3 },
    features: { ai: false, campaigns: false, automations: true, agenda: true },
    highlights: ["Conversas, CRM e funil", "Radar de oportunidades", "Agenda com lembretes", "3 automações ativas", "2 usuários"],
  },
  professional: {
    key: "professional", name: "Profissional", priceCents: 34900, description: "IA, campanhas e automações para vender mais.",
    limits: { users: 5, contacts: 10000, aiCredits: 1500, activeAutomations: 20 },
    features: { ai: true, campaigns: true, automations: true, agenda: true },
    highlights: ["Tudo do Essencial", "Copiloto de IA (1.500 usos/mês)", "Campanhas com consentimento", "20 automações ativas", "5 usuários"],
  },
  business: {
    key: "business", name: "Empresa", priceCents: 79900, description: "Para equipes maiores e alto volume.",
    limits: { users: 12, contacts: 50000, aiCredits: 5000, activeAutomations: 100 },
    features: { ai: true, campaigns: true, automations: true, agenda: true },
    highlights: ["Tudo do Profissional", "Copiloto de IA (5.000 usos/mês)", "100 automações ativas", "12 usuários"],
  },
};

export const PAID_PLANS = [PLANS.starter, PLANS.professional, PLANS.business];
export const PLAN_ORDER: PlanKey[] = ["trial", "starter", "professional", "business"];

export function getPlan(key: string): Plan {
  return PLANS[key as PlanKey] ?? PLANS.trial;
}

export function applyCoupon(priceCents: number, percentOff: number | null | undefined) {
  if (!percentOff) return priceCents;
  return Math.round(priceCents * (100 - percentOff) / 100);
}
