import type { Db } from "@/lib/db";

export interface Job {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Fila simples em Postgres (FOR UPDATE SKIP LOCKED). Transacional com os dados de negócio. */
export async function enqueue(db: Db, type: string, payload: Record<string, unknown>, runAt?: Date) {
  await db.query("insert into jobs (type, payload, run_at) values ($1, $2, coalesce($3, now()))", [
    type, JSON.stringify(payload), runAt ?? null,
  ]);
}

export async function claimJobs(db: Db, limit = 10): Promise<Job[]> {
  // Recupera jobs travados (worker morreu no meio do processamento)
  await db.query(
    "update jobs set status = 'queued', locked_at = null where status = 'running' and locked_at < now() - interval '5 minutes'",
  );
  const r = await db.query<Job>(
    `update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
     where id in (
       select id from jobs where status = 'queued' and run_at <= now()
       order by run_at limit $1 for update skip locked
     ) returning id, type, payload, attempts, max_attempts`,
    [limit],
  );
  return r.rows;
}

export async function completeJob(db: Db, id: number) {
  await db.query("update jobs set status = 'done', locked_at = null, last_error = null where id = $1", [id]);
}

/** Backoff exponencial: 10s, 20s, 40s... até max_attempts; depois falha definitiva. */
export async function failJob(db: Db, job: Job, error: string, retryable: boolean) {
  const giveUp = !retryable || job.attempts >= job.max_attempts;
  await db.query(
    `update jobs set status = $2, locked_at = null, last_error = $3,
       run_at = now() + ($4 || ' seconds')::interval where id = $1`,
    [job.id, giveUp ? "failed" : "queued", error.slice(0, 2000), String(10 * 2 ** (job.attempts - 1))],
  );
  return giveUp;
}
