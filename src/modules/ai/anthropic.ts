import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import type { AIProvider, AIRequest, AIResult, AIUsage } from "./provider";

/**
 * Implementação com a API da Anthropic (Claude).
 * - Saída estruturada validada por schema (output_config.format).
 * - Fallback automático do servidor caso o modelo recuse por classificador de segurança.
 * - Cache de prompt no bloco de instruções estáveis.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  constructor(readonly model = env().AI_MODEL, private readonly apiKey = env().ANTHROPIC_API_KEY) {}

  available() {
    return !!this.apiKey;
  }

  private sdk() {
    return (this.client ??= new Anthropic({ apiKey: this.apiKey, maxRetries: 2, timeout: 60_000 }));
  }

  async generate<S extends z.ZodType>(req: AIRequest<S>): Promise<AIResult<z.infer<S>>> {
    if (!this.available()) return { status: "error", message: "IA não configurada (ANTHROPIC_API_KEY ausente).", retryable: false };
    try {
      const res = await this.sdk().beta.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
      });
      const usage: AIUsage = {
        inputTokens: res.usage.input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      };
      if (res.stop_reason === "refusal") {
        return { status: "refused", model: res.model, usage, reason: res.stop_details?.explanation ?? null };
      }
      if (res.stop_reason === "max_tokens" || res.parsed_output == null) {
        return { status: "error", message: "A resposta da IA veio incompleta. Tente novamente.", retryable: true };
      }
      return { status: "ok", data: res.parsed_output as z.infer<S>, model: res.model, usage };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        return { status: "error", message: "Chave da IA inválida ou sem permissão.", retryable: false };
      }
      if (e instanceof Anthropic.BadRequestError) {
        return { status: "error", message: `Requisição recusada pela API de IA: ${e.message}`, retryable: false };
      }
      if (e instanceof Anthropic.RateLimitError) {
        return { status: "error", message: "Limite de uso da IA atingido no momento. Tente em alguns instantes.", retryable: true };
      }
      if (e instanceof Anthropic.APIConnectionError) {
        return { status: "error", message: "Não foi possível conectar ao serviço de IA.", retryable: true };
      }
      if (e instanceof Anthropic.APIError) {
        return { status: "error", message: `Serviço de IA indisponível (${e.status ?? "erro"}).`, retryable: true };
      }
      return { status: "error", message: (e as Error).message, retryable: false };
    }
  }
}

let provider: AIProvider | null = null;
export function aiProvider(): AIProvider {
  return (provider ??= new AnthropicProvider());
}
/** Permite injetar um provedor falso nos testes. */
export function setAIProvider(p: AIProvider | null) {
  provider = p;
}
