# Plano Estratégico e de Execução — Fase 1 (Descoberta e Arquitetura)

> Status: **proposta para aprovação**. Nenhum código foi escrito.
> Data: 22/11/2026.
> Convenção usada em todo o documento:
> - **[FATO]**: verificado em fonte citada (ver "Fontes" no fim).
> - **[A VERIFICAR]**: informação de terceiros, mutável ou não confirmada em fonte oficial.
> - **[HIPÓTESE]**: suposição nossa, a ser validada com clientes ou dados.
> - **[RECOMENDAÇÃO]**: decisão proposta.

---

## 1. Análise crítica da ideia

### O que é forte
- **Dor real e cara.** PMEs brasileiras vendem pelo WhatsApp, mas a conversa vira "memória do celular do vendedor". Lead esquecido, orçamento sem retorno e falta de follow-up são perdas silenciosas que o dono sente, mas não mede.
- **Momento técnico favorável.** LLMs já conseguem extrair dados estruturados de conversas (intenção, orçamento, objeção) com custo baixo por mensagem. Isso permite um CRM que se **preenche sozinho**, que é exatamente onde CRMs tradicionais falham (ninguém atualiza o CRM).
- **A recuperação de receita é um gancho comercial mensurável.** "Você tem R$ 87 mil em propostas paradas" é uma frase que vende assinatura. "CRM com IA" sozinho, não.

### O que é fraco ou perigoso
1. **Escopo é de uma empresa de 50 pessoas.** Os 10 módulos + 9 diferenciais + site + admin são de 2–3 anos de trabalho. Construir tudo antes de vender garante fracasso. O plano abaixo corta o MVP em ~20% do escopo.
2. **Mercado lotado.** Kommo, RD Station, Zenvia, Blip, respond.io, WATI e dezenas de "CRM de WhatsApp" brasileiros já vendem inbox + funil + chatbot. **Inbox + Kanban + bot não é diferencial; é o mínimo para entrar.**
3. **"Para todos os segmentos" é posicionamento de ninguém.** A plataforma pode ser flexível por dentro, mas precisa ser vendida para um nicho por vez.
4. **Dependência da Meta.** Preço por mensagem, regras de templates, política de IA, limites de envio e aprovação de app são decididos unilateralmente pela Meta. Ela já mudou o modelo de cobrança (jul/2025), mudou a cobrança de utility (out/2026) e baniu chatbots de IA de propósito geral (jan/2026) [FATO]. O produto tem de absorver essas mudanças sem reescrita.
5. **IA autônoma vendendo é risco reputacional.** Um preço inventado em uma conversa real pode virar processo no Procon. O modo autônomo precisa vir depois do copiloto, com guardrails rígidos.
6. **Custo variável.** IA + mensagens Meta + armazenamento de mídia escalam com uso. Sem medição por tenant desde o dia 1, um cliente grande no plano barato gera prejuízo.
7. **Fundador solo/equipe pequena (hipótese).** Se for o caso, a arquitetura precisa ser simples de operar: poucos serviços, gerenciados, sem Kubernetes.

### Veredito
A ideia é viável **se** o produto for vendido como **"o sistema que recupera as vendas que você está perdendo no WhatsApp"** para um nicho específico, e não como "plataforma completa de CRM e automação". A plataforma completa é a visão de 3 anos; o MVP é a cunha.

---

## 2. Proposta de posicionamento comercial

**Categoria:** Inteligência comercial para quem vende pelo WhatsApp (não "CRM", não "chatbot").

**Frase de posicionamento [RECOMENDAÇÃO]:**
> "Cada conversa no WhatsApp vira uma oportunidade organizada — e nenhuma venda fica esquecida."

**Promessa mensurável:** em 7 dias o cliente vê, em reais, quanto tem de oportunidades paradas, e qual a próxima ação para cada uma.

**Contra quem nos posicionamos:**
| Alternativa atual do cliente | Nosso argumento |
|---|---|
| WhatsApp Business no celular + caderno/planilha | "Você perde vendas que nem sabe que perdeu. Nós mostramos quais e quanto valem." |
| CRMs tradicionais (Pipedrive, HubSpot, RD CRM) | "Seu time não atualiza CRM. O nosso se preenche sozinho a partir da conversa." |
| Plataformas de chatbot/disparo (Manychat, Zenvia, Blip) | "Não queremos robô respondendo seu cliente sem controle. A IA trabalha **para o seu vendedor**, e só atende sozinha quando você autorizar." |
| CRMs de WhatsApp (Kommo e similares) | "Configuração em 15 minutos, feito para o seu segmento, com foco em recuperar receita, não em montar funil." |

---

## 3. Análise de concorrentes

> Preços e funcionalidades de concorrentes mudam com frequência. Os valores abaixo são **ponto de partida** e devem ser revalidados nos sites oficiais na semana 1 da execução (entregável E1.1). Não presumo que concorrentes sejam ruins: os grandes resolvem bem o que se propõem.

