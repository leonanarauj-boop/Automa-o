import Link from "next/link";
import { tenant } from "@/lib/session";
import { boardDeals, getDefaultPipeline } from "@/modules/crm/service";
import { money, relative } from "@/lib/format";
import { Card, DemoBadge, EmptyState, PageHeader } from "@/components/ui";
import { DealCard } from "./deal-card";
import { NewDeal } from "./new-deal";

export const metadata = { title: "Funil" };

export default async function Pipeline() {
  const { pipeline, deals, contacts } = await tenant(async (db) => {
    const pipeline = await getDefaultPipeline(db);
    return {
      pipeline,
      deals: await boardDeals(db, pipeline.id),
      contacts: (await db.query<{ id: string; display_name: string }>("select id, display_name from contacts where deleted_at is null order by display_name limit 500")).rows,
    };
  });
  return (
    <>
      <PageHeader title={pipeline.name} description="Mova os negócios entre as etapas. Ganhos ligados a um alerta do Radar contam como receita recuperada." action={<NewDeal contacts={contacts} stages={pipeline.stages} />} />
      {deals.length === 0 && contacts.length === 0 ? (
        <Card><EmptyState title="Seu funil está vazio">Negócios são criados automaticamente para cada novo contato que chega pelo WhatsApp. Você também pode cadastrar um <Link href="/app/contacts/new" className="text-primary underline">contato</Link> e criar o negócio.</EmptyState></Card>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
          <div className="flex min-w-max gap-3">
            {pipeline.stages.map((st) => {
              const items = deals.filter((d) => d.stage_id === st.id);
              const total = items.reduce((a, d) => a + Number(d.value_cents), 0);
              return (
                <section key={st.id} className="flex w-72 shrink-0 flex-col rounded-xl bg-surface-2 p-2" aria-label={st.name}>
                  <header className="flex items-baseline justify-between px-2 py-2">
                    <h2 className={`text-sm font-semibold ${st.kind === "won" ? "text-success" : st.kind === "lost" ? "text-danger" : ""}`}>{st.name} <span className="font-normal text-muted">{items.length}</span></h2>
                    <span className="text-xs text-muted tabular-nums">{money(total)}</span>
                  </header>
                  <ul className="space-y-2">
                    {items.map((d) => (
                      <li key={d.id}>
                        <DealCard deal={{ id: d.id, title: d.title, value: Number(d.value_cents), stageId: d.stage_id }} stages={pipeline.stages}
                          header={<><Link href={`/app/contacts/${d.contact_id}`} className="font-medium hover:underline">{d.contact_name}</Link> {d.is_demo && <DemoBadge />}</>}
                          meta={`${relative(d.last_activity_at)}${d.owner_name ? ` · ${d.owner_name}` : ""}`} />
                      </li>
                    ))}
                    {items.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted">Nenhum negócio</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
