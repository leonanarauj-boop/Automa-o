import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { analyzeAction, applyAnalysisAction } from "@/app/app/actions";
import type { AnalysisPayload } from "@/modules/ai/copilot";

const TEMP: Record<string, string> = { cold: "Frio", warm: "Morno", hot: "Quente" };
const OBJ: Record<string, string> = {
  preco: "Preço", confianca: "Confiança", concorrencia: "Concorrência", prazo: "Prazo", disponibilidade: "Disponibilidade",
  aprovacao_terceiros: "Precisa de aprovação", sem_resposta: "Sem resposta", outro: "Outra",
};

/** Análise da conversa pela IA: cada mudança no CRM só é aplicada se o humano marcar. */
export function AnalysisCard({ conversationId, suggestion, aiReady }: {
  conversationId: string | null; suggestion: { id: string; payload: AnalysisPayload } | null; aiReady: boolean;
}) {
  if (!aiReady) return <p className="text-xs text-muted">Análise por IA indisponível: configure o assistente em Assistente IA.</p>;
  if (!suggestion) {
    if (!conversationId) return <p className="text-xs text-muted">Sem conversa para analisar.</p>;
    return (
      <ActionForm action={analyzeAction}>
        <input type="hidden" name="conversationId" value={conversationId} />
        <SubmitButton size="sm" variant="secondary" pendingText="Analisando…">Analisar conversa com IA</SubmitButton>
        <p className="mt-1 text-xs text-muted">Sugere memória do cliente, temperatura, etapa e próxima ação. Você decide o que aplicar.</p>
      </ActionForm>
    );
  }
  const p = suggestion.payload;
  return (
    <div className="space-y-2">
    <ActionForm action={applyAnalysisAction} className="space-y-3 text-sm">
      <input type="hidden" name="suggestionId" value={suggestion.id} />
      <p className="text-xs font-medium text-muted">Sugestões da IA · revise antes de aplicar</p>
      <label className="flex items-start gap-2"><input type="checkbox" name="field" value="summary" defaultChecked className="mt-1 shrink-0 accent-[var(--primary)]" />
        <span><span className="font-medium">Memória comercial:</span> {p.summary}</span></label>
      <label className="flex items-start gap-2"><input type="checkbox" name="field" value="temperature" defaultChecked className="mt-1 shrink-0 accent-[var(--primary)]" />
        <span><span className="font-medium">Temperatura:</span> {TEMP[p.temperature]} <span className="text-muted">· intenção: {p.intent} · urgência: {p.urgency}</span></span></label>
      {p.suggested_stage && p.deal_id && p.suggested_stage !== p.current_stage && (
        <label className="flex items-start gap-2"><input type="checkbox" name="field" value="stage" className="mt-1 shrink-0 accent-[var(--primary)]" />
          <span><span className="font-medium">Mover negócio:</span> {p.current_stage} → {p.suggested_stage}{p.stage_evidence && <span className="block text-xs text-muted">“{p.stage_evidence}”</span>}</span></label>
      )}
      <label className="flex items-start gap-2"><input type="checkbox" name="field" value="task" className="mt-1 shrink-0 accent-[var(--primary)]" />
        <span><span className="font-medium">Criar tarefa:</span> {p.next_action}</span></label>
      {(p.interests.length > 0 || p.budget_mentioned) && (
        <p className="text-xs text-muted">{p.interests.length > 0 && <>Interesses: {p.interests.join(", ")}. </>}{p.budget_mentioned && <>Orçamento citado: {p.budget_mentioned}.</>}</p>
      )}
      {p.objections.length > 0 && (
        <div className="space-y-1">{p.objections.map((o, i) => <p key={i} className="text-xs"><Badge tone="money">{OBJ[o.type]}</Badge> <span className="text-muted">“{o.evidence}”</span></p>)}</div>
      )}
      <SubmitButton size="sm" pendingText="Aplicando…">Aplicar selecionados</SubmitButton>
    </ActionForm>
    <ActionForm action={applyAnalysisAction}>
      <input type="hidden" name="suggestionId" value={suggestion.id} />
      <SubmitButton size="sm" variant="ghost" pendingText="Descartando…">Descartar sugestões</SubmitButton>
    </ActionForm>
    </div>
  );
}
