import Link from "next/link";
import { tenant } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { createTaskAction, toggleTaskAction } from "../actions";

export const metadata = { title: "Tarefas" };

export default async function Tasks({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const sp = await searchParams;
  const showDone = sp.ver === "concluidas";
  const tasks = await tenant((db) => db.query<{ id: string; title: string; due_at: Date | null; status: string; contact_id: string | null; contact: string | null; assignee: string | null }>(
    `select t.id, t.title, t.due_at, t.status, t.contact_id, c.display_name as contact, u.full_name as assignee
     from tasks t left join contacts c on c.id = t.contact_id left join users u on u.id = t.assignee_user_id
     where t.status = $1 order by t.due_at asc nulls last, t.created_at desc limit 200`,
    [showDone ? "done" : "open"],
  ).then((r) => r.rows));
  const now = Date.now();

  return (
    <>
      <PageHeader title="Tarefas" description={<span><Link href="/app/tasks" className={!showDone ? "font-medium text-text" : "hover:underline"}>Abertas</Link> · <Link href="/app/tasks?ver=concluidas" className={showDone ? "font-medium text-text" : "hover:underline"}>Concluídas</Link></span>} />
      <Card className="mb-6 p-4">
        <ActionForm action={createTaskAction} resetOnSuccess className="flex flex-col gap-2 sm:flex-row">
          <Input name="title" required placeholder="Nova tarefa…" aria-label="Nova tarefa" />
          <Input name="dueAt" type="datetime-local" aria-label="Prazo" className="sm:w-56" />
          <SubmitButton>Adicionar</SubmitButton>
        </ActionForm>
      </Card>
      <Card>
        {tasks.length === 0 ? <EmptyState title={showDone ? "Nenhuma tarefa concluída" : "Nenhuma tarefa aberta"} /> : (
          <ul className="divide-y divide-border">
            {tasks.map((t) => {
              const overdue = t.status === "open" && t.due_at && new Date(t.due_at).getTime() < now;
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <form action={toggleTaskAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="done" value={t.status === "done" ? "0" : "1"} />
                    <button aria-label={t.status === "done" ? "Reabrir" : "Concluir"} className={`h-5 w-5 rounded border ${t.status === "done" ? "border-success bg-success" : "border-border hover:border-primary"}`} /></form>
                  <div className="min-w-0 flex-1">
                    <p className={t.status === "done" ? "text-muted line-through" : ""}>{t.title}</p>
                    {t.contact && <Link href={`/app/contacts/${t.contact_id}`} className="text-xs text-primary hover:underline">{t.contact}</Link>}
                  </div>
                  {t.due_at && <Badge tone={overdue ? "danger" : "neutral"}>{overdue ? "Atrasada · " : ""}{dateTime(t.due_at)}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
