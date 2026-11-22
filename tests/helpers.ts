import { loadEnvFile } from "node:process";
import { Client } from "pg";
import { createHmac, randomBytes } from "node:crypto";

try { loadEnvFile(); } catch { /* ok */ }

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://retoma:retoma@localhost:5432/retoma_test";
process.env.DATABASE_URL = TEST_DB;
process.env.ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
process.env.META_APP_SECRET = "test-app-secret";
process.env.META_WEBHOOK_VERIFY_TOKEN = "test-verify-token";

/** Recria o schema do banco de testes do zero e aplica as migrations. */
export async function resetDb() {
  const c = new Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query("drop schema if exists public cascade; create schema public;");
  await c.end();
  const { migrate } = await import("../db/migrate");
  await migrate(TEST_DB, () => {});
}

export function sign(body: string, secret = "test-app-secret") {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export function inboundPayload(opts: { phoneNumberId: string; from: string; id: string; text: string; name?: string; ts?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA_ID",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550000000", phone_number_id: opts.phoneNumberId },
          contacts: [{ profile: { name: opts.name ?? "Cliente Teste" }, wa_id: opts.from }],
          messages: [{ from: opts.from, id: opts.id, timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)), type: "text", text: { body: opts.text } }],
        },
      }],
    }],
  };
}

export function statusPayload(opts: { phoneNumberId: string; id: string; status: string; ts?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550000000", phone_number_id: opts.phoneNumberId },
      statuses: [{ id: opts.id, status: opts.status, timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)), recipient_id: "5511999999999" }],
    } }] }],
  };
}
