# Modelo Inicial de Dados (proposta)

> PostgreSQL. Este é o desenho lógico para aprovação; as migrations reais serão escritas na Fase 2.

## Princípios
1. **Toda tabela de dado de cliente tem `organization_id NOT NULL`** com FK para `organizations` e política RLS `organization_id = ANY(auth_org_ids())`. A função `auth_org_ids()` lê as memberships ativas do usuário autenticado.
2. **Chaves primárias UUID v7** (ordenáveis por tempo, boas para índices).
3. **`created_at`, `updated_at`** em todas as tabelas; **soft delete (`deleted_at`)** só onde há necessidade de recuperação ou auditoria (contatos, deals).
4. **Índices compostos começam por `organization_id`**.
5. **Valores monetários em `bigint` de centavos + `currency char(3)`** — nunca `float`.
6. **Dados sensíveis** (documentos, observações de saúde) em colunas criptografadas no nível da aplicação (envelope encryption) quando o segmento exigir.
7. **Eventos e logs volumosos** (mensagens, webhook_events, usage_records, audit_logs) particionáveis por mês quando o volume justificar.
8. **Service role** (que ignora RLS) é usada **somente** no worker e em rotas server-side específicas, nunca no navegador.

## Diagrama de relacionamentos (resumo)

```
organizations ─┬─ memberships ── users (auth)
               ├─ roles ── role_permissions
               ├─ channel_accounts (WABA / número) ── message_templates
               ├─ contacts ─┬─ contact_identities (wa_id, e-mail, instagram…)
               │            ├─ consent_records
               │            ├─ contact_tags ── tags
               │            ├─ custom_field_values ── custom_field_definitions
               │            └─ conversations ── messages ── message_attachments
               ├─ pipelines ── pipeline_stages
               ├─ deals (contact, stage, owner, valor) ── deal_stage_history
               ├─ tasks
               ├─ ai_suggestions (para contato / deal / conversa)
               ├─ opportunity_signals (Radar)
               ├─ services / professionals / availability_rules / appointments
               ├─ automations ── automation_versions ── workflow_runs ── workflow_steps
               ├─ campaigns ── campaign_recipients
               ├─ ai_agents ── knowledge_documents ── knowledge_chunks (pgvector)
               ├─ ai_calls (log de custo/qualidade)
               ├─ subscriptions ── plans (global) ; usage_records
               ├─ integrations (credenciais criptografadas)
               └─ audit_logs
webhook_events (global, resolvido para org no processamento)
```

## Tabelas

### Identidade e acesso
| Tabela | Colunas principais | Observações |
|---|---|---|
| `organizations` | id, name, slug, segment, timezone, locale, plan_id, status (trial/active/past_due/suspended/canceled), trial_ends_at, settings jsonb | `settings` só para preferências não consultadas em filtros |
| `users` | (Supabase `auth.users`) + `profiles`: id, full_name, avatar_url | Um usuário pode pertencer a várias orgs |
| `memberships` | id, organization_id, user_id, role_id, status (invited/active/disabled), invited_by | UNIQUE (organization_id, user_id) |
| `roles` | id, organization_id (NULL = papel de sistema), key, name | Papéis de sistema: owner, manager, agent, viewer |
| `role_permissions` | role_id, permission (ex.: `contacts.export`, `deals.delete`, `ai.autonomy.configure`) | Permissões como strings versionadas no código |
| `platform_admins` | user_id, level, mfa_required | Separado das orgs; acesso a dados de cliente só via fluxo auditado |

