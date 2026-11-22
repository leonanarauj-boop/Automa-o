import type { z } from "zod";

/**
 * Camada de provedor de IA. O domínio só conhece esta interface; trocar de provedor ou de modelo
 * não altera o restante do código. Toda chamada devolve uso de tokens para controle de custo.
 */
export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AIRequest<S extends z.ZodType> {
  /** Instruções estáveis (cacheáveis) — mesma ordem e conteúdo entre chamadas da mesma org. */
  system: string;
  /** Conteúdo variável da chamada (conversa, trechos recuperados, tarefa). */
  user: string;
  schema: S;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}

export type AIResult<T> =
  | { status: "ok"; data: T; model: string; usage: AIUsage }
  | { status: "refused"; model: string; usage: AIUsage; reason: string | null }
  | { status: "error"; message: string; retryable: boolean };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  available(): boolean;
  generate<S extends z.ZodType>(req: AIRequest<S>): Promise<AIResult<z.infer<S>>>;
}

/** Preços em USD por milhão de tokens (input, output, leitura de cache). Atualize conforme a tabela oficial. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Custo estimado em micro-dólares (USD × 1.000.000). Escrita de cache ≈ 1,25 × input. */
export function estimateCostMicros(model: string, u: AIUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const usd = (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output) / 1_000_000;
  return Math.round(usd * 1_000_000);
}