| Concorrente | Público | Modelo de preço | Forças | Limitações percebidas / oportunidade |
|---|---|---|---|---|
| **Kommo** (ex-amoCRM) | PMEs com venda por mensageiro; forte no Brasil | Por usuário/mês em USD ou BRL; Básico US$ 20 e Avançado US$ 30 para novos clientes desde 01/09/2026 [FATO, blog Kommo]; teste 14 dias; Meta cobrado à parte [FATO]; compromisso mínimo de meses [A VERIFICAR] | Referência em "CRM de mensageiro", pipeline, Salesbot, IA incluída nos planos | Curva de configuração alta; cobrança por usuário encarece times; Salesbot é poderoso, mas técnico [HIPÓTESE, validar em reviews] |
| **RD Station (CRM + Conversas)** | PMEs brasileiras com marketing digital | Por plano/usuário em BRL [A VERIFICAR] | Ecossistema forte de marketing, marca conhecida, base enorme | WhatsApp não é o núcleo do produto; IA de conversa menos central [HIPÓTESE] |
| **Zenvia** | Médias/grandes, multicanal (SMS, WhatsApp, voz) | Planos + consumo [A VERIFICAR] | BSP oficial, robustez, multicanal | Orientado a empresas maiores e a disparo/atendimento; menos CRM de vendas para PME [HIPÓTESE] |
| **Blip (Take)** | Grandes empresas, chatbots | Enterprise, sob consulta [A VERIFICAR] | Escala, contas grandes, BSP | Fora do alcance de preço/complexidade de PMEs [HIPÓTESE] |
| **Manychat** | Criadores, e-commerce, Instagram-first | Freemium + Pro por contatos [A VERIFICAR] | Excelente construtor de fluxos, Instagram | Não é CRM de vendas consultivas; pouco foco em pipeline e recuperação [HIPÓTESE] |
| **respond.io** | Médias empresas globais | Por plano + usuários, USD [A VERIFICAR] | Inbox multicanal excelente, workflows, AI Agents | Preço em dólar e foco global; pouco "playbook" de segmento brasileiro [HIPÓTESE] |
| **WATI / Interakt** | PMEs (forte na Índia) | Planos baratos em USD + markup sobre Meta [A VERIFICAR] | Simplicidade, templates, broadcast | Foco em broadcast; CRM raso; pouco presentes no Brasil [HIPÓTESE] |
| **HubSpot** | PMEs a enterprise | Freemium; módulos caros ao escalar [A VERIFICAR] | CRM completo, marca, integrações | Caro para PME brasileira; WhatsApp é integração, não núcleo [HIPÓTESE] |
| **Pipedrive** | Times de vendas consultivas | Por usuário, USD [A VERIFICAR] | Pipeline simples e excelente | WhatsApp via integrações; sem leitura automática da conversa [HIPÓTESE] |
| **Nichados BR** (sistemas de clínica, imobiliária com WhatsApp) | Segmentos específicos | Mensalidade BRL | Profundidade no segmento (prontuário, imóveis) | Inteligência comercial e recuperação fracas; competimos com integração, não substituição [HIPÓTESE] |

**Lacunas que acreditamos existir (todas [HIPÓTESE] até a pesquisa com clientes, entregável E1.2):**
1. Ninguém quantifica claramente "dinheiro parado" em reais e sugere a ação de forma simples para o dono.
2. CRM que se preenche sozinho a partir da conversa, com o humano apenas aprovando.
3. Configuração por segmento pronta (funil, campos, automações, FAQ) em vez de "tela em branco".
4. Preço por empresa (com assentos incluídos) em vez de por usuário — atraente para PMEs com 3–10 atendentes.

**Como validar (antes de codar o MVP):** 15–20 entrevistas com donos/gestores do nicho escolhido; análise de reviews (Reclame Aqui, G2, Capterra, Google Play) dos 5 principais; teste de cada concorrente na conta trial.

---

## 4. Diferenciais competitivos recomendados

Priorizados por **valor percebido ÷ custo de construção**:

| # | Diferencial | Valor | Complexidade | Fase |
|---|---|---|---|---|
| 1 | **Radar de Oportunidades** (dinheiro parado em R$, separado de receita recuperada) | Muito alto — é o argumento de venda | Média (regras + SQL, IA opcional) | MVP |
| 2 | **CRM que se preenche sozinho** (IA extrai nome, interesse, orçamento, objeção, etapa e **sugere**; humano aprova) | Muito alto | Média | MVP |
| 3 | **Próxima melhor ação** por lead (regras explicáveis primeiro, IA depois) | Alto | Baixa–média | MVP (regras) |
| 4 | **Onboarding por segmento** (templates de funil, campos, FAQ, automações) | Alto — reduz churn inicial | Baixa (é conteúdo + seed) | MVP (1 segmento) |
| 5 | **Copiloto de respostas** com RAG da empresa | Alto | Média | MVP |
| 6 | **Score de intenção explicável** | Médio–alto | Média | Fase 5 |
| 7 | **Memória comercial do cliente** (resumo vivo) | Alto | Baixa (resumo incremental) | Fase 4 |
| 8 | **Inteligência de objeções** | Médio | Média | Fase 6 |
| 9 | **Simulador de crescimento** | Médio (ótimo para marketing/SEO também) | Baixa | Fase 6 / site |
| 10 | **Inteligência de horários** | Médio | Média (exige volume de dados) | Fase 6 |
| 11 | **Copiloto do gestor** (perguntas em linguagem natural) | Alto, mas caro de fazer bem | Alta | Fase 6 |
| 12 | **Construtor visual de workflows** | Alto para avançados, baixo para PME iniciante | Alta | Fase 4 (simples) → 6 (visual) |

**Ideias adicionais que proponho (para sua aprovação, não incorporadas ao escopo):**
- **Relatório semanal automático por e-mail/WhatsApp para o dono** ("Esta semana: 14 leads, 3 esfriando, R$ 12 mil parados"). Custo baixo, retenção alta.
- **"Modo auditoria" de 7 dias no trial:** conecta o número, a IA analisa conversas recebidas a partir da conexão e entrega o diagnóstico de oportunidades. É o "primeiro resultado" do funil. Obs.: a Cloud API **não** dá acesso ao histórico anterior à conexão (ver §13); o diagnóstico é prospectivo.
- **Importação assistida de planilha** de clientes antigos com checagem de consentimento — destrava reativação de base.

---

## 5. Público-alvo inicial mais promissor

**[RECOMENDAÇÃO] Nicho de entrada: negócios de serviço com agendamento e ticket médio/alto — clínicas odontológicas e de estética particulares, com 1 a 10 pessoas no atendimento.**

Por quê:
- Vendem quase 100% pelo WhatsApp (orçamento → avaliação → tratamento).
- Ticket alto (centenas a milhares de reais) → recuperar 1 orçamento já paga meses de assinatura. O ROI do Radar fica óbvio.
- Usam agendamento, sofrem com faltas e orçamentos não fechados → Radar + Agenda + lembretes têm valor imediato.
- Recompra/retorno previsível (limpeza, manutenção, procedimentos periódicos).
- Mercado grande e pulverizado, acessível por SEO local e por comunidades/associações do setor.

