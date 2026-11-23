import Link from "next/link";
import { notFound } from "next/navigation";
import { tenant } from "@/lib/session";
import { definitionSchema, STEP_LABEL, type Step } from "@/modules/automations/definition";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { Builder } from "../builder";
import { cancelRunAction, duplicateAction, reprocessAction, setStatusAction } from "../actions";

const RUN: Record<string, { label: string; tone: "neutral" | "primary" | "money" | "success" | "danger" }> = {
  running: { label: "Executando", tone: "primary" }, waiting: { label: "Aguardando", tone: "primary" }, succeeded: { label: "Concluída", tone: "success" },
  stopped: { label: "Parou na condição", tone: "neutral" }, failed: { label: "Falhou", tone: "danger" }, canceled: { label: "Cancelada", tone: "neutral" },
};

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tenant(async (db, s) => {
    const a = (await db.query<{ id: string; name: string; status: string; version: number; definition: unknown }>(
      "select a.id, a.name, a.status, v.version, v.definition from automations a join automation_versions v on v.id = a.current_version_id where a.id = $1", [id])).rows[0];
    if (!a) return null;
    const runs = (await db.query<{ id: string; status: string; contact: string | null; contact_id: string | null; started_at: Date; finished_at: Date | null; resume_at: Date; error: string | null; version: number }>(
      `select r.id, r.status, c.display_name as contact, r.contact_id, r.started_at, r.finished_at, r.resume_at, r.error, v.version
       from workflow_runs r left join contacts c on c.id = r.contact_id join automation_versions v on v.id = r.version_id
       where r.automation_id = $1 order by r.started_at desc limit 50`, [id])).rows;
    const steps = runs.length ? (await db.query<{ run_id: string; step_index: number; step_type: Step["type"]; status: string; detail: string | null; created_at: Date }>(
      "select run_id, step_index, step_type, status, detail, created_at from workflow_run_steps where run_id = any($1) order by id", [runs.map((r) => r.id)])).rows : [];
    return {
      a, runs, steps, role: s.role,
      o: {
        tags: (await db.query<{ id: string; name: string }>("select id, name from tags order by name")).rows,
        stages: (await db.query<{ id: string; name: string }>("select s.id, s.name from pipeline_stages s join pipelines p on p.id = s.pipeline_id and p.is_default order by s.position")).rows,
        members: (await db.query<{ id: string; name: string }>("select u.id, u.full_name as name from memberships m join users u on u.id = m.user_id where m.status = 'active' order by u.full_name")).rows,
        templates: (await db.query<{ id: string; name: string; category: string; body_param_count: number }>("select id, name, category, body_param_count from message_templates where status = 'APPROVED' order by name")).rows,
        contacts: (await db.query<{ id: string; name: string }>("select id, display_name as name from contacts where deleted_at is null order by greatest(last_inbound_at, last_outbound_at, created_at) desc limit 100")).rows,
      },
    };
  });
  if (!d) notFound();
  const manager = d.role !== "agent";
  const def = definitionSchema.parse(d.a.definition);

  return (
    <>
      <PageHeader title={d.a.name}
        description={<span className="flex flex-wrap items-center gap-2"><Link href="/app/automations" className="hover:underline">← Automações</Link><Badge tone={d.a.status === "active" ? "success" : d.a.status === "paused" ? "money" : "neutral"}>{d.a.status === "active" ? "Ativa" : d.a.status === "paused" ? "Pausada" : "Rascunho"}</Badge><span>versão {d.a.version}</span></span>}
        action={manager ? <div className="flex gap-2">
          <ActionForm action={duplicateAction}><input type="hidden" name="id" value={d.a.id} /><SubmitButton size="sm" variant="ghost">Duplicar</SubmitButton></ActionForm>
          <ActionForm action={setStatusAction}><input type="hidden" name="id" value={d.a.id} /><input type="hidden" name="status" value={d.a.status === "active" ? "paused" : "active"} />
            <SubmitButton size="sm" variant={d.a.status === "active" ? "secondary" : "primary"}>{d.a.status === "active" ? "Pausar" : "Ativar"}</SubmitButton></ActionForm>
        </div> : undefined} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card className="p-5"><Builder id={d.a.id} name={d.a.name} initial={def} o={d.o} canEdit={manager} key={d.a.version} /></Card>
        <Card className="h-fit">
          <CardHeader title="Histórico de execuções" description="Últimas 50. Falhas podem ser reprocessadas a partir do passo que falhou." />
          {d.runs.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nenhuma execução ainda.</p> : (
            <ul className="divide-y divide-border text-sm">
              {d.runs.map((r) => (
                <li key={r.id} className="space-y-1.5 px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>{r.contact_id ? <Link href={`/app/contacts/${r.contact_id}`} className="font-medium hover:underline">{r.contact}</Link> : "—"} <span className="text-xs text-muted">· v{r.version} · {dateTime(r.started_at)}</span></span>
                    <Badge tone={RUN[r.status].tone}>{RUN[r.status].label}</Badge>
                  </div>
                  {r.status === "waiting" && <p className="text-xs text-muted">Continua em {dateTime(r.resume_at)}</p>}
                  {r.error && <p className="text-xs text-danger">{r.error}</p>}
                  <ol className="space-y-0.5 text-xs text-muted">
                    {d.steps.filter((s) => s.run_id === r.id).map((s, i) => <li key={i}>{s.step_index + 1}. {STEP_LABEL[s.step_type]} — <span className={s.status === "failed" ? "text-danger" : ""}>{s.detail}</span></li>)}
                  </ol>
                  {manager && r.status === "failed" && <form action={reprocessAction}><input type="hidden" name="runId" value={r.id} /><input type="hidden" name="automationId" value={d.a.id} /><button className="text-xs font-medium text-primary hover:underline">Reprocessar</button></form>}
                  {manager && (r.status === "waiting" || r.status === "running") && <form action={cancelRunAction}><input type="hidden" name="runId" value={r.id} /><input type="hidden" name="automationId" value={d.a.id} /><button className="text-xs text-muted hover:text-text">Cancelar execução</button></form>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
