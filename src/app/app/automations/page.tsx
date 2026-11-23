import Link from "next/link";
import { tenant } from "@/lib/session";
import { RECIPES, TRIGGER_LABEL, type Trigger } from "@/modules/automations/definition";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { createFromRecipeAction } from "./actions";

export const metadata = { title: "Automações" };

export default async function Automations() {
  const d = await tenant(async (db, s) => ({
    role: s.role,
    list: (await db.query<{ id: string; name: string; status: string; trigger_type: Trigger["type"]; version: number; ok: string; failed: string; waiting: string }>(
      `select a.id, a.name, a.status, a.trigger_type, v.version,
         (select count(*) from workflow_runs r where r.automation_id = a.id and r.status = 'succeeded' and r.started_at > now() - interval '7 days') ok,
         (select count(*) from workflow_runs r where r.automation_id = a.id and r.status = 'failed') failed,
         (select count(*) from workflow_runs r where r.automation_id = a.id and r.status in ('running','waiting')) waiting
       from automations a left join automation_versions v on v.id = a.current_version_id order by a.created_at desc`)).rows,
  }));
  const manager = d.role !== "agent";
  return (
    <>
      <PageHeader title="Automações" description="Regras que trabalham sozinhas: quando algo acontece, o sistema executa os passos que você definir." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          {d.list.length === 0 ? <EmptyState title="Nenhuma automação ainda">Comece por um modelo ao lado e ajuste do seu jeito.</EmptyState> : (
            <ul className="divide-y divide-border">
              {d.list.map((a) => (
                <li key={a.id}>
                  <Link href={`/app/automations/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2">
                    <span><span className="font-medium">{a.name}</span><span className="block text-xs text-muted">{TRIGGER_LABEL[a.trigger_type]} · versão {a.version}</span></span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-muted">{a.ok} concluídas (7 dias) · {a.waiting} em andamento</span>
                      {Number(a.failed) > 0 && <Badge tone="danger">{a.failed} com falha</Badge>}
                      <Badge tone={a.status === "active" ? "success" : a.status === "paused" ? "money" : "neutral"}>{a.status === "active" ? "Ativa" : a.status === "paused" ? "Pausada" : "Rascunho"}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Modelos prontos" description="Criados como rascunho: revise e ative." />
          <ul className="divide-y divide-border">
            {RECIPES.map((r) => (
              <li key={r.key} className="space-y-2 px-5 py-4">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted">{r.description}</p>
                {manager && <ActionForm action={createFromRecipeAction}><input type="hidden" name="recipe" value={r.key} /><SubmitButton size="sm" variant="secondary" pendingText="Criando…">Usar modelo</SubmitButton></ActionForm>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