**Risco relevante:** dados de saúde são **dados pessoais sensíveis** (LGPD, art. 11). Mitigação: não armazenar prontuário, não ser sistema clínico, minimizar dados, criptografia de campos sensíveis, DPA com cliente (controlador) e nós (operador), retenção configurável. Se essa carga for considerada alta demais para o MVP, a **alternativa** é **estética/beleza não médica, estúdios e cursos livres** (mesma dinâmica de agendamento, menor sensibilidade). Proponho decidir na entrevista com clientes (E1.2).

**Segundo nicho (fase 7–8):** imobiliárias/corretores (ticket altíssimo, ciclo longo, muito follow-up).

---

## 6. Nome e posicionamento

O nome deve evitar "Whats", "Zap" ou marcas da Meta (risco com as diretrizes de marca da Meta e com o INPI).

Sugestões (todas requerem busca no INPI e disponibilidade de domínio `.com.br`):
| Nome | Ideia |
|---|---|
| **Retoma** | Retomar vendas esquecidas; verbo de ação; fácil em português |
| **Fechô** | Linguagem coloquial de venda fechada; memorável |
| **Radarvenda** | Diz o diferencial principal |
| **Kairo** | De *kairós*, "o momento certo" — próxima melhor ação; neutro e internacionalizável |
| **Conversa Viva** | Conversas que viram oportunidades |

**[RECOMENDAÇÃO]**: **Retoma** — comunica o benefício central (recuperar receita) e funciona como verbo em campanhas ("Retoma aquele orçamento").

---

## 7. MVP mais viável

**Objetivo do MVP:** um cliente do nicho conecta o WhatsApp oficial, atende pela caixa de entrada, vê os leads organizados automaticamente e recebe, toda manhã, a lista de oportunidades paradas com valor e ação recomendada. Ele deve pagar por isso.

### Dentro do MVP
1. **Fundação:** autenticação, organizações (multi-tenant com RLS), convites, papéis básicos (dono, gestor, atendente), auditoria.
2. **Conexão WhatsApp oficial** via Embedded Signup (1 número por organização no MVP).
3. **Caixa de entrada:** conversas em tempo real, envio de texto/mídia, templates aprovados, janela de 24h visível, notas internas, atribuição de responsável, respostas rápidas.
4. **CRM:** contato criado automaticamente, campos padrão + personalizados, tags, linha do tempo, pipeline Kanban com etapas editáveis, negócios (deals) com valor, tarefas.
5. **IA modo copiloto:** sugestão de resposta com RAG (FAQ + documentos + catálogo de serviços/preços), extração estruturada com **sugestões de atualização do CRM que o humano aprova**, resumo da conversa.
6. **Radar de Oportunidades v1:** regras configuráveis (sem resposta há X dias, proposta aberta há Y dias, agendamento não confirmado), valor potencial vs. recuperado, próxima ação recomendada.
7. **Follow-up assistido:** criar tarefa ou mensagem sugerida (template quando fora da janela), sempre com envio humano no MVP.
8. **Agenda simples:** profissionais, serviços com duração, horários, agendamento manual com prevenção de conflito, lembrete por template.
9. **Onboarding do segmento escolhido:** funil, campos, FAQ e templates pré-configurados.
10. **Opt-in/opt-out** registrado por contato.
11. **Billing:** 2 planos + trial, limites e medição de uso (mensagens, IA, contatos).
12. **Site:** home, preços, página do segmento, 1 calculadora gratuita, blog técnico mínimo.

### Fora do MVP (e por quê)
| Fora | Motivo |
|---|---|
| Atendimento autônomo pela IA | Risco reputacional; precisa de dados de qualidade do copiloto primeiro |
| Construtor visual de workflows | Caro; no MVP, automações pré-prontas com parâmetros cobrem 80% |
| Campanhas em massa | Exige maturidade em consentimento e qualidade de número; risco de banimento |
| Copiloto do gestor | Exige dados acumulados e camada semântica segura |
| Central de conteúdo/Status | Não há API oficial para Status (ver §13) |
| Múltiplos números, Instagram, e-mail | Depois de validar o núcleo |
| App mobile nativo | PWA responsiva cobre o MVP |
| Painel admin completo | MVP usa admin mínimo + acesso auditado ao banco |

**Critério de sucesso do MVP [HIPÓTESE de meta]:** 10 clientes pagantes do nicho; ≥60% deles com uso semanal após 30 dias; ao menos 1 caso documentado de receita recuperada atribuível ao Radar.

---

## 8. Arquitetura técnica recomendada

Ver detalhes em [`03-ARQUITETURA.md`](./03-ARQUITETURA.md). Resumo das decisões:

| Camada | Escolha | Justificativa | Alternativa descartada (por ora) |
|---|---|---|---|
| Linguagem | **TypeScript** ponta a ponta | Um idioma, tipos compartilhados, contratação fácil no Brasil | — |
| Monorepo | **pnpm workspaces + Turborepo** | Compartilhar domínio, schemas e UI entre site, app e worker | Polyrepo (mais atrito) |
| App web | **Next.js (App Router) + React + Tailwind + componentes acessíveis (Radix/shadcn)** | SSR para site/SEO e app no mesmo framework; ecossistema maduro | SPA pura (pior para SEO) |
| Site público | App Next.js **separado** (`apps/site`) | Deploy, cache e SEO independentes da aplicação autenticada | Mesmo app (acoplamento) |
| Banco | **PostgreSQL gerenciado (Supabase)** com **RLS**, migrations versionadas | Postgres é o padrão certo para dado relacional; Supabase dá auth, storage, realtime e pgvector num pacote barato | Firebase (modelo de dados ruim para CRM) |
| Busca vetorial (RAG) | **pgvector** no mesmo Postgres | Sem serviço extra; isolamento por tenant via RLS | Pinecone etc. (custo, mais um lugar para vazar dados) |
| Filas / jobs | **Graphile Worker ou pg-boss** (filas em Postgres) no MVP | Zero infraestrutura nova, transacional com os dados; troca para Redis/BullMQ quando o volume exigir | Redis desde o dia 1 (custo e operação sem necessidade) |
| Worker | Serviço Node **de longa duração** (Fly.io / Railway / Render) | Webhooks, IA, automações e esperas não cabem bem em funções serverless com timeout | Tudo em serverless |
| Hospedagem web | **Vercel** (site + app) | Excelente para Next.js; preview por PR | Self-host (operação) |
| Realtime | Supabase Realtime (mensagens novas na inbox) | Já incluso | Socket.io próprio |
| Arquivos | Supabase Storage (bucket privado, URLs assinadas) | Mídia do WhatsApp e documentos da IA | S3 direto (possível depois) |
| IA | **Camada de provedor própria** (interface única) com Claude como padrão e possibilidade de outro provedor | Trocar provedor sem reescrever; registrar custo por chamada | SDK de um só provedor espalhado pelo código |
| Pagamentos | **Gateway com Pix, boleto e cartão recorrente** (avaliar Asaas, Pagar.me, Stripe Brasil) | Pix e boleto são decisivos para PME brasileira | Só cartão |
| E-mail | Resend ou Amazon SES | Transacional barato | — |
| Observabilidade | Sentry (erros) + logs estruturados (pino) + métricas básicas | Barato e suficiente | Stack própria |

