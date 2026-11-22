# Sistema de IA — Copiloto comercial

## O que faz hoje
| Recurso | Onde | Comportamento |
|---|---|---|
| Sugestão de resposta | Conversas → “Sugerir resposta com IA” | Gera um rascunho que o atendente edita e envia. Nunca envia sozinho (modo **copiloto**). |
| Análise da conversa | Conversas (painel lateral) e ficha do contato | Propõe memória comercial, temperatura, mudança de etapa, próxima ação (tarefa), interesses, orçamento citado e objeções com evidência. O humano marca o que aplicar. |
| Base de conhecimento | Assistente IA | Catálogo com preços (fonte única de valores), documentos/FAQ, personalidade e regras do assistente. |
| Métricas | Assistente IA | Usos no mês / limite, taxa de sugestões aproveitadas (enviadas como estão ou editadas), respostas bloqueadas, custo estimado. |

Modos assistido, híbrido e autônomo (IA respondendo sozinha) **não** estão implementados de propósito: dependem de medir a qualidade do copiloto em uso real primeiro.

## Arquitetura
```
Ação do usuário → copilot.ts
  1. loadContext (withTenant / RLS): conversa (até 40 msgs), contato, negócios, etapas, catálogo, config, trechos da base
  2. reserveCredit: trava a linha da organização, confere ai_enabled e limite mensal, cria ai_calls 'pending'
  3. AIProvider.generate (fora de transação): saída estruturada validada por schema (zod)
  4. Guardrail determinístico (respostas): valores em R$, percentuais e parcelas precisam existir nas fontes
  5. finishCall: tokens, custo estimado, latência, status (ok / blocked / refused / error)
  6. ai_suggestions 'pending' → decisão humana → accepted / accepted_edited / rejected
```

- **Provedor:** `src/modules/ai/provider.ts` (interface) e `anthropic.ts` (SDK oficial `@anthropic-ai/sdk`). Modelo padrão `claude-opus-5-5`, configurável por `AI_MODEL`. Esforço `medium` para respostas, `low` para análise.
- **Fallback de recusa:** a chamada usa o fallback automático do servidor (`fallbacks: "default"`), que tenta outro modelo se o principal recusar por um classificador de segurança. Se a cadeia toda recusar, a interface pede resposta manual.
- **Cache de prompt:** o bloco de instruções + perfil da empresa + catálogo é estável por organização e marcado para cache; conversa e trechos vão na mensagem do usuário.
- **Recuperação (RAG):** busca textual do Postgres em português sem acentos (`pt_unaccent`). Base de até ~40 mil caracteres vai inteira; acima disso, os 6 trechos mais relevantes. Escolhida em vez de embeddings para não depender de um segundo provedor; trocável por pgvector se as bases crescerem.

## Salvaguardas
1. **Nunca inventar condições comerciais:** instrução explícita + verificação determinística pós-geração; resposta com valor/percentual/parcela que não está no catálogo, nas políticas, na base ou na própria conversa é **bloqueada** e não é mostrada como texto pronto.
2. **Prompt injection:** mensagens do cliente vão delimitadas em `<conversa>` e o sistema instrui a tratá-las como dados; de qualquer forma, nada é executado sem humano.
3. **Escopo fechado ao negócio** (atende à política da Meta de jan/2026 contra assistentes de propósito geral na API do WhatsApp).
4. **Isolamento:** todo o contexto é lido com RLS da organização; teste automatizado confirma que dados de outra empresa não entram no prompt.
5. **Custo:** 1 crédito por chamada, limite mensal por organização (`ai_monthly_credits`, padrão 300), reserva com trava contra chamadas simultâneas, interruptor por organização, erro do provedor não consome crédito.
6. **Privacidade:** `ai_calls` guarda só metadados (tokens, custo, latência), nunca o conteúdo.

## Limitações conhecidas
- O guardrail verifica números; uma afirmação comercial sem número (“pode ser parcelado”) não é detectada — por isso o modo é copiloto, com revisão humana.
- Mídia (áudio, imagem) entra como texto descritivo; a IA não ouve áudios nem vê imagens ainda.
- Sem avaliação automática de qualidade com conversas reais (montar conjunto de avaliação com os primeiros pilotos).

## Validar com a API real
`ANTHROPIC_API_KEY=... npm run ai:smoke` faz 2 chamadas pequenas e mostra a saída estruturada, o modelo usado, tokens, custo estimado e o resultado do guardrail.
