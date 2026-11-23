import Link from "next/link";
import { listOrgs } from "@/modules/admin/service";
import { dateTime, money, relative } from "@/lib/format";
import { getPlan } from "@/modules/billing/plans";
import { Badge, Card, EmptyState, Input, PageHeader, Select, buttonClass } from "@/components/ui";

export const metadata = { title: "Empresas" };
const ST: Record<string, { l: string; t: "primary" | "success" | "money" | "danger" | "neutral" }> = {
  trial: { l: "Teste", t: "primary" }, active: { l: "Ativa", t: "success" }, past_due: { l: "Inadimplente", t: "money" }, suspended: { l: "Restrita", t: "danger" }, canceled: { l: "Cancelada", t: "neutral" },
};

export default async function Orgs({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; p?: string }> }) {
  const sp = await searchParams;
  const rows = await listOrgs({ q: sp.q, status: sp.status, page: Number(sp.p ?? 0) || 0 });
  return (
    <>
      <PageHeader title="Empresas" description={`${rows[0]?.total ?? 0} encontrada(s)`} />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <Input name="q" defaultValue={sp.q} placeholder="Nome ou ID" aria-label="Buscar empresa" className="sm:max-w-xs" />
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="sm:w-44">
          <option value="">Todos os status</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </Select>
        <button className={buttonClass("secondary")}>Filtrar</button>
      </form>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <EmptyState title="Nenhuma empresa" /> : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted"><tr>
              <th className="px-4 py-3 font-medium">Empresa</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">MRR</th><th className="px-4 py-3 font-medium">Usuários</th><th className="px-4 py-3 font-medium">Contatos</th>
              <th className="px-4 py-3 font-medium">Última mensagem</th><th className="px-4 py-3 font-medium">Criada</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3"><Link href={`/admin/empresas/${o.id}`} className="font-medium hover:underline">{o.name}</Link><span className="block text-xs text-muted">{o.segment}</span></td>
                  <td className="px-4 py-3"><Badge tone={ST[o.status].t}>{ST[o.status].l}</Badge></td>
                  <td className="px-4 py-3">{getPlan(o.plan).name}</td>
                  <td className="px-4 py-3 tabular-nums">{o.mrr ? money(o.mrr) : "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{o.members}</td>
                  <td className="px-4 py-3 tabular-nums">{o.contacts}</td>
                  <td className="px-4 py-3 text-muted">{relative(o.last_message)}</td>
                  <td className="px-4 py-3 text-muted">{dateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
