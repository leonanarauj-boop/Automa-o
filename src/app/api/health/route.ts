import { NextResponse } from "next/server";
import { withService } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verificação de saúde para monitores externos (UptimeRobot, Better Stack…).
 * 200 = banco acessível e worker ativo nos últimos 2 minutos; 503 caso contrário.
 * Não expõe dados de clientes nem detalhes de configuração.
 */
export async function GET() {
  try {
    const r = await withService((db) => db.query<{ worker: Date | null; queued: string }>(
      `select (select max(last_seen_at) from worker_heartbeats) worker,
              (select count(*) from jobs where status = 'queued' and run_at < now() - interval '5 minutes') queued`));
    const workerOk = !!r.rows[0].worker && Date.now() - new Date(r.rows[0].worker).getTime() < 120_000;
    const body = { status: workerOk ? "ok" : "degraded", database: "ok", worker: workerOk ? "ok" : "sem sinal", lateJobs: Number(r.rows[0].queued) };
    return NextResponse.json(body, { status: workerOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "down", database: "erro" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
