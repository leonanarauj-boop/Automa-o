import { tenant } from "@/lib/session";
import { aiProvider } from "@/modules/ai/anthropic";
import { getAgent, listCatalog } from "@/modules/ai/knowledge";
import { usageThisMonth } from "@/modules/ai/usage";
import { dateTime, money } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Select, Textarea, buttonClass } from "@/components/ui";
import { addDocumentAction, deleteDocumentAction, saveAgentAction, saveProductAction, toggleAiAction, toggleProductAction } from "../actions";

export const metadata = { title: "Assistente IA" };

export default async function Knowledge() {
  const d = await tenant(async (db, s) => ({
    s,
    agent: await getAgent(db),
    catalog: await listCatalog(db, false),
    docs: (await db.query<{ id: string; title: string; kind: string; chars: number; created_at: Date }>(
      "select id, title, kind, length(content) as chars, created_at from knowledge_documents order by created_at desc")).rows,
    org: (await db.query<{ ai_enabled: boolean; ai_monthly_credits: number }>("select ai_enabled, ai_monthly_credits from organizations limit 1")).rows[0],
    usage: await usageThisMonth(db),
  }));
  const manager = d.s.role !== "agent";
  const configured = aiProvider().available();
  const acceptRate = d.usage.repliesDecided ? Math.round(((d.usage.repliesAccepted + d.usage.repliesEdited) / d.usage.repliesDecided) * 100) : null;

  return (
    <>
      <PageHeader title="Assistente IA" description="O copiloto sugere respostas e atualizações do CRM usando apenas as informações que você cadastrar aqui. Nada é enviado ou alterado sem aprovação da equipe." />
      <div className="space-y-6">
        {!configured && <Notice tone="money">A IA ainda não está ativa nesta instalação: o administrador da plataforma precisa definir ANTHROPIC_API_KEY. Você já pode cadastrar o conhecimento abaixo.</Notice>}

        <div className="grid gap-3 sm:grid-cols-4">
          <Card className="p-4"><p className="text-xs text-muted">Usos este mês</p><p className="mt-1 text-2xl font-semibold tabular-nums">{d.usage.calls} <span className="text-sm font-normal text-muted">/ {d.org.ai_monthly_credits}</span></p></Card>
          <Card className="p-4"><p className="text-xs text-muted">Sugestões aproveitadas</p><p className="mt-1 text-2xl font-semibold tabular-nums">{acceptRate === null ? "—" : `${acceptRate}%`}</p><p className="text-xs text-muted">{d.usage.repliesEdited} editadas antes de enviar</p></Card>
          <Card className="p-4"><p className="text-xs text-muted">Bloqueadas pela verificação</p><p className="mt-1 text-2xl font-semibold tabular-nums">{d.usage.blocked}</p><p className="text-xs text-muted">citavam valores fora do catálogo</p></Card>
          <Card className="p-4"><p className="text-xs text-muted">Status</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={d.org.ai_enabled ? "success" : "neutral"}>{d.org.ai_enabled ? "Ativada" : "Desativada"}</Badge>
              {manager && <form action={toggleAiAction}><input type="hidden" name="enabled" value={d.org.ai_enabled ? "0" : "1"} /><button className={buttonClass("ghost", "sm")}>{d.org.ai_enabled ? "Desativar" : "Ativar"}</button></form>}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Catálogo de produtos e serviços" description="Única fonte de preços que a IA pode citar. Respostas com valores fora daqui são bloqueadas automaticamente." />
          {d.catalog.length > 0 && (
            <ul className="divide-y divide-border text-sm">
              {d.catalog.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span className={p.active ? "" : "text-muted line-through"}>{p.name}{p.duration_min ? <span className="text-muted"> · {p.duration_min} min</span> : null}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{p.price_type === "on_request" ? "sob consulta" : `${p.price_type === "from" ? "a partir de " : ""}${money(p.price_cents, true)}`}</span>
                    {manager && <form action={toggleProductAction}><input type="hidden" name="id" value={p.id} /><button className="text-xs text-muted hover:text-text">{p.active ? "Desativar" : "Reativar"}</button></form>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {manager && (
            <ActionForm action={saveProductAction} resetOnSuccess className="grid gap-3 border-t border-border p-5 sm:grid-cols-[1fr_9rem_10rem_7rem]">
              <Field label="Produto ou serviço" htmlFor="pname"><Input id="pname" name="name" required placeholder="Ex.: Clareamento a laser" /></Field>
              <Field label="Preço (R$)" htmlFor="pprice"><Input id="pprice" name="price" inputMode="decimal" placeholder="0,00" /></Field>
              <Field label="Tipo de preço" htmlFor="ptype"><Select id="ptype" name="priceType"><option value="fixed">Fixo</option><option value="from">A partir de</option><option value="on_request">Sob consulta</option></Select></Field>
              <Field label="Duração (min)" htmlFor="pdur"><Input id="pdur" name="durationMin" inputMode="numeric" /></Field>
              <div className="sm:col-span-4"><Field label="Descrição (opcional)" htmlFor="pdesc"><Input id="pdesc" name="description" placeholder="O que está incluso, indicações…" /></Field></div>
              <div className="sm:col-span-4"><SubmitButton>Adicionar ao catálogo</SubmitButton></div>
            </ActionForm>
          )}
        </Card>

        <Card>
          <CardHeader title="Base de conhecimento" description="Perguntas frequentes, políticas, procedimentos, informações de pagamento. A IA consulta apenas os documentos da sua empresa." />
          {d.docs.length > 0 && (
            <ul className="divide-y divide-border text-sm">
              {d.docs.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span>{doc.title} <span className="text-muted">· {doc.kind === "faq" ? "FAQ" : "texto"} · {doc.chars.toLocaleString("pt-BR")} caracteres · {dateTime(doc.created_at)}</span></span>
                  {manager && <form action={deleteDocumentAction}><input type="hidden" name="id" value={doc.id} /><button className="text-xs text-danger hover:underline">Excluir</button></form>}
                </li>
              ))}
            </ul>
          )}
          {manager && (
            <ActionForm action={addDocumentAction} resetOnSuccess className="grid gap-3 border-t border-border p-5">
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <Field label="Título" htmlFor="dtitle"><Input id="dtitle" name="title" required placeholder="Ex.: Formas de pagamento" /></Field>
                <Field label="Tipo" htmlFor="dkind"><Select id="dkind" name="kind"><option value="faq">Perguntas frequentes</option><option value="text">Texto livre</option></Select></Field>
              </div>
              <Field label="Conteúdo" htmlFor="dcontent" hint="Separe assuntos com uma linha em branco. Ex.: “Aceitamos Pix, cartão em até 10x sem juros e boleto.”">
                <Textarea id="dcontent" name="content" rows={6} required />
              </Field>
              <div><SubmitButton>Adicionar documento</SubmitButton></div>
            </ActionForm>
          )}
        </Card>

        <Card>
          <CardHeader title="Personalidade e regras do assistente" />
          <ActionForm action={saveAgentAction} className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Nome do assistente" htmlFor="aname"><Input id="aname" name="name" defaultValue={d.agent.name} required disabled={!manager} /></Field>
            <Field label="Formalidade" htmlFor="aform">
              <Select id="aform" name="formality" defaultValue={d.agent.formality} disabled={!manager}><option value="informal">Informal</option><option value="neutral">Neutra</option><option value="formal">Formal</option></Select>
            </Field>
            <div className="sm:col-span-2"><Field label="Tom de comunicação" htmlFor="atone"><Input id="atone" name="tone" defaultValue={d.agent.tone} required disabled={!manager} /></Field></div>
            <div className="sm:col-span-2"><Field label="Sobre a empresa" htmlFor="abiz"><Textarea id="abiz" name="businessDescription" rows={3} defaultValue={d.agent.businessDescription ?? ""} disabled={!manager} placeholder="O que a empresa faz, diferenciais, endereço…" /></Field></div>
            <Field label="Horário de atendimento" htmlFor="ahours"><Input id="ahours" name="businessHours" defaultValue={d.agent.businessHours ?? ""} disabled={!manager} placeholder="Seg a sex, 8h às 18h" /></Field>
            <Field label="Quando passar para um humano" htmlFor="ahand"><Input id="ahand" name="handoffRules" defaultValue={d.agent.handoffRules ?? ""} disabled={!manager} placeholder="Reclamações, urgências, pedidos de desconto" /></Field>
            <div className="sm:col-span-2"><Field label="Políticas e condições comerciais" htmlFor="apol" hint="Descontos, parcelamento, cancelamento, garantia. A IA só cita condições escritas aqui ou na base."><Textarea id="apol" name="policies" rows={4} defaultValue={d.agent.policies ?? ""} disabled={!manager} /></Field></div>
            <div className="sm:col-span-2"><Field label="Assuntos proibidos" htmlFor="aforb"><Input id="aforb" name="forbiddenTopics" defaultValue={d.agent.forbiddenTopics ?? ""} disabled={!manager} placeholder="Diagnósticos, política, concorrentes…" /></Field></div>
            {manager && <div className="sm:col-span-2"><SubmitButton>Salvar configuração</SubmitButton></div>}
          </ActionForm>
        </Card>

        <p className="text-xs text-muted">Custo estimado de IA este mês: US$ {d.usage.costUsd.toFixed(2)} (calculado pelos tokens de cada chamada). As conversas enviadas para análise são processadas pelo provedor de IA apenas para gerar a sugestão; dados de uma empresa nunca são usados para outra.</p>
      </div>
    </>
  );
}
