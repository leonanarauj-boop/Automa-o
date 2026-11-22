# Changelog

## 0.1.0 — 2026-11-22
### Adicionado
- Planejamento da Fase 1 (`docs/planejamento`).
- Fundação multi-tenant com RLS, autenticação própria, papéis e auditoria.
- Onboarding por segmento (funil, etiquetas, regras do Radar).
- Integração WhatsApp Cloud API: conexão, webhook assinado e idempotente, envio de texto/template, status, janela de 24h, descadastro, sincronização de templates.
- Fila de jobs em Postgres e worker.
- Caixa de entrada, CRM (contatos, notas, tarefas, consentimento), funil Kanban.
- Radar de oportunidades com separação entre potencial estimado e receita recuperada.
- Painel com indicadores reais; dados de demonstração identificados.
- Testes unitários, de integração (incl. isolamento multi-tenant) e E2E.
