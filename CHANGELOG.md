# Changelog

## 0.5.0 — 2026-11-23
### Adicionado
- Cobrança: planos e limites, teste grátis, assinatura via Asaas (cliente, assinatura, faturas), webhook autenticado e idempotente, cupons, upgrade imediato e downgrade agendado, inadimplência com carência de 7 dias, acesso restrito, cancelamento.
- Travas por plano: IA, campanhas, número de automações ativas e contatos (cadastro manual).
- Tela de Assinatura (plano, consumo, faturas) e aviso de status em todo o app.

## 0.4.0 — 2026-11-23
### Adicionado
- Campanhas: segmentação, pré-visualização, consentimento obrigatório, frequência, limite diário, aprovação, teste, agendamento, envio escalonado, cancelamento e resultados.
- Automações: gatilhos de contato, mensagem, etapa, agendamento e “sem resposta”; 11 tipos de passo; modelos prontos; versões; simulação; histórico; reprocessamento.
- Outbox de eventos de domínio, proteção contra laços e limite diário de execuções.
- Envio de templates centralizado com as regras de consentimento e limite diário.
### Corrigido
- Formulários não são mais limpos automaticamente após salvar (campos controlados ficavam diferentes do valor salvo).
- Variáveis de template com valor padrão agora são gravadas sem precisar editá-las.

## 0.3.0 — 2026-11-23
### Adicionado
- Agenda: profissionais, horário semanal, bloqueios, visão do dia, horários livres, encaixe, confirmação, remarcação, cancelamento e faltas.
- Restrição de exclusão no Postgres impedindo sobreposição de agendamentos ativos (testada com 20 pedidos simultâneos).
- Lembrete automático pelo WhatsApp com template aprovado e confirmação automática por resposta.
- Radar: alertas de agendamento não confirmado e de falta sem reagendamento.
- Agendamentos na ficha do cliente, no painel e nos dados de demonstração.

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
