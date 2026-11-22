/**
 * Verificações determinísticas sobre o texto gerado pela IA, ANTES de mostrá-lo à equipe.
 * Regra central do produto: a IA nunca pode inventar preços ou condições comerciais.
 */

/** Extrai valores monetários em reais, normalizados para centavos. */
export function extractMoney(text: string): number[] {
  const out: number[] = [];
  const re = /R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?|(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s?(?:reais|real)\b/gi;
  for (const m of text.matchAll(re)) {
    const int = (m[1] ?? m[3]).replace(/\./g, "");
    const dec = (m[2] ?? m[4] ?? "0").padEnd(2, "0");
    out.push(Number(int) * 100 + Number(dec));
  }
  return out;
}

/** Extrai percentuais (descontos, juros, entradas). */
export function extractPercents(text: string): number[] {
  return [...text.matchAll(/(\d{1,3}(?:,\d{1,2})?)\s?%/g)].map((m) => Number(m[1].replace(",", ".")));
}

/** Extrai números de parcelas ("10x", "em 12 vezes"). */
export function extractInstallments(text: string): number[] {
  return [...text.matchAll(/\b(\d{1,2})\s?(?:x\b|vezes\b)/gi)].map((m) => Number(m[1]));
}

export interface GuardrailResult {
  ok: boolean;
  violations: string[];
}

/**
 * Todo valor, percentual ou número de parcelas citado na resposta precisa aparecer nas fontes
 * autorizadas (catálogo, base de conhecimento enviada, políticas ou a própria conversa).
 */
export function checkCommercialFacts(reply: string, sources: { text: string; pricesCents: number[] }): GuardrailResult {
  const allowedMoney = new Set([...sources.pricesCents, ...extractMoney(sources.text)]);
  const allowedPct = new Set(extractPercents(sources.text));
  const allowedInst = new Set(extractInstallments(sources.text));
  const violations: string[] = [];
  for (const v of extractMoney(reply)) {
    if (!allowedMoney.has(v)) violations.push(`valor R$ ${(v / 100).toFixed(2).replace(".", ",")} não consta no catálogo nem na base de conhecimento`);
  }
  for (const p of extractPercents(reply)) {
    if (!allowedPct.has(p)) violations.push(`percentual ${String(p).replace(".", ",")}% não consta nas políticas cadastradas`);
  }
  for (const n of extractInstallments(reply)) {
    if (!allowedInst.has(n)) violations.push(`parcelamento em ${n}x não consta nas condições cadastradas`);
  }
  return { ok: violations.length === 0, violations };
}
