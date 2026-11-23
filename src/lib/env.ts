import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY é obrigatório"),
  META_APP_SECRET: z.string().optional().default(""),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  META_GRAPH_VERSION: z.string().default("v23.0"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  ASAAS_API_KEY: z.string().optional().default(""),
  ASAAS_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  ASAAS_WEBHOOK_TOKEN: z.string().optional().default(""),
  SMTP_URL: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("Retoma <nao-responda@localhost>"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Lê e valida variáveis de ambiente no servidor. Nunca importar em componentes de cliente. */
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function resetEnvCache() {
  cached = null;
}