**Princípios de arquitetura:**
- **Monólito modular** (módulos de domínio isolados dentro do mesmo código) + **1 worker**. Microserviços só quando houver dor real.
- **Webhook rápido e burro:** valida assinatura, grava evento bruto, enfileira, responde 200. Todo processamento é assíncrono e idempotente.
- **Camada de canal desacoplada** (`ChannelProvider`): Cloud API primeiro; Instagram/outros provedores entram como novos adaptadores.
- **Toda escrita importante passa por um serviço de domínio** que checa permissão, plano/limite e grava auditoria.

---

## 9. Modelo inicial do banco de dados

Ver [`02-MODELO-DE-DADOS.md`](./02-MODELO-DE-DADOS.md) (entidades, colunas principais, índices, regras de RLS e decisões de normalização).

---

## 10. Mapa completo de módulos e funcionalidades

Legenda de fase: **MVP** = Fases 2–3 (+ partes da 4/5); números = fase do roadmap (§16).

| Módulo | Funcionalidade | Fase |
|---|---|---|
| **Fundação** | Auth (e-mail+senha, magic link, Google), MFA opcional | MVP / 7 (MFA) |
| | Organizações, convites, papéis e permissões | MVP |
| | Auditoria de ações sensíveis | MVP |
| | Onboarding por segmento | MVP (1 segmento) / 7 (vários) |
| **J. Caixa de entrada** | Conversas em tempo real, mídia, templates, janela 24h | MVP |
| | Atribuição, notas internas, respostas rápidas, etiquetas | MVP |
| | Filas, distribuição automática (round-robin), prioridades, SLA | 6 |
| | Indicadores de atendimento | 6 |
| **A. CRM** | Contato automático, campos padrão/custom, tags, timeline | MVP |
| | Pipeline Kanban configurável, deals com valor, tarefas, lembretes | MVP |
| | Sugestões de atualização via IA com aprovação | MVP |
| | Temperatura, intenção, orçamento, urgência, objeções | MVP (sugerido) / 5 (score) |
| | Importação/exportação com controles | 5 |
| | Compras/pagamentos via integração | 8 |
| **B. Agente de IA** | Modo copiloto (sugestão), resumo, extração | MVP |
| | Base de conhecimento (RAG) com documentos, FAQ, catálogo | MVP |
| | Configuração de persona, tom, limites, respostas proibidas | MVP (básico) / 4 |
| | Modo assistido (tarefas autorizadas) | 4 |
| | Modo híbrido (atende e transfere) | 4 |
| | Modo autônomo dentro de limites | 5 (após métricas de qualidade) |
| | Avaliação de qualidade, custo por conversa, troca de provedor | 4 |
| **C. Automações** | Automações pré-prontas parametrizáveis (novo lead, sem resposta, proposta parada, lembrete) | MVP (2–3) / 4 |
| | Motor de workflows (gatilhos, condições, esperas, ações, webhooks) | 4 |
| | Construtor visual, versionamento, teste, histórico, reprocessamento | 6 |
| **D. Recuperação** | Radar v1 (regras) com valor potencial vs. recuperado | MVP |
| | Priorização e abordagem sugerida por IA | 5 |
| | Recompra por ciclo, inativos, agendamentos cancelados | 5 |
| **E. Campanhas** | Segmentação, templates, agendamento, aprovação, frequência, opt-out | 6 |
| | Teste A/B, calendário, biblioteca, métricas | 6 |
| **F. Agenda** | Profissionais, serviços, horários, conflito transacional, lembretes | MVP (simples) |
| | Agendamento pela IA, lista de espera, faltas, reagendamento | 5 |
| | Google Calendar (sincronização) | 5 / 8 |
| **G. Dashboards** | Painel essencial (leads, conversão, tempo de resposta, receita) | MVP (essencial) |
| | BI completo, comparativos, exportação, visão por time/canal/campanha | 6 |
| | Saúde operacional (falhas, não entregues, automações) | 4 |
| **H. Copiloto do gestor** | Perguntas em linguagem natural sobre dados autorizados, com citação | 6 |
| **I. Conteúdo/Status** | Calendário editorial, textos com IA, biblioteca, lembrete de publicação manual | 8 |
| **Diferenciais** | Próxima melhor ação (regras) | MVP |
| | Score de intenção, memória comercial | 4–5 |
| | Objeções, horários, simulador, biblioteca de playbooks | 6 |
| **Monetização** | Planos, trial, limites, medição | MVP (básico) / 7 |
| | Créditos de IA, excedentes, cupons, inadimplência | 7 |
| **Admin SaaS** | Empresas, planos, consumo, falhas, feature flags | 7 |
| | Suporte com acesso auditado e consentido (break-glass) | 7 |
| **Site/SEO** | Home, preços, segmento, calculadora, blog | MVP / 7 |
| | Ferramentas gratuitas, glossário, comparativos, central de ajuda | 7 |

---

## 11. Fluxo de funcionamento do sistema

