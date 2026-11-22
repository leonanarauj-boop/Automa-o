/**
 * Configurações iniciais por segmento (onboarding inteligente).
 * Cada segmento define funil, etiquetas e limites do Radar. São pontos de partida editáveis.
 */
export type StageKind = "open" | "won" | "lost";

export interface SegmentPreset {
  key: string;
  label: string;
  dealLabel: string;
  stages: { name: string; kind: StageKind }[];
  tags: string[];
  radar: { awaiting_reply: number; lead_silent: number; deal_stale: number }; // horas
}

const lostWon = (won: string): { name: string; kind: StageKind }[] => [
  { name: won, kind: "won" },
  { name: "Perdido", kind: "lost" },
];

export const SEGMENTS: SegmentPreset[] = [
  {
    key: "clinica",
    label: "Clínica odontológica ou de estética",
    dealLabel: "Tratamento",
    stages: [
      { name: "Novo contato", kind: "open" },
      { name: "Avaliação agendada", kind: "open" },
      { name: "Orçamento enviado", kind: "open" },
      { name: "Negociação", kind: "open" },
      ...lostWon("Tratamento fechado"),
    ],
    tags: ["Avaliação", "Implante", "Ortodontia", "Clareamento", "Harmonização", "Retorno"],
    radar: { awaiting_reply: 2, lead_silent: 72, deal_stale: 120 },
  },
  {
    key: "servicos",
    label: "Prestador de serviços",
    dealLabel: "Serviço",
    stages: [
      { name: "Novo lead", kind: "open" },
      { name: "Em atendimento", kind: "open" },
      { name: "Orçamento enviado", kind: "open" },
      { name: "Negociação", kind: "open" },
      ...lostWon("Venda concluída"),
    ],
    tags: ["Orçamento", "Urgente", "Recorrente", "Indicação"],
    radar: { awaiting_reply: 2, lead_silent: 72, deal_stale: 168 },
  },
  {
    key: "imobiliaria",
    label: "Imobiliária ou corretor",
    dealLabel: "Negócio imobiliário",
    stages: [
      { name: "Novo lead", kind: "open" },
      { name: "Qualificado", kind: "open" },
      { name: "Visita agendada", kind: "open" },
      { name: "Proposta", kind: "open" },
      { name: "Documentação", kind: "open" },
      ...lostWon("Negócio fechado"),
    ],
    tags: ["Compra", "Locação", "Financiamento", "Investidor"],
    radar: { awaiting_reply: 1, lead_silent: 96, deal_stale: 240 },
  },
  {
    key: "educacao",
    label: "Escola ou curso",
    dealLabel: "Matrícula",
    stages: [
      { name: "Interessado", kind: "open" },
      { name: "Aula experimental", kind: "open" },
      { name: "Proposta enviada", kind: "open" },
      ...lostWon("Matriculado"),
    ],
    tags: ["Presencial", "Online", "Bolsa", "Rematrícula"],
    radar: { awaiting_reply: 2, lead_silent: 72, deal_stale: 168 },
  },
  {
    key: "varejo",
    label: "Loja ou e-commerce",
    dealLabel: "Pedido",
    stages: [
      { name: "Novo contato", kind: "open" },
      { name: "Em atendimento", kind: "open" },
      { name: "Aguardando pagamento", kind: "open" },
      ...lostWon("Pedido pago"),
    ],
    tags: ["Atacado", "Varejo", "Troca", "Recompra"],
    radar: { awaiting_reply: 1, lead_silent: 48, deal_stale: 72 },
  },
  {
    key: "outro",
    label: "Outro segmento",
    dealLabel: "Oportunidade",
    stages: [
      { name: "Novo lead", kind: "open" },
      { name: "Primeiro contato", kind: "open" },
      { name: "Qualificado", kind: "open" },
      { name: "Proposta enviada", kind: "open" },
      { name: "Negociação", kind: "open" },
      ...lostWon("Venda concluída"),
    ],
    tags: ["Quente", "Orçamento", "Indicação"],
    radar: { awaiting_reply: 2, lead_silent: 72, deal_stale: 168 },
  },
];

export function getSegment(key: string): SegmentPreset {
  return SEGMENTS.find((s) => s.key === key) ?? SEGMENTS[SEGMENTS.length - 1];
}
