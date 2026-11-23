import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { withService } from "@/lib/db";
import { enqueue } from "@/modules/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameToken(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook do Asaas: autenticado pelo cabeçalho asaas-access-token (token configurado no webhook).
 * Grava o evento (idempotente pelo id "evt_...") e enfileira o processamento; responde 200 rápido.
 */
export async function POST(req: NextRequest) {
  if (!sameToken(req.headers.get("asaas-access-token"), env().ASAAS_WEBHOOK_TOKEN)) return new NextResponse("unauthorized", { status: 401 });
  const raw = await req.text();
  if (raw.length > 500_000) return new NextResponse("payload too large", { status: 413 });
  let body: { id?: string; event?: string };
  try { body = JSON.parse(raw); } catch { return new NextResponse("invalid json", { status: 400 }); }
  if (!body.id || !body.event) return new NextResponse("missing id/event", { status: 400 });
  await withService(async (db) => {
    const r = await db.query("insert into billing_events (id, type, payload) values ($1,$2,$3) on conflict (id) do nothing", [String(body.id).slice(0, 200), String(body.event).slice(0, 100), raw]);
    if (r.rowCount) await enqueue(db, "billing.event", { eventId: String(body.id).slice(0, 200) });
  });
  return NextResponse.json({ received: true });
}
