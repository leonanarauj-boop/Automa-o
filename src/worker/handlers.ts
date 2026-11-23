import { withService } from "@/lib/db";
import { claimJobs, completeJob, failJob, enqueue, type Job } from "@/modules/jobs/queue";
import { processWebhookEvent } from "@/modules/inbox/inbound";
import { performSend } from "@/modules/inbox/outbound";
import { refreshRadar } from "@/modules/radar/service";
import { ProviderError } from "@/modules/whatsapp/provider";
import { sendDueReminders } from "@/modules/agenda/reminders";

async function handle(job: Job) {
  switch (job.type) {
    case "whatsapp.webhook":
      await withService((db) => processWebhookEvent(db, String(job.payload.eventId)));
      return;
    case "whatsapp.send":
      await withService((db) =>
        performSend(db, String(job.payload.messageId), String(job.payload.orgId), { lastAttempt: job.attempts >= job.max_attempts }),
      );
      return;
    case "radar.refresh_all": {
      const orgs = await withService((db) => db.query<{ id: string }>("select id from organizations where status in ('trial','active')"));
      for (const o of orgs.rows) await withService((db) => refreshRadar(db, o.id));
      return;
    }
    case "appointments.reminders":
      await withService((db) => sendDueReminders(db));
      return;
    default:
      throw new ProviderError(`tipo de job desconhecido: ${job.type}`, false);
  }
}

/** Processa um lote de jobs. Retorna quantos foram processados. */
export async function runOnce(limit = 10): Promise<number> {
  const jobs = await withService((db) => claimJobs(db, limit));
  for (const job of jobs) {
    try {
      await handle(job);
      await withService((db) => completeJob(db, job.id));
    } catch (e) {
      const retryable = e instanceof ProviderError ? e.retryable : true;
      const gaveUp = await withService((db) => failJob(db, job, (e as Error).message, retryable));
      console.error(JSON.stringify({ level: "error", msg: "job falhou", jobId: job.id, type: job.type, gaveUp, error: (e as Error).message }));
      if (job.type === "whatsapp.webhook" && gaveUp) {
        await withService((db) => db.query("update webhook_events set error = $2 where id = $1", [job.payload.eventId, (e as Error).message]));
      }
    }
  }
  return jobs.length;
}

/** Agenda um job periódico se não houver um pendente do mesmo tipo. */
export async function schedulePeriodic(type: "radar.refresh_all" | "appointments.reminders") {
  await withService(async (db) => {
    const pending = await db.query("select 1 from jobs where type = $1 and status in ('queued','running') limit 1", [type]);
    if (!pending.rowCount) await enqueue(db, type, {});
  });
}
export const scheduleRadar = () => schedulePeriodic("radar.refresh_all");
