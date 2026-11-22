import Link from "next/link";
import { tenant } from "@/lib/session";
import { listContacts } from "@/modules/crm/service";
import { phone, relative, TEMPERATURE } from "@/lib/format";
import { Badge, Card, DemoBadge, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass } from "@/components/ui";

export const metadata = { title: "Contatos" };
const PAGE = 50;

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; p?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.p ?? 0) || 0);
  const tagId = sp.tag && /^[0-9a-f-]{36}$/.test(sp.tag) ? sp.tag : undefined;
  const { list, tags } = await tenant(async (db) => ({
    list: await listContacts(db, { q: sp.q, tagId, limit: PAGE, offset: page * PAGE }),
    tags: (await db.query<{ id: string; name: string }>("select id, name from tags order by name")).rows,
  }));
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(tagId ? { tag: tagId } : {}), p: String(p) })}`;

  return (
    <>
      <PageHeader title="Contatos" description={`${list.total} contato(s)`} action={<LinkButton href="/app/contacts/new">Novo contato</LinkButton>} />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="q" className="sr-only">Buscar</label>
        <Input id="q" name="q" defaultValue={sp.q} placeholder="Buscar por nome, telefone, e-mail ou empresa" className="sm:max-w-sm" />
        <label htmlFor="tag" className="sr-only">Etiqueta</label>
        <Select id="tag" name="tag" defaultValue={tagId ?? ""} className="sm:w-48">
          <option value="">Todas as etiquetas</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <button className={buttonClass("secondary")}>Filtrar</button>
      </form>
      <Card>
        {list.rows.length === 0 ? (
          <EmptyState title={sp.q || tagId ? "Nenhum contato encontrado" : "Nenhum contato ainda"}>
            {sp.q || tagId ? "Tente outra busca." : "Contatos são criados automaticamente quando alguém fala com seu WhatsApp, ou você pode cadastrar manualmente."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted">
                <tr><th className="px-4 py-3 font-medium">Nome</th><th className="px-4 py-3 font-medium">Telefone</th><th className="hidden px-4 py-3 font-medium md:table-cell">Etiquetas</th><th className="px-4 py-3 font-medium">Temperatura</th><th className="hidden px-4 py-3 font-medium sm:table-cell">Última atividade</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.rows.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3"><Link href={`/app/contacts/${c.id}`} className="font-medium hover:underline">{c.display_name}</Link> {c.is_demo && <DemoBadge />}{c.company && <p className="text-xs text-muted">{c.company}</p>}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{phone(c.phone_e164)}</td>
                    <td className="hidden px-4 py-3 md:table-cell"><div className="flex flex-wrap gap-1">{c.tags?.map((t) => <Badge key={t}>{t}</Badge>)}</div></td>
                    <td className="px-4 py-3">{c.temperature ? <Badge tone={TEMPERATURE[c.temperature].tone}>{TEMPERATURE[c.temperature].label}</Badge> : <span className="text-muted">—</span>}</td>
                    <td className="hidden px-4 py-3 text-muted sm:table-cell">{relative(c.last_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {list.total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 0 ? <Link href={qs(page - 1)} className={buttonClass("secondary", "sm")}>Anterior</Link> : <span />}
          <span className="text-muted">Página {page + 1} de {Math.ceil(list.total / PAGE)}</span>
          {(page + 1) * PAGE < list.total ? <Link href={qs(page + 1)} className={buttonClass("secondary", "sm")}>Próxima</Link> : <span />}
        </div>
      )}
    </>
  );
}
