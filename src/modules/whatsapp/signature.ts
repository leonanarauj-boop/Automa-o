import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica o cabeçalho X-Hub-Signature-256 enviado pela Meta: "sha256=" + HMAC-SHA256(app_secret, corpo bruto).
 * Precisa do corpo EXATO recebido (antes de qualquer parse JSON).
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = header.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}
