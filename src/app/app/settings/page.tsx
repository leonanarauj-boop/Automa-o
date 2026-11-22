import { tenant } from "@/lib/session";
import { env } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, buttonClass } from "@/components/ui";
import { connectChannelAction, disconnectChannelAction, syncTemplatesAction, updateRulesAction } from "../actions";
import { RULE_LABELS, type RuleKind } from "@/modules/radar/rules";
import { getSegment } from "@/modules/onboarding/segments";

export const metadata = { title: "Configurações" };

const RULE_HELP: Record<RuleKind, string> = {
  awaiting_reply: "Horas desde a última mensagem do cliente sem resposta da equipe.",
  lead_silent: "Horas desde a última mensagem da equipe sem retorno do cliente (só com negócio aberto).",
  deal_stale: "Horas sem nenhuma interação em um negócio aberto.",
};

export default async function Settings() {
  const d = await tenant(async (db, s) => ({
    s,
    channels: (await db.query<{ id: string; display_phone: string | null; phone_number_id: string; waba_id: string; status: string; created_at: Date }>(
      "select id, display_phone, phone_number_id, waba_id, status, created_at from channel_accounts order by created_at")).rows,
    templates: (await db.query<{ id: string; name: string; language: string; category: string; status: string; synced_at: Date }>(
      "select id, name, language, category, status, synced_at from message_templates order by name")).rows,
    rules: (await db.query<{ kind: RuleKind; threshold_hours: number; active: boolean }>("select kind, threshold_hours, active from opportunity_rules order by kind")).rows,
    team: (await db.query<{ full_name: string; email: string; role: string }>(
      "select u.full_name, u.email, m.role from memberships m join users u on u.id = m.user_id where m.status = 'active' order by m.created_at")).rows,
    logs: (await db.query<{ action: string; created_at: Date; actor: string | null }>(
      "select a.action, a.created_at, u.full_name as actor from audit_logs a left join users u on u.id = a.actor_id order by a.created_at desc limit 15")).rows,
  }));
  const manager = d.s.role !== "agent";
  const active = d.channels.find((c) => c.status === "active");
  const webhookUrl = `${env().APP_URL.replace(/\/$/, "")}/api/webhooks/whatsapp`;
  const ROLE: Record<string, string> = { owner: "Dono", manager: "Gestor", agent: "Atendente" };

  return (
    <>
      <PageHeader title="Configurações" description={`${d.s.orgName} · segmento: ${getSegment(d.s.segment).label}`} />
      <div className="space-y-6">
        <Card id="whatsapp">
          <CardHeader title="WhatsApp Business (API oficial da Meta)" description="Conexão pela WhatsApp Cloud API. Mensagens e templates são cobrados pela Meta diretamente na sua conta." />
          <div className="space-y-5 p-5">
            {active ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{active.display_phone ?? active.phone_number_id} <Badge tone="success">Conectado</Badge></p>
                  <p className="text-xs text-muted">ID do número {active.phone_number_id} · WABA {active.waba_id} · desde {dateTime(active.created_at)}</p>
                </div>
                {manager && <form action={disconnectChannelAction}><input type="hidden" name="channelId" value={active.id} /><button className={buttonClass("danger", "sm")}>Desconectar</button></form>}
              </div>
            ) : manager ? (
              <ActionForm action={connectChannelAction} className="grid gap-4 sm:grid-cols-2">
                <Field label="ID da conta do WhatsApp Business (WABA)" htmlFor="wabaId"><Input id="wabaId" name="wabaId" inputMode="numeric" required /></Field>
                <Field label="ID do número de telefone" htmlFor="phoneNumberId"><Input id="phoneNumberId" name="phoneNumberId" inputMode="numeric" required /></Field>
                <div className="sm:col-span-2"><Field label="Token de acesso (usuário do sistema)" htmlFor="accessToken" hint="Guardado criptografado. Nunca é exibido novamente nem enviado ao navegador."><Input id="accessToken" name="accessToken" type="password" autoComplete="off" required /></Field></div>
                <div className="sm:col-span-2"><SubmitButton pendingText="Validando com a Meta…">Conectar número</SubmitButton></div>
              </ActionForm>
            ) : <Notice>Peça ao dono ou a um gestor da conta para conectar o WhatsApp.</Notice>}

            <details className="rounded-lg border border-border p-4 text-sm">
              <summary className="cursor-pointer font-medium">Como obter esses dados e configurar o webhook</summary>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted">
                <li>No Meta for Developers, crie um app do tipo Business e adicione o produto WhatsApp.</li>
                <li>Em WhatsApp → Configuração da API, copie o <strong>ID do número de telefone</strong> e o <strong>ID da conta do WhatsApp Business</strong>.</li>
                <li>No Gerenciador de Negócios, crie um <strong>usuário do sistema</strong> com as permissões whatsapp_business_messaging e whatsapp_business_management e gere um token permanente.</li>
                <li>Em WhatsApp → Configuração → Webhook, informe a URL <code className="rounded bg-surface-2 px-1 text-text">{webhookUrl}</code> e o token de verificação definido pelo administrador da plataforma (variável META_WEBHOOK_VERIFY_TOKEN). Assine o campo <strong>messages</strong>.</li>
              </ol>
              <p className="mt-3 text-muted">A conexão em um clique (Embedded Signup) será habilitada quando o app da plataforma for aprovado como Tech Provider pela Meta.</p>
            </details>
          </div>
        </Card>

        {active && (
          <Card>
            <CardHeader title="Templates de mensagem" description="Necessários para iniciar conversas ou retomar contato após a janela de 24h. Crie e aprove no Gerenciador do WhatsApp; depois sincronize."
              action={<ActionForm action={syncTemplatesAction}><input type="hidden" name="channelId" value={active.id} /><SubmitButton size="sm" variant="secondary" pendingText="Sincronizando…">Sincronizar</SubmitButton></ActionForm>} />
            {d.templates.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nenhum template sincronizado.</p> : (
              <ul className="divide-y divide-border text-sm">
                {d.templates.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span>{t.name} <span className="text-muted">· {t.language} · {t.category.toLowerCase()}</span></span>
                    <Badge tone={t.status === "APPROVED" ? "success" : t.status === "REJECTED" ? "danger" : "neutral"}>{t.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card id="radar">
          <CardHeader title="Regras do Radar" description="Quando uma conversa ou negócio deve virar alerta." />
          <ActionForm action={updateRulesAction} className="space-y-4 p-5">
            {d.rules.map((r) => (
              <div key={r.kind} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-center">
                <div><p className="text-sm font-medium">{RULE_LABELS[r.kind]}</p><p className="text-xs text-muted">{RULE_HELP[r.kind]}</p></div>
                <label className="flex items-center gap-2 text-sm"><Input name={r.kind} type="number" min={1} max={2160} defaultValue={r.threshold_hours} disabled={!manager} aria-label={`${RULE_LABELS[r.kind]} em horas`} /> h</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`${r.kind}_active`} defaultChecked={r.active} disabled={!manager} className="accent-[var(--primary)]" /> Ativa</label>
              </div>
            ))}
            {manager && <SubmitButton>Salvar regras</SubmitButton>}
          </ActionForm>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Equipe" description="Convites de novos membros chegam na próxima entrega." />
            <ul className="divide-y divide-border text-sm">
              {d.team.map((m) => <li key={m.email} className="flex justify-between gap-2 px-5 py-3"><span>{m.full_name} <span className="text-muted">· {m.email}</span></span><Badge>{ROLE[m.role]}</Badge></li>)}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Registro de auditoria" description="Ações sensíveis realizadas na conta." />
            <ul className="divide-y divide-border text-sm">
              {d.logs.map((l, i) => <li key={i} className="flex justify-between gap-2 px-5 py-2.5"><span className="font-mono text-xs">{l.action}</span><span className="text-xs text-muted">{l.actor ?? "sistema"} · {dateTime(l.created_at)}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
