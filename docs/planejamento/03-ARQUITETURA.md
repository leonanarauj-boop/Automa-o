# Arquitetura Técnica Recomendada (proposta)

## Visão de componentes

```
                    ┌──────────────────────┐
  Visitante ───────▶│ apps/site (Next.js)  │  SSG/ISR, SEO, ferramentas gratuitas
                    └──────────────────────┘
                    ┌──────────────────────┐        ┌───────────────────────┐
  Usuário ─────────▶│ apps/web (Next.js)   │◀──────▶│ Supabase              │
  (navegador/PWA)   │ UI + Route Handlers  │  RLS   │ Postgres + pgvector   │
                    │ (API autenticada)    │        │ Auth · Storage ·      │
                    └─────────┬────────────┘        │ Realtime · Vault      │
                              │ enfileira           └──────────▲────────────┘
  Meta (webhooks) ──▶ /api/webhooks/whatsapp ──grava evento──┘ │
                              │                                │
                    ┌─────────▼────────────┐                   │
                    │ apps/worker (Node)   │───────────────────┘
                    │ filas em Postgres    │──▶ Meta Cloud API (envio)
                    │ IA · automações ·    │──▶ Provedores de IA (via camada própria)
                    │ Radar · lembretes    │──▶ Gateway de pagamento · E-mail · Google
                    └──────────────────────┘
```

## Estrutura do monorepo
```
apps/
  site/        # site público (SEO)
  web/         # aplicação autenticada + API
  worker/      # processamento assíncrono
packages/
  domain/      # regras de negócio puras por módulo (crm, inbox, radar, agenda, automations, billing)
  db/          # schema, migrations, tipos gerados, políticas RLS, seeds (demo marcado)
  channels/    # interface ChannelProvider + adaptador meta-cloud
  ai/          # interface AIProvider, prompts versionados, avaliações, medição de custo
  ui/          # design system
  config/      # tsconfig, eslint, limites de plano
docs/
```

## Decisões-chave e justificativas

1. **Monólito modular + worker.** Um time pequeno não deve operar microserviços. Fronteiras de módulo ficam em `packages/domain`, permitindo extrair serviços no futuro.
2. **Filas em Postgres (Graphile Worker/pg-boss) no MVP.** Transacional com os dados (enfileirar na mesma transação), sem novo serviço. Gatilho para migrar para Redis/BullMQ ou serviço gerenciado: > ~50 jobs/s sustentados ou latência de fila > 2 s p95.
3. **Webhook: validar → gravar → enfileirar → 200.** Meta reenvia em caso de erro/lentidão; processar dentro do request causaria duplicidade e timeouts.
4. **Idempotência em três camadas:** id do evento da Meta (UNIQUE), `idempotency_key` em envios, `(automation_version_id, trigger_event_id)` em execuções.
5. **Camada `ChannelProvider`:** `sendMessage`, `sendTemplate`, `parseWebhook`, `downloadMedia`, `syncTemplates`. O domínio só conhece mensagens normalizadas.
6. **Camada `AIProvider`:** `complete`, `extract(schema)`, `embed`. Cada chamada registra provedor, modelo, tokens, custo e latência em `ai_calls`, e consome créditos do plano **antes** de executar (reserva) para impedir consumo sem controle.
7. **Guardrails da IA:**
   - prompt de sistema com escopo fechado no negócio do cliente;
   - preços/condições só podem vir de `products_services` ou trechos recuperados, com citação;
   - verificação pós-geração: todo valor monetário na resposta precisa existir na fonte, senão a resposta é bloqueada e vira encaminhamento humano;
   - conjunto de avaliação versionado rodado no CI ao mudar prompts/modelos.
8. **Realtime** só para notificar a UI; a fonte de verdade é sempre a consulta ao banco.
9. **Segredos:** tokens da Meta, chaves de gateway e de IA ficam no cofre (Vault/KMS); variáveis de ambiente só no servidor; nada com prefixo público (`NEXT_PUBLIC_`) além de URL e chave anônima do Supabase.
10. **Rate limiting** por IP e por organização nas rotas públicas e de envio; limites do plano aplicados no serviço de domínio.
11. **Observabilidade:** logs JSON com `organization_id`, `request_id`, `job_id`; Sentry em web e worker; painel de saúde por org (webhooks falhos, mensagens não entregues, automações com erro).
12. **Ambientes:** dev local (Supabase CLI), staging (número de teste da Meta), produção. Deploy em produção **somente com sua autorização**.

## Estratégia de testes
| Tipo | Ferramenta | Foco |
|---|---|---|
| Unitário | Vitest | Regras de domínio (janela 24h, Radar, score, limites) |
| Integração | Vitest + Postgres real (Supabase local) | RLS, transações, constraint de agenda, idempotência |
| Isolamento multi-tenant | Suíte gerada automaticamente para todas as tabelas | Usuário da org A nunca lê/escreve dado da org B |
| Webhooks | Fixtures com payloads da documentação oficial | Duplicatas, fora de ordem, assinatura inválida |
| IA | Conjunto de avaliação | Zero preço inventado, encaminhamento correto, custo |
| E2E | Playwright | Onboarding, conversa, pipeline, agendamento, cobrança (sandbox) |
| Segurança | Secret scanning, dependências, revisão de RLS, pentest pré-lançamento | |
