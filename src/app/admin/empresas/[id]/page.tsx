import Link from "next/link";
import { notFound } from "next/navigation";
import { orgDetail } from "@/modules/admin/service";
import { dateTime, money } from "@/lib/format";
import { getPlan } from "@/modules/billing/plans";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Input, Notice, PageHeader } from "@/components/ui";
import { aiOverrideAction, blockAction, extendTrialAction } from "../../actions";

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await orgDetail(id);
  if (!d) notFound();
  const u = d.usage;
  return (
    <>
      <PageHeader title={d.org.name} description={<span><Link href="/admin/empresas" className="hover:underline">← Empresas</Link> · {d.org.segment} · criada {dateTime(d.org.created_at)} · status {d.org.status} · plano {getPlan(d.org.plan).name}</span>} />
      {d.org.admin_blocked_reason && <div className="mb-6"><Notice tone="danger">Bloqueada pela plataforma: {d.org.admin_blocked_reason}</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Uso" description="Somente contagens — sem acesso a conteúdo." />
            <dl className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
              {[["Contatos", u.contacts], ["Enviadas (30d)", u.sent30], ["Recebidas (30d)", u.received30], ["IA no mês", `${u.ai_month} / ${d.org.ai_monthly_credits}`],
                ["Custo IA no mês", `US$ ${(Number(u.ai_cost) / 1e6).toFixed(2)}`], ["Automações ativas", u.automations], ["Campanhas", u.campaigns], ["Números WhatsApp", u.channels]].map(([l, v]) => (
                <div key={l}><dt className="text-xs text-muted">{l}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Assinatura e faturas" />
            <div className="p-5 text-sm">
              {d.sub ? <p>{getPlan(d.sub.plan_key).name} · {d.sub.status} · {money(d.sub.price_cents, true)}/mês{d.sub.coupon_code ? ` · cupom ${d.sub.coupon_code}` : ""}{d.sub.current_period_end ? ` · pago até ${dateTime(d.sub.current_period_end)}` : ""}{d.sub.pending_plan_key ? ` · troca para ${getPlan(d.sub.pending_plan_key).name} agendada` : ""}<span className="block text-xs text-muted">Assinatura no gateway: {d.sub.gateway_subscription_id ?? "—"}</span></p>
                : <p className="text-muted">Sem assinatura. Teste até {dateTime(d.org.trial_ends_at)}.</p>}
            </div>
            {d.invoices.length > 0 && <ul className="divide-y divide-border border-t border-border text-sm">{d.invoices.map((i, k) => <li key={k} className="flex justify-between px-5 py-2"><span>{i.due_date} · {money(i.amount_cents, true)}</span><Badge>{i.status}</Badge></li>)}</ul>}
          </Card>
          <Card>
            <CardHeader title="Equipe" />
            <ul className="divide-y divide-border text-sm">{d.members.map((m, k) => <li key={k} className="flex justify-between gap-2 px-5 py-2"><span>{m.full_name} <span className="text-muted">· {m.email}</span></span><span className="flex gap-2"><Badge>{({ owner: "Dono", manager: "Gestor", agent: "Atendente" } as Record<string, string>)[m.role]}</Badge>{m.status !== "active" && <Badge tone="danger">Desativado</Badge>}{m.mfa && <Badge tone="success">2 etapas</Badge>}</span></li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Atividade recente (somente tipo de ação)" />
            <ul className="divide-y divide-border text-sm">{d.audit.map((a, k) => <li key={k} className="flex justify-between px-5 py-2"><span className="font-mono text-xs">{a.action}</span><span className="text-xs text-muted">{a.actor_type} · {dateTime(a.created_at)}</span></li>)}</ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Estender teste</h2>
            <ActionForm action={extendTrialAction} className="flex gap-2"><input type="hidden" name="orgId" value={id} />
              <Input name="days" type="number" min={1} max={60} defaultValue={7} aria-label="Dias" className="w-24" /><SubmitButton size="sm" variant="secondary">Estender</SubmitButton></ActionForm>
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Créditos de IA por mês</h2>
            <p className="text-xs text-muted">Padrão do plano: {getPlan(d.org.plan).limits.aiCredits}. Vazio = padrão.</p>
            <ActionForm action={aiOverrideAction} className="flex gap-2"><input type="hidden" name="orgId" value={id} />
              <Input name="credits" type="number" min={0} defaultValue={d.org.ai_credits_override ?? ""} aria-label="Créditos" className="w-28" /><SubmitButton size="sm" variant="secondary">Salvar</SubmitButton></ActionForm>
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Bloqueio manual</h2>
            <p className="text-xs text-muted">Para abuso ou fraude: restringe envios, campanhas, automações e IA. Mensagens recebidas continuam sendo gravadas. O cliente vê a ação no histórico.</p>
            {d.org.admin_blocked_reason
              ? <ActionForm action={blockAction}><input type="hidden" name="orgId" value={id} /><input type="hidden" name="unblock" value="1" /><SubmitButton size="sm" variant="secondary">Remover bloqueio</SubmitButton></ActionForm>
              : <ActionForm action={blockAction} className="space-y-2"><input type="hidden" name="orgId" value={id} /><Input name="reason" placeholder="Motivo (obrigatório)" aria-label="Motivo" /><SubmitButton size="sm" variant="danger">Bloquear</SubmitButton></ActionForm>}
          </Card>
        </div>
      </div>
    </>
  );
}
