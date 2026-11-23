export const CAMPAIGN_STATUS: Record<string, { label: string; tone: "neutral" | "primary" | "money" | "success" | "danger" }> = {
  draft: { label: "Rascunho", tone: "neutral" }, pending_approval: { label: "Aguardando aprovação", tone: "money" }, scheduled: { label: "Agendada", tone: "primary" },
  sending: { label: "Enviando", tone: "primary" }, done: { label: "Enviada", tone: "success" }, canceled: { label: "Cancelada", tone: "danger" },
};