### Canais e mensagens
| Tabela | Colunas principais | Observações |
|---|---|---|
| `channel_accounts` | id, organization_id, provider (`meta_cloud`), waba_id, phone_number_id, display_phone, quality_rating, messaging_limit_tier, status, access_token_ref | Token no cofre de segredos (Supabase Vault/KMS), aqui apenas a referência. UNIQUE(phone_number_id) |
| `message_templates` | id, organization_id, channel_account_id, name, language, category, status, components jsonb, provider_template_id | Sincronizado com a Meta |
| `contacts` | id, organization_id, display_name, phone_e164, email, company, source, owner_user_id, temperature, intent_score, last_inbound_at, last_outbound_at, summary (memória comercial), is_demo, deleted_at | `is_demo` marca dado de demonstração. UNIQUE parcial (organization_id, phone_e164) |
| `contact_identities` | id, organization_id, contact_id, channel, external_id (wa_id) | Permite multicanal sem duplicar contato. UNIQUE(organization_id, channel, external_id) |
| `consent_records` | id, organization_id, contact_id, channel, purpose (service/marketing), status (granted/revoked), source, evidence, recorded_at, recorded_by | **Append-only**: nunca update; o estado atual é o último registro |
| `conversations` | id, organization_id, contact_id, channel_account_id, status (open/pending/closed), assignee_user_id, queue_id, priority, service_window_expires_at, last_message_at, ai_mode | Índice (organization_id, status, last_message_at desc) |
| `messages` | id, organization_id, conversation_id, direction, sender_type (contact/user/ai/system), sender_user_id, type, body, payload jsonb, provider_message_id, status (pending/sent/delivered/read/failed), error_code, idempotency_key, template_id, cost_category, created_at | UNIQUE(provider_message_id); UNIQUE(organization_id, idempotency_key) |
| `message_attachments` | id, organization_id, message_id, storage_path, mime_type, size_bytes, sha256 | Bucket privado, URL assinada de curta duração |
| `internal_notes` | id, organization_id, conversation_id, author_user_id, body | Nunca enviadas ao cliente |
| `webhook_events` | id, provider, provider_event_id, payload jsonb, signature_valid, received_at, processed_at, error | UNIQUE(provider, provider_event_id); retenção 30 dias; sem RLS de org (acesso só via service role) |

### CRM
| Tabela | Colunas principais | Observações |
|---|---|---|
| `tags` / `contact_tags` | tags: id, organization_id, name, color; contact_tags: contact_id, tag_id | |
| `custom_field_definitions` | id, organization_id, entity (contact/deal), key, label, type (text/number/date/select/money/boolean), options jsonb, is_sensitive | |
| `custom_field_values` | organization_id, definition_id, entity_id, value_text, value_number, value_date, value_bool | Colunas tipadas (filtráveis) em vez de jsonb solto; índice por (organization_id, definition_id, value_*) |
| `pipelines` / `pipeline_stages` | stages: id, pipeline_id, organization_id, name, position, kind (open/won/lost), probability | `kind` permite métricas independentes do nome da etapa |
| `deals` | id, organization_id, contact_id, pipeline_id, stage_id, owner_user_id, title, value_cents, currency, expected_close_date, status (open/won/lost), lost_reason, won_at, source_signal_id, deleted_at | `source_signal_id` liga venda a um sinal do Radar → "receita recuperada" real |
| `deal_stage_history` | id, organization_id, deal_id, from_stage_id, to_stage_id, changed_by, changed_at | Base para tempo de conversão |
| `products_services` | id, organization_id, name, description, price_cents, price_type (fixed/from/on_request), duration_min, active | Fonte de verdade de preço para a IA |
| `tasks` | id, organization_id, contact_id, deal_id, assignee_user_id, title, due_at, status, created_by_type (user/ai/automation) | |
| `ai_suggestions` | id, organization_id, target_type, target_id, kind (field_update/stage_change/reply/next_action), proposed jsonb, rationale, evidence_message_ids uuid[], status (pending/accepted/rejected/expired), decided_by | Toda alteração sugerida pela IA passa por aqui |

### Radar de oportunidades
| Tabela | Colunas principais | Observações |
|---|---|---|
| `opportunity_rules` | id, organization_id, kind (no_reply/proposal_stale/appointment_unconfirmed/inactive/rebuy_due), params jsonb, active | Configurável por segmento |
| `opportunity_signals` | id, organization_id, contact_id, deal_id, rule_id, potential_value_cents, value_basis (deal_value/avg_ticket/estimated), probable_reason, evidence jsonb, recommended_action, owner_user_id, status (open/in_progress/recovered/dismissed/lost), detected_at, resolved_at | `value_basis` deixa explícito quando o valor é **estimado**. "Recuperado" só via deal ganho |

### Agenda
| Tabela | Colunas principais | Observações |
|---|---|---|
| `professionals` | id, organization_id, name, user_id (opcional), active | |
| `availability_rules` | id, organization_id, professional_id, weekday, start_time, end_time | |
| `availability_exceptions` | id, organization_id, professional_id, starts_at, ends_at, reason | Férias, bloqueios |
| `appointments` | id, organization_id, contact_id, professional_id, service_id, starts_at, ends_at, status (scheduled/confirmed/canceled/no_show/done), source | **Constraint de exclusão** `EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status IN ('scheduled','confirmed')` — impede conflito no próprio banco, mesmo com requisições simultâneas |
| `waitlist_entries` | id, organization_id, contact_id, service_id, preferred_window | Fase 5 |