### 11.1 Mensagem recebida (caminho crítico)
```
Cliente envia mensagem no WhatsApp
  → Meta envia webhook (POST) para /api/webhooks/whatsapp
     1. Verifica assinatura X-Hub-Signature-256 com o App Secret
     2. Grava evento bruto em webhook_events (único por id da Meta → idempotência)
     3. Enfileira job "process_inbound" e responde 200 imediatamente
  → Worker processa:
     4. Resolve organização pelo phone_number_id
     5. Upsert de contato (por wa_id) e de conversa; abre/atualiza janela de 24h
     6. Grava mensagem; baixa mídia para storage privado (URL da Meta expira)
     7. Publica evento de domínio "message.received"
  → Consumidores do evento:
     8. Inbox atualiza em tempo real (Realtime)
     9. Motor de automações avalia gatilhos (ex.: "novo lead")
    10. IA (se habilitada e com crédito): extração estruturada → sugestões ao CRM;
        modo copiloto → rascunho de resposta
    11. Radar recalcula sinais do contato/deal
```

### 11.2 Mensagem enviada
```
Atendente envia (ou aprova sugestão da IA)
  → Serviço de mensagens checa: permissão, opt-out, janela de 24h
     (fora da janela → só template aprovado), limite do plano
  → Grava mensagem "pending" + job "send_outbound" (com chave de idempotência)
  → Worker chama Cloud API; grava wamid
  → Webhooks de status (sent / delivered / read / failed) atualizam a mensagem
  → Falhas: retry com backoff para erros transitórios; erro definitivo → alerta no painel de saúde
```

### 11.3 Ciclo diário do Radar
```
Job agendado por organização (fuso da empresa)
  → Avalia regras: deals sem interação > N dias, propostas abertas, agendamentos não confirmados, inativos por ciclo
  → Gera/atualiza opportunity_signals com valor potencial, motivo (com evidência), próxima ação
  → Notifica responsáveis (in-app; e-mail/WhatsApp para o dono, se configurado)
Recuperação só é contada como "recuperada" quando um deal ligado ao sinal muda para "ganho" com valor registrado.
```

### 11.4 Jornada do usuário (primeira semana)
Cadastro → escolhe segmento → wizard cria funil/campos/FAQ → conecta WhatsApp (Embedded Signup) → envia mensagem de teste → convida equipe → primeiros leads chegam e são organizados → dia 2+: Radar mostra primeiras oportunidades → dia 7: relatório "o que encontramos" → conversão para plano pago.

---

## 12. Estratégia de integração oficial com WhatsApp

1. **Modelo de parceria [RECOMENDAÇÃO]:** tornar-se **Tech Provider** da Meta (app próprio no Meta for Developers, verificação da empresa, revisão de app para as permissões `whatsapp_business_management` e `whatsapp_business_messaging`). Os clientes conectam **suas próprias WABAs** via **Embedded Signup** e **pagam a Meta diretamente** com método de pagamento próprio. Assim não revendemos mensagens nem assumimos risco de crédito no início. Requisitos exatos do programa Tech Provider [A VERIFICAR na documentação vigente no início da Fase 3].
2. **Alternativa / plano B:** usar um **BSP** (ex.: 360dialog, Gupshup, Twilio) como camada de acesso se a aprovação como Tech Provider atrasar. A camada `ChannelProvider` permite isso sem mudar o domínio.
3. **Coexistência com o app WhatsApp Business:** a Meta oferece um fluxo de onboarding em que o número continua no app WhatsApp Business e também passa a funcionar via Cloud API [A VERIFICAR: disponibilidade no Brasil, limitações de recursos, sincronização de histórico]. Para PMEs isso é **decisivo** (ninguém quer "perder o WhatsApp do celular"). Avaliar já na Fase 1 (spike técnico E1.6).
4. **Recursos suportados no MVP:** texto, imagem, documento, áudio (receber; enviar quando suportado), botões/listas interativas, templates, status de entrega/leitura.
5. **Webhooks:** endpoint único, verificação de assinatura, idempotência por id, armazenamento bruto por 30 dias para reprocessamento, reconciliação periódica de status.
6. **Templates:** criação/sincronização via API, status de aprovação, categoria (marketing/utility/authentication) exibida com o custo estimado antes do envio.
7. **Regras de negócio aplicadas no código:** janela de atendimento de 24h, opt-in obrigatório para iniciar conversas, opt-out imediato (palavras como "SAIR", "PARAR" + botão), limites de envio do número e *quality rating* monitorados.
8. **IA dentro da política:** desde 15/01/2026 a Meta proíbe provedores de IA de propósito geral na Business API quando a IA é a funcionalidade principal oferecida; bots de negócio (atendimento, vendas, agendamento) continuam permitidos [FATO]. Nosso agente deve ser **restrito ao negócio do cliente** (escopo fechado no prompt de sistema e recusa de assuntos fora do escopo). Reavaliar a política a cada trimestre.
9. **Sem automação não oficial:** nada de WhatsApp Web, Puppeteer, QR Code de sessão. Uma extensão de navegador, se existir, será apenas auxiliar (ex.: abrir a ficha do CRM ao lado), sem enviar mensagens.

---

## 13. Limitações técnicas a considerar

