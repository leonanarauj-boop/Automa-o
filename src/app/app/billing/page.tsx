import { tenant } from "@/lib/session";
import { billingProvider } from "@/modules/billing/asaas";
import { entitlements, usage } from "@/modules/billing/service";
import { PAID_PLANS, PLANS, getPlan, type PlanKey } from "@/modules/billing/plans";
import { dateTime, money } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Input, Notice, PageHeader, cx } from "@/components/ui";
import { cancelAction, changePlanAction, refreshInvoicesAction } from "./actions";
import { CheckoutForm } from "./checkout-form";

export const metadata = { title: "Assinatura" };

const INVOICE: Record<string, { label: string; tone: "neutral" | "success" | "danger" | "money" }> = {
  pending: { label: "Em aberto", tone: "money" }, paid: { label: "Paga", tone: "success" }, overdue: { label: "Vencida", tone: "danger" },
  refunded: { label: "Estornada", tone: "neutral" }, canceled: { label: "Cancelada", tone: "neutral" }, chargeback: { label: "Contestada", tone: "danger" },
};
const STATUS: Record<string, string> = { trial: "Teste grátis", active: "Ativa", past_due: "Pagamento pendente", suspended: "Acesso restrito", canceled: "Cancelada" };

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted">{used.toLocaleString("pt-BR")} / {limit ? limit.toLocaleString("pt-BR") : "não incluso"}</span></div>
      <div className="mt-1 h-2 rounded-full bg-surface-2"><div className={cx("h-2 rounded-full", pct >= 90 ? "bg-danger" : "bg-primary")} style={{ width: `${limit ? pct : 0}%` }} /></div>
    </div>
  );
}

