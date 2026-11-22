import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { withService } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { verifyMetaSignature } from "@/modules/whatsapp/signature";
import { enqueue } from "@/modules/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificação do webhook pela Meta (hub.mode / hub.verify_token / hub.challenge). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = env().META_WEBHOOK_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * Recebimento de eventos: valida assinatura → grava evento bruto (idempotente) → enfileira → 200.
 * Nenhum processamento pesado acontece aqui.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return new NextResponse("payload too large", { status: 413 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env().META_APP_SECRET)) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new NextResponse("invalid json", { status: 400 }); }

  await withService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into webhook_events (provider, dedupe_key, payload) values ('meta_cloud', $1, $2)
       on conflict (provider, dedupe_key) do nothing returning id`,
      [sha256(raw), raw],
    );
    if (r.rowCount) await enqueue(db, "whatsapp.webhook", { eventId: r.rows[0].id });
  });
  return NextResponse.json({ ok: true });
}
