import { withService } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { couponActiveAction, createCouponAction } from "../actions";

export const metadata = { title: "Cupons" };

export default async function Coupons() {
  const rows = (await withService((db) => db.query<{ code: string; percent_off: number; duration_months: number | null; max_redemptions: number | null; redeemed_count: number; valid_until: Date | null; active: boolean }>(
    "select code, percent_off, duration_months, max_redemptions, redeemed_count, valid_until, active from coupons order by created_at desc"))).rows;
  return (
    <>
      <PageHeader title="Cupons" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          {rows.length === 0 ? <p className="p-5 text-sm text-muted">Nenhum cupom.</p> : (
            <ul className="divide-y divide-border text-sm">
              {rows.map((c) => (
                <li key={c.code} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span><span className="font-mono font-medium">{c.code}</span> <span className="text-muted">· {c.percent_off}% · {c.duration_months ? `${c.duration_months} mês(es)` : "permanente"} · {c.redeemed_count}{c.max_redemptions ? `/${c.max_redemptions}` : ""} uso(s){c.valid_until ? ` · até ${dateTime(c.valid_until)}` : ""}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={c.active ? "success" : "neutral"}>{c.active ? "Ativo" : "Inativo"}</Badge>
                    <form action={couponActiveAction}><input type="hidden" name="code" value={c.code} /><input type="hidden" name="active" value={c.active ? "0" : "1"} /><button className="text-xs text-muted hover:text-text">{c.active ? "Desativar" : "Reativar"}</button></form></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Novo cupom" />
          <ActionForm action={createCouponAction} resetOnSuccess className="space-y-3 p-5">
            <Field label="Código" htmlFor="cc"><Input id="cc" name="code" required placeholder="FUNDADOR" /></Field>
            <Field label="Desconto (%)" htmlFor="cp"><Input id="cp" name="percentOff" type="number" min={1} max={100} required /></Field>
            <Field label="Duração em meses" htmlFor="cd" hint="Vazio = enquanto durar a assinatura."><Input id="cd" name="durationMonths" type="number" min={1} max={36} /></Field>
            <Field label="Limite de usos" htmlFor="cm"><Input id="cm" name="maxRedemptions" type="number" min={1} /></Field>
            <Field label="Válido até" htmlFor="cv"><Input id="cv" name="validUntil" type="date" /></Field>
            <SubmitButton>Criar cupom</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