| Limitação | Impacto | Mitigação |
|---|---|---|
| Cobrança por mensagem entregue (desde jul/2025) e utility cobrada mesmo dentro da janela a partir de 01/10/2026 [FATO/A VERIFICAR detalhes] | Lembretes e follow-ups têm custo; cliente precisa entender | Exibir custo estimado por envio e por campanha; relatório de gasto Meta |
| Faturamento em BRL pela Meta no Brasil previsto para 2º semestre/2026 [A VERIFICAR data] | Câmbio afeta custo do cliente | Monitorar; mostrar custos em BRL estimados |
| Fora da janela de 24h só templates aprovados | Follow-up livre impossível após 24h | Biblioteca de templates de retomada pré-aprovados por segmento |
| Aprovação de templates pode reprovar ou recategorizar (utility → marketing) | Atrito e custo inesperado | Guia de escrita de templates; validação de categoria antes do envio |
| Limites de envio por número e *quality rating* | Campanhas grandes bloqueadas; número pode ser restringido | Controle de frequência, aquecimento gradual, bloqueio de campanhas para números com qualidade baixa |
| Cloud API **não** entrega histórico anterior à conexão (exceto possíveis recursos de coexistência) [A VERIFICAR] | Radar começa "vazio" | Importação de planilha; diagnóstico prospectivo; expectativa clara no onboarding |
| URLs de mídia da Meta expiram | Mídia perdida se não baixada | Download imediato para storage privado |
| **Não existe API oficial para publicar WhatsApp Status** (nenhuma evidência em documentação oficial; só serviços não oficiais) [FATO até onde verificado] | Módulo I não pode automatizar Status | Planejamento + criação + lembrete + publicação manual assistida |
| Política de IA da Meta (jan/2026) | Risco de enquadramento se o agente parecer "assistente geral" | Escopo fechado, revisão trimestral |
| LLMs alucinam | Preço/condição inventada | Respostas comerciais só com dados recuperados e citados; "não sei → humano"; validação de números contra o catálogo |
| Latência de LLM (segundos) | Experiência de inbox | Sugestões assíncronas, streaming, modelo pequeno para extração |
| Serverless tem timeout | Jobs longos falham | Worker dedicado |
| RLS mal configurada = vazamento entre tenants | Crítico | Testes automatizados de isolamento em toda tabela; `organization_id` obrigatório; revisão de políticas em CI |

---

## 14. Estratégia de monetização

**Modelo [RECOMENDAÇÃO]: preço por organização com assentos incluídos + créditos de IA + Meta pago diretamente pelo cliente.**

Por quê: PMEs odeiam preço por usuário; o custo variável real é IA (controlado por créditos) e mensagens (pagas à Meta pelo próprio cliente, sem markup no início).

Hipóteses de preço (validar em entrevistas e teste de página de preços, [HIPÓTESE]):

| Plano | Preço/mês (hipótese) | Inclui |
|---|---|---|
| **Trial** | 14 dias grátis, sem cartão | Recursos do Professional, limites baixos |
| **Free** (avaliar se vale a pena) | R$ 0 | 1 usuário, 100 contatos, sem IA, marca d'água — só se o funil de SEO justificar |
| **Starter** | R$ 149 | 2 usuários, 1 número, inbox, CRM, pipeline, Radar básico, 200 créditos de IA |
| **Professional** | R$ 349 | 5 usuários, copiloto IA, RAG, automações prontas, agenda, Radar completo, 1.500 créditos |
| **Business** | R$ 799 | 12 usuários, filas/SLA, campanhas, relatórios avançados, copiloto do gestor, 5.000 créditos |
| **Enterprise** | Sob consulta | Multiunidade, SSO, permissões avançadas, integrações, SLA de suporte |

- **Usuário extra:** R$ 39–59/mês. **Créditos de IA extras:** pacotes pré-pagos. **Desconto anual:** 15–20%.
- **Crédito de IA** = unidade interna que abstrai tokens (ex.: 1 sugestão de resposta ≈ 1 crédito; 1 página de documento indexada ≈ 0,5 crédito). Definir após medir custo real na Fase 4.
- **Inadimplência:** carência de 7 dias → modo somente leitura → suspensão (dados preservados por 90 dias, depois exclusão conforme política).
- **Margem alvo [HIPÓTESE]:** ≥ 75% bruta por cliente, monitorada por tenant (tabela `usage_records` + custo real das chamadas).

---

## 15. Estimativa de custos de infraestrutura e operação

> Valores de serviços em USD são **aproximados e devem ser reconferidos** nas páginas de preço no início da Fase 2 [A VERIFICAR]. Câmbio assumido: US$ 1 = R$ 5,50 [HIPÓTESE].

### 15.1 Custos fixos de plataforma
| Item | Fase MVP (0–50 clientes) | Crescimento (~500 clientes) |
|---|---|---|
| Supabase (Pro + compute + storage) | ~US$ 25–60/mês | ~US$ 300–800/mês |
| Vercel (Pro, 1–2 membros) | ~US$ 20–40/mês | ~US$ 100–300/mês |
| Worker (Fly/Railway/Render) | ~US$ 10–30/mês | ~US$ 100–300/mês |
| Sentry, e-mail, domínio, monitoramento | ~US$ 0–50/mês | ~US$ 150–300/mês |
| **Total aproximado** | **~US$ 60–180/mês (R$ 330–1.000)** | **~US$ 650–1.700/mês (R$ 3.600–9.400)** |

### 15.2 Custos variáveis por cliente
- **Mensagens Meta:** pagas pelo cliente diretamente à Meta (não entram no nosso custo no modelo Tech Provider). Mensagens de serviço dentro da janela iniciadas pelo cliente são gratuitas; templates de marketing/utility/autenticação são cobrados por mensagem [FATO]. Valores em BRL por categoria divergem entre fontes de terceiros [A VERIFICAR na tabela oficial da Meta].
- **IA (principal custo variável nosso).** Fórmula para orçar:
  `custo_IA_mês = mensagens_recebidas × (tokens_extração × preço_modelo_pequeno) + sugestões × (tokens_RAG × preço_modelo_médio) + embeddings`
  Premissas iniciais para um cliente Professional: 3.000 mensagens recebidas/mês, extração em lote por conversa (não por mensagem), 800 sugestões/mês. A conta em reais será fechada no spike E1.7 com preços oficiais vigentes dos provedores. Meta de custo: **≤ 10% do preço do plano**.
- **Storage de mídia:** pequeno (centavos a poucos reais por cliente/mês), com retenção configurável.
- **Gateway de pagamento:** tipicamente ~1–5% por transação dependendo do meio (Pix mais barato) [A VERIFICAR por gateway].

### 15.3 Custos não técnicos
Verificação da empresa na Meta e Tech Provider (sem custo direto conhecido, mas tempo de aprovação), CNPJ, contador, termos de uso/privacidade revisados por advogado (recomendado, ~R$ 2–6 mil uma vez [HIPÓTESE]), registro de marca no INPI.

---

## 16. Roadmap por etapas (com critérios objetivos de conclusão)

