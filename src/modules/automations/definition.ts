import { z } from "zod";
import { paramSourceSchema } from "@/modules/messaging/template-send";

/** Definição de uma automação: um gatilho e uma sequência de passos (condições, esperas e ações). */
const uuid = z.string().uuid();

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contact.created") }),
  z.object({ type: z.literal("message.received") }),
  z.object({ type: z.literal("deal.stage_changed"), stageId: uuid.nullable().default(null) }),
  z.object({ type: z.literal("appointment.status_changed"), status: z.enum(["confirmed", "done", "no_show", "canceled"]).nullable().default(null) }),
  z.object({ type: z.literal("conversation.no_reply"), hours: z.number().int().min(1).max(720) }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("has_tag"), tagId: uuid }),
  z.object({ kind: z.literal("temperature_is"), value: z.enum(["cold", "warm", "hot"]) }),
  z.object({ kind: z.literal("deal_in_stage"), stageId: uuid }),
  z.object({ kind: z.literal("has_open_deal") }),
  z.object({ kind: z.literal("replied_since_start") }),
  z.object({ kind: z.literal("marketing_consent") }),
]);

export const stepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wait"), minutes: z.number().int().min(1).max(60 * 24 * 60) }),
  z.object({ type: z.literal("condition"), check: conditionSchema, negate: z.boolean().default(false) }),
  z.object({ type: z.literal("add_tag"), tagId: uuid }),
  z.object({ type: z.literal("remove_tag"), tagId: uuid }),
  z.object({ type: z.literal("set_temperature"), value: z.enum(["cold", "warm", "hot"]) }),
  z.object({ type: z.literal("assign_owner"), mode: z.enum(["round_robin", "user"]), userId: uuid.nullable().default(null) }),
  z.object({ type: z.literal("create_task"), title: z.string().trim().min(1).max(200), dueHours: z.number().int().min(0).max(24 * 60).default(24) }),
  z.object({ type: z.literal("move_deal"), stageId: uuid }),
  z.object({ type: z.literal("send_template"), templateId: uuid, params: z.array(paramSourceSchema).max(20) }),
  z.object({ type: z.literal("send_text"), text: z.string().trim().min(1).max(1000) }),
  z.object({ type: z.literal("webhook"), url: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Use uma URL https://") }),
]);
export type Step = z.infer<typeof stepSchema>;

export const MAX_STEPS = 20;
export const definitionSchema = z.object({
  trigger: triggerSchema,
  steps: z.array(stepSchema).min(1, "Adicione pelo menos um passo").max(MAX_STEPS, `Máximo de ${MAX_STEPS} passos`),
});
export type Definition = z.infer<typeof definitionSchema>;

export const TRIGGER_LABEL: Record<Trigger["type"], string> = {
  "contact.created": "Novo contato",
  "message.received": "Mensagem recebida",
  "deal.stage_changed": "Negócio mudou de etapa",
  "appointment.status_changed": "Agendamento mudou de status",
  "conversation.no_reply": "Cliente não respondeu",
};

export const STEP_LABEL: Record<Step["type"], string> = {
  wait: "Esperar", condition: "Condição (continua só se…)", add_tag: "Adicionar etiqueta", remove_tag: "Remover etiqueta",
  set_temperature: "Definir temperatura", assign_owner: "Atribuir responsável", create_task: "Criar tarefa", move_deal: "Mover negócio",
  send_template: "Enviar template do WhatsApp", send_text: "Enviar texto (só com janela de 24h aberta)", webhook: "Chamar webhook",
};

// ---------------------------------------------------------------------------------------------
// Modelos prontos (receitas) — o usuário completa os campos marcados (etapas, templates)
// ---------------------------------------------------------------------------------------------
export interface Recipe { key: string; name: string; description: string; build: (o: { firstOpenStageId?: string; proposalStageId?: string; tagId?: string }) => Definition | null }

export const RECIPES: Recipe[] = [
  {
    key: "novo-lead", name: "Novo lead", description: "Distribui o contato para a equipe e cria a tarefa de primeiro atendimento.",
    build: () => ({ trigger: { type: "contact.created" }, steps: [
      { type: "assign_owner", mode: "round_robin", userId: null },
      { type: "create_task", title: "Fazer o primeiro atendimento", dueHours: 1 },
    ] }),
  },
  {
    key: "sem-resposta", name: "Cliente não respondeu", description: "Após 48h sem retorno, cria tarefa de retomada para quem tem negócio aberto.",
    build: () => ({ trigger: { type: "conversation.no_reply", hours: 48 }, steps: [
      { type: "condition", check: { kind: "has_open_deal" }, negate: false },
      { type: "create_task", title: "Retomar contato: cliente sem resposta há 48h", dueHours: 4 },
    ] }),
  },
  {
    key: "proposta", name: "Proposta não fechada", description: "Quando o negócio entra na etapa de proposta, espera 3 dias e cria tarefa se continuar parado.",
    build: (o) => o.proposalStageId ? ({ trigger: { type: "deal.stage_changed", stageId: o.proposalStageId }, steps: [
      { type: "wait", minutes: 3 * 24 * 60 },
      { type: "condition", check: { kind: "deal_in_stage", stageId: o.proposalStageId }, negate: false },
      { type: "condition", check: { kind: "replied_since_start" }, negate: true },
      { type: "create_task", title: "Retomar proposta sem retorno", dueHours: 4 },
    ] }) : null,
  },
  {
    key: "pos-atendimento", name: "Pós-atendimento", description: "Um dia depois do atendimento concluído, marca o cliente e cria tarefa de pós-venda (adicione um template de avaliação se quiser).",
    build: (o) => ({ trigger: { type: "appointment.status_changed", status: "done" }, steps: [
      { type: "wait", minutes: 24 * 60 },
      ...(o.tagId ? [{ type: "add_tag" as const, tagId: o.tagId }] : []),
      { type: "create_task", title: "Pós-atendimento: perguntar como foi a experiência", dueHours: 24 },
    ] }),
  },
  {
    key: "falta", name: "Cliente faltou", description: "Quando o cliente falta, cria tarefa para oferecer novo horário.",
    build: () => ({ trigger: { type: "appointment.status_changed", status: "no_show" }, steps: [
      { type: "create_task", title: "Cliente faltou: oferecer novo horário", dueHours: 2 },
    ] }),
  },
];
