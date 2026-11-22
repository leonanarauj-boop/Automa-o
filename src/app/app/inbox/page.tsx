import Link from "next/link";
import { tenant } from "@/lib/session";
import { dateTime, phone, relative, timeOnly } from "@/lib/format";
import { isWindowOpen } from "@/modules/whatsapp/rules";
import { marketingOptedOut } from "@/modules/inbox/outbound";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, DemoBadge, EmptyState, Notice, Textarea, cx } from "@/components/ui";
import { markReadAction, sendTemplateAction, sendTextAction } from "../actions";
import { TemplatePicker } from "./template-picker";
import { aiProvider } from "@/modules/ai/anthropic";
import { AnalysisCard } from "@/components/ai/analysis-card";
import { CopyButton } from "@/components/ai/copy-button";
import type { AnalysisPayload } from "@/modules/ai/copilot";
import { discardReplyAction, suggestReplyAction } from "../actions";

export const metadata = { title: "Conversas" };

const STATUS_LABEL: Record<string, string> = { pending: "na fila", sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" };

export default async function Inbox({ searchParams }: { searchParams: Promise<{ c?: string; filtro?: string }> }) {
  const sp = await searchParams;
  const filter = sp.filtro === "aguardando" ? "aguardando" : "todas";
  const data = await tenant(async (db) => {
    const list = await db.query<{
      id: string; contact_id: string; display_name: string; phone_e164: string | null; last_message_at: Date | null; unread_count: number;
      is_demo: boolean; last_body: string | null; last_direction: string | null; window: Date | null;
    }>(
      `select c.id, c.contact_id, ct.display_name, ct.phone_e164, c.last_message_at, c.unread_count, c.is_demo, c.service_window_expires_at as window,
              lm.body as last_body, lm.direction as last_direction
       from conversations c join contacts ct on ct.id = c.contact_id
       left join lateral (select body, direction from messages m where m.conversation_id = c.id order by sent_at desc limit 1) lm on true
       where c.status = 'open' and ct.deleted_at is null and ($1 = 'todas' or lm.direction = 'inbound')
       order by c.last_message_at desc nulls last limit 100`,
      [filter],
    );
    const selectedId = sp.c && /^[0-9a-f-]{36}$/.test(sp.c) ? sp.c : list.rows[0]?.id;
    if (!selectedId) return { list: list.rows, selected: null };
    const conv = await db.query<{
      id: string; contact_id: string; display_name: string; phone_e164: string | null; temperature: string | null; is_demo: boolean;
      service_window_expires_at: Date | null; channel_account_id: string | null;
    }>(
      `select c.id, c.contact_id, ct.display_name, ct.phone_e164, ct.temperature, c.is_demo, c.service_window_expires_at, c.channel_account_id
       from conversations c join contacts ct on ct.id = c.contact_id where c.id = $1`,
      [selectedId],
    );
    if (!conv.rowCount) return { list: list.rows, selected: null };
    const msgs = await db.query<{ id: string; direction: string; body: string | null; status: string; sent_at: Date; error: string | null; type: string; sender: string | null }>(
      `select m.id, m.direction, m.body, m.status, m.sent_at, m.error, m.type, u.full_name as sender
       from messages m left join users u on u.id = m.sender_user_id where m.conversation_id = $1 order by m.sent_at asc limit 300`,
      [selectedId],
    );
    const templates = conv.rows[0].channel_account_id
      ? (await db.query<{ id: string; name: string; language: string; category: string; body_text: string | null; body_param_count: number }>(
          "select id, name, language, category, body_text, body_param_count from message_templates where channel_account_id = $1 and status = 'APPROVED' order by name",
          [conv.rows[0].channel_account_id],
        )).rows
      : [];
    const deals = await db.query<{ title: string; stage: string; value_cents: string }>(
      "select d.title, s.name as stage, d.value_cents from deals d join pipeline_stages s on s.id = d.stage_id where d.contact_id = $1 and d.status = 'open'",
      [conv.rows[0].contact_id],
    );
    const optedOut = await marketingOptedOut(db, conv.rows[0].contact_id);
    const sugg = await db.query<{ id: string; kind: string; payload: never }>(
      `select distinct on (kind) id, kind, payload from ai_suggestions
       where status = 'pending' and ((kind = 'reply' and conversation_id = $1) or (kind = 'analysis' and contact_id = $2))
       order by kind, created_at desc`, [selectedId, conv.rows[0].contact_id]);
    const reply = sugg.rows.find((x) => x.kind === "reply") as { id: string; payload: { reply: string; needs_human: boolean; reason: string | null; blocked: boolean; violations: string[] } } | undefined;
    const analysis = sugg.rows.find((x) => x.kind === "analysis") as { id: string; payload: AnalysisPayload } | undefined;
    const ai = (await db.query<{ ai_enabled: boolean; ai_summary: string | null }>(
      "select o.ai_enabled, ct.ai_summary from organizations o, contacts ct where ct.id = $1", [conv.rows[0].contact_id])).rows[0];
    return { list: list.rows, selected: { ...conv.rows[0], messages: msgs.rows, templates, deals: deals.rows, optedOut, reply, analysis, aiEnabled: ai.ai_enabled, aiSummary: ai.ai_summary } };
  });

  const sel = data.selected;
  const explicit = !!sp.c;
  const aiReady = !!sel?.aiEnabled && aiProvider().available(); // no celular, a lista aparece até o usuário escolher uma conversa
  const windowOpen = sel ? isWindowOpen(sel.service_window_expires_at) : false;

  return (
    <div className="-mx-4 -my-6 md:-mx-8 md:-my-8">
      <AutoRefresh ms={5000} />
      <div className="grid h-[calc(100dvh-7.5rem)] grid-cols-1 md:h-dvh md:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_17rem]">
        {/* Lista */}
        <aside className={cx("flex min-h-0 flex-col border-r border-border bg-surface", explicit && sel && "hidden md:flex")}>
          <div className="border-b border-border px-4 py-3">
            <h1 className="font-semibold">Conversas</h1>
            <div className="mt-2 flex gap-1 text-sm" role="tablist">
              {(["todas", "aguardando"] as const).map((f) => (
                <Link key={f} href={f === "todas" ? "/app/inbox" : "/app/inbox?filtro=aguardando"} role="tab" aria-selected={filter === f}
                  className={cx("rounded-md px-2.5 py-1", filter === f ? "bg-primary-soft font-medium text-primary" : "text-muted hover:bg-surface-2")}>
                  {f === "todas" ? "Todas" : "Aguardando resposta"}
                </Link>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {data.list.length === 0 && <EmptyState title="Nenhuma conversa ainda">Quando um cliente mandar mensagem para o seu número conectado, a conversa aparece aqui automaticamente.</EmptyState>}
            {data.list.map((c) => (
              <li key={c.id}>
                <Link href={`/app/inbox?c=${c.id}${filter === "aguardando" ? "&filtro=aguardando" : ""}`}
                  className={cx("block border-b border-border px-4 py-3 hover:bg-surface-2", sel?.id === c.id && "bg-surface-2")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.display_name}</span>
                    <span className="shrink-0 text-xs text-muted">{relative(c.last_message_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-sm text-muted">{c.last_direction === "outbound" ? "Você: " : ""}{c.last_body ?? "—"}</span>
                    {c.is_demo && <DemoBadge />}
                    {c.unread_count > 0 && <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary">{c.unread_count}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        {/* Conversa */}
        {sel ? (
          <section className={cx("min-h-0 min-w-0 flex-col bg-bg", explicit ? "flex" : "hidden md:flex")}>
            <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
              <Link href="/app/inbox" className="text-sm text-muted md:hidden" aria-label="Voltar para a lista">←</Link>
              <div className="min-w-0 flex-1">
                <Link href={`/app/contacts/${sel.contact_id}`} className="block truncate font-medium hover:underline">{sel.display_name}</Link>
                <p className="text-xs text-muted">{phone(sel.phone_e164)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                {sel.is_demo && <DemoBadge />}
                <Badge tone={windowOpen ? "success" : "neutral"}>{windowOpen ? <>Janela aberta<span className="hidden sm:inline">&nbsp;até {timeOnly(sel.service_window_expires_at!)}</span></> : "Janela fechada"}</Badge>
                <form action={markReadAction}><input type="hidden" name="conversationId" value={sel.id} /><button className="hidden text-xs text-muted hover:text-text sm:inline">Marcar como lida</button></form>
              </div>
            </header>

            <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-label="Mensagens">
              {sel.messages.map((m) => (
                <li key={m.id} className={cx("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
                  <div className={cx("max-w-[80%] rounded-2xl border border-border px-3 py-2 text-sm shadow-sm",
                    m.direction === "outbound" ? "rounded-br-md bg-bubble-out" : "rounded-bl-md bg-bubble-in")}>
                    {m.type === "template" && <p className="mb-1 text-xs font-medium text-muted">Template</p>}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="mt-1 text-right text-[11px] text-muted" title={dateTime(m.sent_at)}>
                      {timeOnly(m.sent_at)}
                      {m.direction === "outbound" && <> · <span className={m.status === "failed" ? "text-danger" : ""}>{STATUS_LABEL[m.status] ?? m.status}</span>{m.sender ? ` · ${m.sender}` : ""}</>}
                    </p>
                    {m.error && <p className="mt-1 text-xs text-danger">{m.error}</p>}
                  </div>
                </li>
              ))}
            </ol>

            <div className="border-t border-border bg-surface p-3">
              {!sel.channel_account_id ? (
                <div className="space-y-2">
                  {sel.reply && (
                    <div className="rounded-lg border border-primary/30 bg-primary-soft/40 p-3 text-sm">
                      <p className="font-medium text-primary">Sugestão da IA{sel.reply.payload.blocked ? " bloqueada" : ""}</p>
                      {sel.reply.payload.blocked
                        ? <p className="mt-1 text-danger">A resposta citava informações que não estão cadastradas ({sel.reply.payload.violations.join("; ")}).</p>
                        : <p className="mt-1 whitespace-pre-wrap">{sel.reply.payload.reply}</p>}
                      {!sel.reply.payload.blocked && sel.reply.payload.needs_human && <p className="mt-1 text-money">Atenção: {sel.reply.payload.reason ?? "a IA recomenda que um humano conduza esta resposta."}</p>}
                      <div className="mt-2 flex gap-2">
                        {!sel.reply.payload.blocked && <CopyButton text={sel.reply.payload.reply} />}
                        <form action={discardReplyAction}><input type="hidden" name="suggestionId" value={sel.reply.id} /><button className="h-8 px-2 text-xs text-muted hover:text-text">Descartar</button></form>
                      </div>
                    </div>
                  )}
                  <Notice>Esta conversa não está ligada a um número conectado{sel.is_demo ? " (dados de demonstração)" : ""}. Para enviar mensagens, <Link href="/app/settings#whatsapp" className="font-medium underline">conecte o WhatsApp</Link>.</Notice>
                  {aiReady && (
                    <ActionForm action={suggestReplyAction}>
                      <input type="hidden" name="conversationId" value={sel.id} />
                      <SubmitButton size="sm" variant="ghost" pendingText="Gerando sugestão…">✦ {sel.reply ? "Gerar outra sugestão" : "Testar sugestão de resposta com IA"}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ) : windowOpen ? (
                <div className="space-y-2">
                  {sel.reply && (
                    <div className="rounded-lg border border-primary/30 bg-primary-soft/40 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-primary">Sugestão da IA {sel.reply.payload.blocked ? "bloqueada" : "— revise antes de enviar"}</p>
                        <form action={discardReplyAction}><input type="hidden" name="suggestionId" value={sel.reply.id} /><button className="text-xs text-muted hover:text-text">Descartar</button></form>
                      </div>
                      {sel.reply.payload.blocked && <p className="mt-1 text-danger">A resposta citava informações que não estão cadastradas ({sel.reply.payload.violations.join("; ")}). Responda manualmente ou cadastre a informação em Assistente IA.</p>}
                      {!sel.reply.payload.blocked && sel.reply.payload.needs_human && <p className="mt-1 text-money">Atenção: {sel.reply.payload.reason ?? "a IA recomenda que um humano conduza esta resposta."}</p>}
                    </div>
                  )}
                  <ActionForm action={sendTextAction} resetOnSuccess className="flex items-end gap-2" key={sel.reply?.id ?? "manual"}>
                    <input type="hidden" name="conversationId" value={sel.id} />
                    {sel.reply && !sel.reply.payload.blocked && <input type="hidden" name="suggestionId" value={sel.reply.id} />}
                    <label htmlFor="body" className="sr-only">Mensagem</label>
                    <Textarea id="body" name="body" rows={sel.reply && !sel.reply.payload.blocked ? 4 : 2} maxLength={4096} required placeholder="Escreva sua resposta…"
                      defaultValue={sel.reply && !sel.reply.payload.blocked ? sel.reply.payload.reply : ""} className="min-h-[2.5rem] flex-1 resize-y" />
                    <SubmitButton pendingText="Enviando…">Enviar</SubmitButton>
                  </ActionForm>
                  {aiReady && (
                    <ActionForm action={suggestReplyAction}>
                      <input type="hidden" name="conversationId" value={sel.id} />
                      <SubmitButton size="sm" variant="ghost" pendingText="Gerando sugestão…">✦ {sel.reply ? "Gerar outra sugestão" : "Sugerir resposta com IA"}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ) : sel.optedOut ? (
                <Notice tone="danger">Este contato pediu para não receber mensagens. Envios iniciados pela empresa estão bloqueados até um novo consentimento.</Notice>
              ) : sel.templates.length === 0 ? (
                <Notice>A janela de 24h está fechada e só é possível retomar o contato com um template aprovado pela Meta. <Link href="/app/settings#whatsapp" className="font-medium underline">Sincronize seus templates</Link>.</Notice>
              ) : (
                <ActionForm action={sendTemplateAction} className="space-y-2">
                  <input type="hidden" name="conversationId" value={sel.id} />
                  <p className="text-xs text-muted">Janela fechada: escolha um template aprovado. Templates são cobrados pela Meta conforme a categoria.</p>
                  <TemplatePicker templates={sel.templates} />
                </ActionForm>
              )}
            </div>
          </section>
        ) : (
          <section className="hidden items-center justify-center md:flex"><EmptyState title="Selecione uma conversa" /></section>
        )}

        {/* Contexto do CRM */}
        {sel && (
          <aside className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface p-4 xl:block">
            <h2 className="text-sm font-semibold">Negócios abertos</h2>
            {sel.deals.length === 0 ? <p className="mt-1 text-sm text-muted">Nenhum.</p> : (
              <ul className="mt-2 space-y-2">
                {sel.deals.map((d, i) => (
                  <li key={i} className="rounded-lg border border-border p-3 text-sm">
                    <p className="font-medium">{d.title}</p>
                    <p className="text-muted">{d.stage} · {Number(d.value_cents) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(d.value_cents) / 100) : "sem valor"}</p>
                  </li>
                ))}
              </ul>
            )}
            <h2 className="mt-6 text-sm font-semibold">Memória comercial</h2>
            <p className="mt-1 text-sm text-muted">{sel.aiSummary ?? "Ainda não registrada."}</p>
            <h2 className="mt-6 mb-2 text-sm font-semibold">Copiloto</h2>
            <AnalysisCard conversationId={sel.id} suggestion={sel.analysis ?? null} aiReady={aiReady} />
            <Link href={`/app/contacts/${sel.contact_id}`} className="mt-6 inline-block text-sm text-primary hover:underline">Abrir ficha completa →</Link>
          </aside>
        )}
      </div>
    </div>
  );
}

