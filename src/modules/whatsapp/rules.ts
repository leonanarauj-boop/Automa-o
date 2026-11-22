/** Regras de negócio do WhatsApp aplicadas no código (independentes de provedor). */

export const SERVICE_WINDOW_HOURS = 24;

/** Janela de atendimento: aberta até 24h após a última mensagem recebida do cliente. */
export function serviceWindowExpiry(lastInbound: Date): Date {
  return new Date(lastInbound.getTime() + SERVICE_WINDOW_HOURS * 3600 * 1000);
}

export function isWindowOpen(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() > now.getTime();
}

const OPT_OUT = new Set(["sair", "parar", "pare", "stop", "cancelar", "descadastrar", "nao quero mais receber"]);
const OPT_IN = new Set(["voltar", "aceito", "quero receber", "start"]);

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[.!]+$/, "");
}

/** Mensagem curta que pede descadastramento (ex.: "SAIR", "Parar!"). */
export function isOptOutMessage(text: string | null): boolean {
  return !!text && OPT_OUT.has(normalize(text));
}

export function isOptInMessage(text: string | null): boolean {
  return !!text && OPT_IN.has(normalize(text));
}

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * Webhooks de status podem chegar fora de ordem. Só avançamos o status (sent → delivered → read);
 * "failed" sempre prevalece.
 */
export function shouldApplyStatus(current: string, incoming: string): boolean {
  if (!(incoming in STATUS_RANK)) return false;
  if (current === "failed") return false;
  if (incoming === "failed") return true;
  return STATUS_RANK[incoming] > (STATUS_RANK[current] ?? -1);
}

/** Converte telefone brasileiro digitado para E.164 sem "+", no formato usado pelo wa_id. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d; // DDD + número
  if (d.length < 12 || d.length > 15) return null;
  return d;
}

/** Conta variáveis {{1}}, {{2}}... no corpo de um template. */
export function countTemplateParams(body: string | null | undefined): number {
  if (!body) return 0;
  const nums = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}
