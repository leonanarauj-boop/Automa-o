/**
 * Teste de fumaça com a API REAL da Anthropic (gasta 2 chamadas pequenas).
 * Uso: ANTHROPIC_API_KEY=... npm run ai:smoke
 * Valida: autenticação, saída estruturada, fallback de servidor, guardrail e custo estimado.
 */
import { loadEnvFile } from "node:process";
try { loadEnvFile(); } catch { /* variáveis do ambiente */ }

async function main() {
  const { AnthropicProvider } = await import("@/modules/ai/anthropic");
  const { buildStableSystem, replySchema, analysisSchema } = await import("@/modules/ai/copilot");
  const { checkCommercialFacts } = await import("@/modules/ai/guardrails");
  const { estimateCostMicros } = await import("@/modules/ai/provider");
  const provider = new AnthropicProvider();
  if (!provider.available()) { console.error("Defina ANTHROPIC_API_KEY para rodar este teste."); process.exit(1); }

  const ctx = {
    orgName: "Clínica Exemplo (teste)", segment: "clinica",
    agent: { name: "Bia", tone: "acolhedor", formality: "neutral" as const, businessDescription: "Clínica odontológica de teste.", businessHours: "Seg a sex, 8h às 18h", policies: "Parcelamos em até 10x sem juros no cartão.", handoffRules: "Reclamações e pedidos de desconto", forbiddenTopics: "Diagnósticos" },
    catalog: [{ id: "1", name: "Clareamento", description: null, price_cents: "80000", price_type: "fixed", duration_min: 60 }, { id: "2", name: "Implante", description: null, price_cents: null, price_type: "on_request", duration_min: null }],
  };
  const user = `<conhecimento>\n(nenhum trecho)\n</conhecimento>\n\n<conversa>\n[22/11 10:00] Cliente: Oi! Quanto custa o clareamento? E o implante? Dá pra parcelar?\n</conversa>\n\nEscreva a sugestão de resposta para a última mensagem do cliente.`;

  for (const [role, schema] of [["reply", replySchema], ["analysis", analysisSchema]] as const) {
    const t = Date.now();
    const res = await provider.generate({ system: buildStableSystem(ctx, role), user, schema: schema as never, effort: role === "reply" ? "medium" : "low", maxTokens: 3000 });
    console.log(`\n=== ${role} (${Date.now() - t} ms) ===`);
    if (res.status !== "ok") { console.log(res); process.exitCode = 1; continue; }
    console.log(JSON.stringify(res.data, null, 2));
    console.log("modelo:", res.model, "| tokens:", res.usage, "| custo estimado US$", ((estimateCostMicros(res.model, res.usage) ?? 0) / 1e6).toFixed(5));
    if (role === "reply") {
      const g = checkCommercialFacts((res.data as { reply: string }).reply, { text: ctx.agent.policies, pricesCents: [80000] });
      console.log("guardrail:", g.ok ? "ok" : g.violations);
    }
  }
}
main();
