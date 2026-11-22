# Changelog

## 0.2.0 — 2026-11-22
### Adicionado
- Copiloto de IA (Claude): sugestão de resposta com revisão humana e análise da conversa com aplicação seletiva no CRM.
- Assistente IA: catálogo de produtos/serviços, base de conhecimento com busca em português, personalidade e regras do assistente, métricas de uso.
- Guardrail que bloqueia valores, percentuais e parcelamentos ausentes das fontes cadastradas.
- Controle de custo: créditos mensais por organização com reserva atômica, registro de tokens e custo por chamada.
- Memória comercial do cliente na ficha e na conversa.
- Teste de fumaça com a API real (`npm run ai:smoke`).

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