Estimativas assumem **1–2 desenvolvedores full-time** com apoio de IA [HIPÓTESE]; ajustar conforme o time real.

| Fase | Duração estimada | Entregas | Critério de conclusão |
|---|---|---|---|
| **1. Descoberta e arquitetura** | 2–3 semanas | Este plano aprovado; entrevistas; spikes técnicos (Embedded Signup, coexistência, custo de IA); protótipo navegável das 5 telas principais | Plano aprovado por você; ≥ 15 entrevistas; spikes respondidos; nicho decidido |
| **2. Fundação do SaaS** | 3–4 semanas | Monorepo, CI, design system, auth, orgs/papéis, RLS + testes de isolamento, onboarding v1, site (home/preços/segmento) | Usuário cria conta, organização e convida membro; teste automatizado prova que org A não lê dado de org B em **todas** as tabelas; Lighthouse ≥ 90 no site |
| **3. CRM + Inbox + WhatsApp** | 5–6 semanas | Embedded Signup, webhooks, envio/recebimento, inbox realtime, contatos, pipeline, tarefas, templates, opt-out | Número real conectado em conta de teste; mensagem ida e volta < 5 s p95; webhook duplicado não duplica mensagem (teste); janela 24h respeitada (teste) |
| **4. IA + Automações** | 5–6 semanas | Camada de provedor IA, RAG, copiloto, extração com aprovação, automações prontas, motor de workflows v1, painel de saúde, medição de custo | Conjunto de avaliação com ≥ 100 conversas: 0 preços inventados; sugestões aceitas ≥ 40% em piloto; custo IA por cliente ≤ meta |
| **5. Recuperação + Agenda** | 4–5 semanas | Radar v1/v2, próxima ação, agenda com bloqueio transacional, lembretes, score de intenção | Teste de concorrência: 50 reservas simultâneas no mesmo horário → 1 sucesso; Radar separa potencial de recuperado (teste); **piloto com 3–5 clientes reais** |
| **6. Campanhas + Inteligência** | 6–8 semanas | Campanhas com consentimento e frequência, construtor visual, BI, copiloto do gestor, objeções | Campanha bloqueada para contatos sem opt-in (teste); copiloto do gestor cita a consulta usada em 100% das respostas numéricas |
| **7. Monetização + Lançamento** | 4 semanas (parte em paralelo desde a Fase 3) | Billing completo, limites, admin SaaS, SEO, ferramentas gratuitas, central de ajuda, termos/LGPD | Assinatura, upgrade, downgrade, inadimplência testados ponta a ponta em sandbox; 10 clientes pagantes |
| **8. Escala** | Contínuo | Instagram/Messenger, Google Calendar, multiunidade, otimizações, app mobile se justificado | Definido por métricas (churn, NPS, custo por tenant) |

**MVP vendável = fim da Fase 5 (~5 meses) com Billing básico antecipado.** Pilotos pagos (preço de fundador) podem começar já ao fim da Fase 3.

---

## 17. Riscos técnicos, comerciais e regulatórios

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Atraso/reprovação na verificação Meta ou Tech Provider | Média | Alto | Iniciar processo na Fase 1; plano B via BSP |
| Mudança de preço/política da Meta | Alta | Médio–alto | Camada de canal desacoplada; custos exibidos dinamicamente; monitorar changelog |
| Vazamento entre tenants | Baixa | Crítico | RLS + testes automatizados + revisão; `organization_id` em todo dado; pentest antes do lançamento |
| Alucinação da IA com impacto comercial | Média | Alto | Copiloto primeiro; respostas comerciais apenas com fonte; avaliações automatizadas; logs |
| Custo de IA acima do previsto | Média | Médio | Créditos por plano, modelos menores para extração, cache, processamento em lote |
| Banimento/qualidade baixa do número de um cliente por mau uso | Média | Alto (para o cliente) | Bloqueios de consentimento e frequência; não oferecer disparo em massa no MVP |
| Concorrência copiar o Radar | Alta | Médio | Velocidade, profundidade por segmento, dados acumulados, marca |
| Nicho escolhido não pagar o preço | Média | Alto | Entrevistas + página de preços com lista de espera antes de codar a Fase 3 |
| LGPD: dados sensíveis (saúde) | Média | Alto | Minimização, criptografia de campo, DPA, RIPD, encarregado (DPO) nomeado |
| Dependência de um único provedor de IA | Média | Médio | Interface de provedor; testes de avaliação rodando em ≥ 2 provedores |
| Fundador/time pequeno sobrecarregado | Alta | Alto | Escopo enxuto; serviços gerenciados; nada de Kubernetes/microserviços |
| Política de IA da Meta reinterpretada | Baixa–média | Alto | Agente sempre restrito ao negócio do cliente; nunca vender "assistente geral" |

---

## 18. Aquisição orgânica e SEO

**Palavras-chave e intenções** (volume e dificuldade a medir com ferramenta de SEO — Ahrefs/Semrush/Google Keyword Planner — no entregável E7.1 [A VERIFICAR]):

| Intenção | Exemplos de termo | Página |
|---|---|---|
| Comercial (fundo) | "crm para whatsapp", "crm para clínica odontológica", "sistema de atendimento whatsapp para clínica" | Home, página de segmento, preços |
| Comparação | "alternativa ao kommo", "kommo vs rd station" | Comparativos honestos |
| Problema (meio) | "como fazer follow-up no whatsapp", "como recuperar orçamento não fechado", "como reduzir faltas em clínica" | Blog com guia + CTA para ferramenta |
| Ferramenta (topo, alta conversão) | "calculadora de taxa de conversão", "calculadora de no-show", "gerador de link whatsapp", "modelos de mensagem de follow-up" | Ferramentas gratuitas |
| Informacional | "o que é lead qualificado", "o que é janela de 24h do whatsapp", "templates whatsapp business api" | Glossário / central de ajuda |