### Automações
| Tabela | Colunas principais | Observações |
|---|---|---|
| `automations` | id, organization_id, name, status (draft/active/paused), current_version_id | |
| `automation_versions` | id, automation_id, organization_id, version, definition jsonb (grafo validado por schema), created_by | Imutável: editar = nova versão |
| `workflow_runs` | id, organization_id, automation_version_id, trigger_event_id, subject_type, subject_id, status (running/waiting/succeeded/failed/canceled), started_at, finished_at | UNIQUE(automation_version_id, trigger_event_id) evita execução duplicada |
| `workflow_steps` | id, organization_id, run_id, node_id, status, attempt, input jsonb, output jsonb, error, resume_at | `resume_at` para esperas; reprocessamento seguro a partir do passo falho |
| `domain_events` | id, organization_id, type, subject_type, subject_id, payload jsonb, created_at | Outbox: gravado na mesma transação da mudança |

### Campanhas
| Tabela | Colunas principais | Observações |
|---|---|---|
| `campaigns` | id, organization_id, name, template_id, segment_definition jsonb, scheduled_at, status (draft/pending_approval/approved/sending/done/canceled), approved_by, frequency_cap | |
| `campaign_recipients` | id, organization_id, campaign_id, contact_id, consent_record_id, message_id, status, excluded_reason | Consentimento verificado e referenciado **no momento do envio** |

### IA
| Tabela | Colunas principais | Observações |
|---|---|---|
| `ai_agents` | id, organization_id, name, persona, tone, formality, mode (copilot/assisted/hybrid/autonomous), handoff_rules jsonb, forbidden_topics jsonb, business_hours jsonb, autonomy_limits jsonb | |
| `knowledge_documents` | id, organization_id, title, source_type (upload/url/text/faq), storage_path, status (processing/ready/failed), visibility (ai/internal) | |
| `knowledge_chunks` | id, organization_id, document_id, content, embedding vector(N), tokens | Busca vetorial **sempre** filtrada por organization_id (RLS + filtro explícito) |
| `ai_calls` | id, organization_id, feature, provider, model, input_tokens, output_tokens, cost_micros, latency_ms, status, conversation_id | Base do controle de custo; sem conteúdo bruto por padrão (privacidade) |

### SaaS, cobrança e auditoria
| Tabela | Colunas principais | Observações |
|---|---|---|
| `plans` | id, key, name, price_cents, interval, limits jsonb, features jsonb, active | Global |
| `subscriptions` | id, organization_id, plan_id, status, gateway, gateway_subscription_id, current_period_end, cancel_at | |
| `invoices` | id, organization_id, subscription_id, amount_cents, status, gateway_invoice_id, paid_at | |
| `coupons` / `coupon_redemptions` | código, desconto, validade, limites | |
| `usage_records` | id, organization_id, metric (ai_credits/messages_sent/contacts/storage_mb), quantity, period, recorded_at | Agregado diário em `usage_daily` para consultas rápidas |
| `integrations` | id, organization_id, kind (google_calendar/payment/webhook), config jsonb, secret_ref, status | Segredos fora da tabela |
| `audit_logs` | id, organization_id, actor_type (user/ai/system/platform_admin), actor_id, action, target_type, target_id, metadata jsonb, ip, created_at | Append-only; acesso de admin da plataforma a dados de cliente sempre gera registro visível para a org |
| `data_requests` | id, organization_id, contact_id, kind (export/delete), status, requested_at, completed_at | Direitos do titular (LGPD) |

## Decisões de normalização
- **Contato ≠ Lead ≠ Deal.** "Lead" é um estado do contato (sem deal ganho e com temperatura); oportunidade comercial é `deal`. Evita a tabela "leads" duplicada que a maioria dos CRMs acaba tendo.
- **Consentimento append-only** para ter prova histórica.
- **Valores de campos personalizados tipados** em vez de jsonb para filtros e segmentação eficientes.
- **Automações versionadas e imutáveis** para que execuções em andamento continuem na versão em que começaram.
- **Outbox (`domain_events`)** garante que nenhuma automação perca um evento por falha entre "gravar" e "enfileirar".