export default async function Billing() {
  const d = await tenant(async (db, s) => ({
    s, e: await entitlements(db, s.orgId), u: await usage(db, s.orgId),
    sub: (await db.query<{ plan_key: PlanKey; status: string; price_cents: string; current_period_end: Date | null; pending_plan_key: PlanKey | null; coupon_code: string | null; coupon_months_left: number | null; canceled_at: Date | null; customer_name: string }>(
      "select plan_key, status, price_cents, current_period_end, pending_plan_key, coupon_code, coupon_months_left, canceled_at, customer_name from subscriptions limit 1")).rows[0] ?? null,
    invoices: (await db.query<{ id: string; amount_cents: string; status: string; due_date: string; paid_at: Date | null; invoice_url: string | null }>(
      "select id, amount_cents, status, to_char(due_date, 'DD/MM/YYYY') due_date, paid_at, invoice_url from invoices order by due_date desc, created_at desc limit 24")).rows,
  }));
  const admin = d.s.role !== "agent";
  const live = d.sub && d.sub.status !== "canceled";
  const trialDays = Math.max(0, Math.ceil((d.e.trialEndsAt.getTime() - Date.now()) / 86400_000));
  const configured = billingProvider().available();

  return (
    <>
      <PageHeader title="Assinatura" description="Plano, consumo e faturas da sua conta." />
      <div className="space-y-6">
        {d.e.status === "suspended" && <Notice tone="danger">Acesso restrito: o envio de mensagens, campanhas, automações e IA está pausado. Seus dados e as mensagens recebidas continuam guardados. {live ? "Pague a fatura em aberto para liberar." : "Escolha um plano para continuar."}</Notice>}
        {d.e.status === "past_due" && <Notice tone="money">Há uma fatura vencida. Tudo continua funcionando por até 7 dias após o vencimento; depois o envio de mensagens é pausado.</Notice>}
        {!configured && <Notice tone="money">Os pagamentos ainda não estão configurados nesta instalação (ASAAS_API_KEY).</Notice>}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title={`Plano ${d.e.plan.name}`} action={<Badge tone={d.e.status === "active" ? "success" : d.e.status === "trial" ? "primary" : "danger"}>{STATUS[d.e.status]}</Badge>} />
            <div className="space-y-2 p-5 text-sm">
              {d.e.status === "trial" && <p>{trialDays > 0 ? `Seu teste termina em ${trialDays} dia(s) (${dateTime(d.e.trialEndsAt)}).` : "Seu teste terminou."}{d.sub?.status === "pending" && " A assinatura já está contratada e a primeira cobrança vence no fim do teste."}</p>}
              {d.sub && <p className="text-muted">Valor: {money(d.sub.price_cents, true)}/mês{d.sub.coupon_code ? ` · cupom ${d.sub.coupon_code}${d.sub.coupon_months_left !== null ? ` (${d.sub.coupon_months_left} mês(es) restantes)` : ""}` : ""}</p>}
              {d.sub?.current_period_end && <p className="text-muted">{d.sub.status === "canceled" ? "Acesso até" : "Período pago até"} {dateTime(d.sub.current_period_end)}</p>}
              {d.sub?.pending_plan_key && <p className="text-money">Troca para o plano {getPlan(d.sub.pending_plan_key).name} agendada para o fim do período.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Consumo" description="Uso atual frente aos limites do plano." />
            <div className="space-y-3 p-5">
              <Meter label="Contatos" used={d.u.contacts} limit={d.e.plan.limits.contacts} />
              <Meter label="Usos de IA neste mês" used={d.u.aiCalls} limit={d.e.plan.limits.aiCredits} />
              <Meter label="Automações ativas" used={d.u.automations} limit={d.e.plan.limits.activeAutomations} />
              <Meter label="Usuários" used={d.u.users} limit={d.e.plan.limits.users} />
            </div>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {PAID_PLANS.map((p) => {
            const current = live && d.sub!.plan_key === p.key;
            return (
              <Card key={p.key} className={cx("flex flex-col p-5", current && "border-primary ring-1 ring-primary")}>
                <div className="flex items-center justify-between"><h2 className="font-semibold">{p.name}</h2>{current && <Badge tone="primary">Atual</Badge>}</div>
                <p className="mt-1 text-sm text-muted">{p.description}</p>
                <p className="mt-3 text-3xl font-semibold tabular-nums">{money(p.priceCents)}<span className="text-sm font-normal text-muted">/mês</span></p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">{p.highlights.map((h) => <li key={h}>✓ {h}</li>)}</ul>
                <div className="mt-4">
                  {!admin ? null : !live ? (configured && <CheckoutForm planKey={p.key} planName={p.name} defaultEmail={d.s.userEmail} defaultName={d.s.orgName} />)
                    : !current && (
                      <ActionForm action={changePlanAction}><input type="hidden" name="planKey" value={p.key} />
                        <SubmitButton size="sm" variant="secondary" className="w-full" pendingText="Trocando…">Mudar para {p.name}</SubmitButton></ActionForm>
                    )}
                </div>
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-muted">Mensagens do WhatsApp são cobradas pela Meta diretamente na sua conta, à parte da assinatura. Upgrade libera os recursos na hora e o novo valor vale a partir do próximo vencimento; downgrade vale no próximo ciclo.</p>

        <Card>
          <CardHeader title="Faturas" action={live ? <ActionForm action={refreshInvoicesAction}><SubmitButton size="sm" variant="ghost" pendingText="Atualizando…">Atualizar</SubmitButton></ActionForm> : undefined} />
          {d.invoices.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nenhuma fatura ainda.</p> : (
            <ul className="divide-y divide-border text-sm">
              {d.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span>Vencimento {i.due_date} · <span className="tabular-nums">{money(i.amount_cents, true)}</span>{i.paid_at && <span className="text-muted"> · paga em {dateTime(i.paid_at)}</span>}</span>
                  <span className="flex items-center gap-3"><Badge tone={INVOICE[i.status].tone}>{INVOICE[i.status].label}</Badge>
                    {i.invoice_url && <a href={i.invoice_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{i.status === "pending" || i.status === "overdue" ? "Pagar" : "Ver"}</a>}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {admin && live && (
          <Card>
            <CardHeader title="Cancelar assinatura" description="Nenhuma nova cobrança será gerada. O acesso continua até o fim do período já pago; depois, a conta fica com acesso restrito e os dados continuam guardados até você pedir a exclusão." />
            <ActionForm action={cancelAction} className="flex flex-col gap-2 p-5 sm:flex-row">
              <Input name="confirm" placeholder="Digite CANCELAR para confirmar" aria-label="Confirmação" className="sm:max-w-xs" />
              <SubmitButton variant="danger" pendingText="Cancelando…">Cancelar assinatura</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
