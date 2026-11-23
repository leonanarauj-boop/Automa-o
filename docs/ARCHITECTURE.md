# Arquitetura (estado atual do código)

```
src/
  app/                    Next.js App Router
    page.tsx              página pública
    login/ signup/        autenticação
    app/                  área autenticada (painel, conversas, radar, funil, contatos, tarefas, configurações)
      actions.ts          server actions (toda mutação passa por aqui → módulos de domínio)
    api/webhooks/whatsapp webhook da Meta (GET verificação, POST eventos)
  modules/                domínio, sem dependência de UI
    auth/ crm/ inbox/ radar/ dashboard/ onboarding/ demo/ audit/ jobs/
    whatsapp/             provider.ts (interface), meta-cloud.ts (adaptador), webhook.ts, rules.ts, signature.ts, channel.ts
  lib/                    db (withTenant / withService), crypto, session, env, format
  worker/                 processo de longa duração (fila de jobs)
db/migrations/            SQL versionado + db/migrate.ts
tests/unit | integration | e2e
```

## Decisões (ADRs resumidos)

**ADR-001 — Monólito modular + worker.** Um app Next.js e um processo worker. Fronteiras de domínio em `src/modules`. Extrair serviços só com necessidade real.

**ADR-002 — Postgres puro com RLS, autenticação própria (desvio do plano).** O plano previa Supabase Auth. Optamos por autenticação própria (scrypt + sessões no banco) e RLS aplicada via `SET LOCAL ROLE app_user` + `app.user_id/app.org_id` em cada transação. Motivos: o navegador nunca acessa o banco diretamente (tudo passa pelo servidor), o isolamento é testável em qualquer Postgres, e o banco continua compatível com Supabase, Neon ou RDS. Supabase segue sendo uma ótima opção de **hospedagem** do Postgres.

**ADR-003 — Fila em Postgres.** Tabela `jobs` com `FOR UPDATE SKIP LOCKED`, backoff exponencial e recuperação de jobs travados. O enfileiramento de envio usa uma função `SECURITY DEFINER` que valida o tenant. Migrar para Redis/serviço gerenciado quando passar de ~50 jobs/s.

**ADR-004 — Webhook "burro".** Valida assinatura, grava o corpo bruto em `webhook_events` (deduplicado por hash), enfileira e responde 200. Todo processamento é no worker e é idempotente (`provider_message_id` único, status só avança).

**ADR-005 — Camada de canal.** `ChannelProvider` isola a Meta Cloud API; testes usam um provedor falso. Outro BSP ou canal entra como novo adaptador.

**ADR-006 — Radar explicável.** Regras puras em `radar/rules.ts` (testáveis), um sinal por contato (o mais urgente), valor sempre com `value_basis` (`deal_value`, `avg_ticket`, `unknown`). Receita recuperada só via negócio ganho com sinal aberto.

## Dois caminhos de acesso ao banco
- `withTenant(ctx, fn)`: requisições de usuário. Papel `app_user`, sujeito a RLS. **Padrão.**
- `withService(fn)`: cadastro, login, webhooks, worker, conexão de canal. Ignora RLS; toda consulta filtra `organization_id` explicitamente. Uso deve ser revisado com atenção.

**ADR-007 — Consistência da agenda no banco.** Conflitos de horário são impedidos por uma restrição de exclusão (`btree_gist` + `tstzrange`), não por verificação na aplicação, porque só o banco garante a regra sob concorrência. A aplicação traduz o erro `23P01` em "horário acabou de ser ocupado".