**Ferramentas gratuitas propostas (ordem de prioridade):**
1. **Calculadora de dinheiro parado** ("quanto você perde com orçamentos sem follow-up") → captura e-mail para receber relatório → convite para trial. *Conecta diretamente ao diferencial principal.*
2. **Calculadora de custo de mensagens do WhatsApp Business API** (por categoria, com fonte oficial e data de atualização).
3. **Biblioteca de modelos de mensagens de follow-up e templates aprováveis por segmento.**
4. **Gerador de link de WhatsApp com UTM** (atrai muito tráfego, baixo custo).
5. **Simulador de crescimento** (o diferencial 4.6 como ferramenta pública).

**SEO técnico:** site Next.js com SSG/ISR, URLs limpas, metadata por página, sitemap e robots gerados, canonical, Open Graph, JSON-LD (`Organization`, `SoftwareApplication`, `FAQPage`, `BreadcrumbList`, `Article`), imagens otimizadas, Core Web Vitals monitorados, Search Console desde o dia 1.

**Funil:** busca → ferramenta gratuita → e-mail/cadastro → trial com onboarding do segmento → conexão do WhatsApp (ativação) → primeiro Radar com valor (primeiro resultado) → assinatura → relatório semanal (retenção) → programa de indicação (1 mês grátis para ambos).

**Regra:** sem páginas programáticas em massa. Páginas por segmento só quando houver conteúdo e playbook reais para aquele segmento.

---

## Ordem de execução detalhada (Fases 1–3), com entregas e validação

| # | Entrega | Validação |
|---|---|---|
| **E1.1** | Revalidação de preços e recursos dos 10 concorrentes em planilha com fonte e data | Toda célula tem link; você revisa |
| **E1.2** | Roteiro + 15–20 entrevistas com o nicho; síntese de dores e disposição a pagar | Relatório com citações; decisão de nicho registrada |
| **E1.3** | Decisão de nome (busca INPI + domínio) | Nome livre nas classes 9/35/42 e domínio disponível |
| **E1.4** | Abertura do app Meta, verificação da empresa, início do processo Tech Provider | Protocolos abertos |
| **E1.5** | Spike: Embedded Signup + envio/recebimento em número de teste | Mensagem ida e volta funcionando em script isolado |
| **E1.6** | Spike: coexistência com app WhatsApp Business (disponibilidade e limites no Brasil) | Documento com resultado e impacto no onboarding |
| **E1.7** | Spike: custo e qualidade de IA (extração + sugestão) em 50 conversas anonimizadas/sintéticas identificadas como tal | Custo por conversa em R$ e taxa de erro medidos |
| **E1.8** | Protótipo navegável (Figma ou código descartável): Inbox, Contato, Pipeline, Radar, Onboarding | Testado com 5 usuários do nicho |
| **E1.9** | ADRs (registros de decisão) da arquitetura e modelo de dados final | Aprovação sua |
| **E2.1** | Monorepo, lint, testes, CI, ambientes (dev/staging), `.env.example` | CI verde; nenhum segredo no repositório (secret scanning) |
| **E2.2** | Design system (tokens, tema claro/escuro, componentes base acessíveis) | Checagem de contraste AA; Storybook ou página de componentes |
| **E2.3** | Schema base + RLS + suíte de testes de isolamento multi-tenant | Testes falham se qualquer tabela não tiver política |
| **E2.4** | Auth, organizações, convites, papéis, auditoria | Testes de permissão por papel |
| **E2.5** | Onboarding do segmento (seed de funil, campos, FAQ) | Usuário novo chega a um CRM configurado em < 10 min |
| **E2.6** | Site: home, preços, segmento, calculadora de dinheiro parado | Lighthouse ≥ 90; sitemap e metadata válidos |
| **E3.1** | Camada `ChannelProvider` + adaptador Cloud API + webhook idempotente | Testes com payloads reais da documentação; duplicatas ignoradas |
| **E3.2** | Inbox realtime, envio com regras de janela/opt-out, mídia | Teste E2E de conversa completa em staging |
| **E3.3** | Contatos, campos custom, tags, timeline, pipeline Kanban, deals, tarefas | Testes de integração; Kanban acessível por teclado |
| **E3.4** | Templates (sincronização, status, categoria, custo estimado) | Template criado e aprovado em conta de teste |
| **E3.5** | Painel essencial + medição de uso por tenant | Números batem com consultas SQL de conferência |
| **E3.6** | Piloto fechado com 2–3 empresas reais (preço de fundador) | Uso diário por 2 semanas; bugs críticos = 0 |

As Fases 4–8 terão a mesma granularidade detalhada no início de cada fase, com base no aprendizado dos pilotos.

---

## Decisões que preciso que você tome

1. **Nicho inicial:** clínicas odontológicas/estética (recomendado) ou estética não médica/estúdios/cursos (menor risco LGPD)?
2. **Nome:** seguir com "Retoma" para busca no INPI?
3. **Modelo Meta:** Tech Provider próprio (recomendado) ou começar via BSP?
4. **Plano Free:** ter um plano gratuito permanente ou só trial de 14 dias (recomendado no início)?
5. **Time:** quantas pessoas vão desenvolver e com que dedicação? (ajusta o cronograma)
6. **Empresa:** já existe CNPJ e conta verificada no Meta Business Manager?

---

## Fontes consultadas (22/11/2026)
- Meta — Pricing on the WhatsApp Business Platform: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta — Pricing para provedores de IA: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers
- Meta — Changelog da plataforma: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog/
- Zenvia — FAQ novas regras de preço do WhatsApp: https://zenvia.movidesk.com/kb/en/article/600343/frequently-asked-questions-new-whatsapp-business-pricing-rules-2
- Kommo — Atualização de preços (01/09/2026): https://www.kommo.com/br/blog/atualizacao-precos-kommo/
- Kommo — Preços do WhatsApp em 2026: https://www.kommo.com/br/blog/update-precos-whatsapp/
- Kommo — Preços e créditos da Kommo IA: https://www.kommo.com/br/blog/preco-kommo-ia/
- TechCrunch — WhatsApp proíbe chatbots de propósito geral: https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform
- respond.io — Explicação da proibição de chatbots gerais: https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
- Hyperleap — Calculadora de preços WhatsApp Brasil 2026 (terceiro, não oficial): https://hyperleap.ai/whatsapp-pricing-calculator-brazil
