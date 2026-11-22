# Retoma — Inteligência comercial pelo WhatsApp

Plataforma SaaS que transforma conversas do WhatsApp em oportunidades organizadas, mostra o dinheiro parado no funil e indica a próxima ação para cada cliente.

> **Status:** MVP em construção (Fases 2–3 do [plano](docs/planejamento/01-PLANO-ESTRATEGICO.md) entregues; partes da Fase 5 — Radar — também). Pré-lançamento: **não** usar em produção com clientes reais antes de concluir os itens de "Antes do lançamento" abaixo.

## O que já funciona (com persistência, validação e testes)

| Área | Funcionalidades |
|---|---|
| Contas e segurança | Cadastro, login (bloqueio após 5 falhas em 15 min), sessões seguras (cookie httpOnly, token com hash), papéis dono/gestor/atendente, auditoria |
| Multi-tenant | Isolamento por **Row Level Security** do Postgres em todas as tabelas de clientes, comprovado por testes automatizados |
| Onboarding | Funil, etiquetas e regras do Radar pré-configurados por segmento (clínica, serviços, imobiliária, educação, varejo, outro) |
| WhatsApp (API oficial) | Conexão de número da Cloud API (token criptografado AES-256-GCM, validado com a Meta), webhook com verificação de assinatura, processamento idempotente, envio de texto e templates, status de entrega/leitura, janela de 24h, descadastro por palavra-chave (SAIR/PARAR), sincronização de templates |
| Caixa de entrada | Conversas em tempo quase real, filtro "aguardando resposta", envio com regras de janela/consentimento, contexto do CRM ao lado |
| CRM | Contatos (criação automática pelo WhatsApp ou manual), busca e filtro por etiqueta, ficha com notas, tarefas, negócios e registro de consentimento |
| Funil | Kanban por etapas com valores, mover etapas, editar valores, motivo de perda; novo contato do WhatsApp gera negócio automaticamente |
| **Radar de oportunidades** | Cliente aguardando resposta, cliente que parou de responder, negócio parado; valor potencial (negócio ou ticket médio, sempre rotulado como estimativa) **separado** da receita recuperada (só conta quando o negócio é ganho após o alerta); próxima ação recomendada; recálculo automático a cada 15 min |
| Painel | Novos contatos, vendas, valor em negociação, tempo médio de 1ª resposta, funil por etapa, taxa de ganho |
| Demonstração | Dados de exemplo marcados como **DEMO**, removíveis com um clique |
| Infra | Fila de jobs em Postgres com retentativas e backoff, worker separado, logs estruturados |

## O que ainda NÃO existe (próximas entregas)
Agente de IA (copiloto e base de conhecimento), construtor de automações, agenda, campanhas, cobrança/assinaturas, convite de membros da equipe, Embedded Signup da Meta, recebimento de mídia (arquivos), exportação de dados (LGPD), painel administrativo da plataforma, site com SEO completo. Ordem e critérios em [docs/planejamento](docs/planejamento/01-PLANO-ESTRATEGICO.md).

## Como rodar localmente

Pré-requisitos: Node.js 20+ e PostgreSQL 15+ (local, Supabase, Neon, RDS…).

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e gere ENCRYPTION_KEY (instrução no arquivo)
npm run db:migrate            # cria as tabelas
npm run dev                   # aplicação em http://localhost:3000
npm run worker                # em outro terminal: processa webhooks, envios e o Radar
```

Crie uma conta em `/signup` e clique em **Carregar demonstração** no painel para ver o sistema com dados de exemplo.

### Conectar o WhatsApp de verdade
1. Crie um app Business no Meta for Developers com o produto WhatsApp.
2. Defina `META_APP_SECRET` (segredo do app) e `META_WEBHOOK_VERIFY_TOKEN` (texto que você escolhe) no `.env`.
3. Exponha a aplicação em HTTPS (deploy ou túnel) e configure o webhook da Meta para `https://SEU_DOMINIO/api/webhooks/whatsapp`, assinando o campo `messages`.
4. Em **Configurações → WhatsApp**, informe o ID da WABA, o ID do número e um token de usuário do sistema.

## Testes

```bash
npm run test:unit          # regras puras (assinatura, janela 24h, Radar, criptografia…)
npm run test:integration   # banco real: isolamento multi-tenant, webhooks, envio, Radar (usa TEST_DATABASE_URL — o banco é recriado)
npm run test:e2e           # navegador: cadastro → demo → contato → funil → webhook → conversa (usa o banco retoma_e2e)
npm run typecheck
```

## Antes do lançamento (bloqueadores)
- Revisão jurídica: Termos de Uso, Política de Privacidade, DPA (ver [LGPD.md](docs/LGPD.md)).
- Aprovação do app na Meta (verificação da empresa, permissões, Tech Provider).
- Cobrança e limites por plano; recuperação de senha por e-mail; MFA para donos.
- Backups e monitoramento configurados no provedor; pentest externo.

## Documentação
- [Plano estratégico](docs/planejamento/01-PLANO-ESTRATEGICO.md) · [Modelo de dados (alvo)](docs/planejamento/02-MODELO-DE-DADOS.md) · [Arquitetura (alvo)](docs/planejamento/03-ARQUITETURA.md)
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — como o código está organizado hoje e decisões tomadas
- [SECURITY.md](docs/SECURITY.md) · [LGPD.md](docs/LGPD.md) · [INTEGRATIONS.md](docs/INTEGRATIONS.md) · [CHANGELOG.md](CHANGELOG.md)
