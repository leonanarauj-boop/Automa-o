# Automações e campanhas

## Campanhas
Fluxo: **rascunho → (aprovação) → agendada → enviada**, com cancelamento a qualquer momento.

- **Segmentação** (filtros somados): etiquetas, temperatura, etapa do funil, negócio aberto, dias sem interação, dias com interação, cadastrados recentemente, máximo de destinatários.
- **Quem nunca recebe** (verificado na pré-visualização E de novo no momento do envio): contatos de demonstração, sem WhatsApp, que pediram para sair, **sem consentimento de marketing registrado** (obrigatório em toda campanha), que receberam campanha nos últimos N dias (configurável; padrão 7).
- **Limite diário**: contatos distintos que receberam template nas últimas 24h, configurável para acompanhar o limite do número na Meta (padrão 250). O que passa do limite fica registrado como não enviado.
- **Aprovação**: atendentes só enviam para aprovação; gestores/donos aprovam e agendam. A aprovação revalida template, variáveis, número conectado e elegíveis.
- **Envio de teste** para um contato que também tenha consentimento.
- **Envio escalonado** (~5 mensagens/s) pela fila; cancelar interrompe o que ainda não saiu.
- **Resultados**: enviadas, entregues, lidas, respostas (mensagem do cliente em até 72h), falhas e motivos de não envio.
- Não há importação de listas compradas nem envio para quem não autorizou: o produto não oferece esse caminho.

## Automações
Uma automação = **gatilho** + **passos em sequência** (até 20).

| Gatilhos | Passos |
|---|---|
| Novo contato · Mensagem recebida · Negócio mudou de etapa (opcionalmente para uma etapa) · Agendamento mudou de status (confirmado, atendido, faltou, cancelado) · Cliente não respondeu há N horas | Esperar · Condição (continua só se… / se não…) · Adicionar/remover etiqueta · Definir temperatura · Atribuir responsável (rodízio ou pessoa) · Criar tarefa · Mover negócio · Enviar template · Enviar texto (só com janela de 24h aberta) · Webhook |

Modelos prontos: Novo lead, Cliente não respondeu, Proposta não fechada, Pós-atendimento, Cliente faltou.

### Garantias do motor
- **Eventos transacionais (outbox)**: o evento é gravado na mesma transação da mudança; se a mudança for desfeita, o evento também é.
- **Só reage ao que acontece depois da ativação**; pausar cancela execuções em espera.
- **Versões imutáveis**: salvar cria uma nova versão; execuções em andamento terminam na versão em que começaram.
- **Sem duplicidade**: uma execução por evento e no máximo uma execução ativa por contato em cada automação.
- **Proteção contra laços**: eventos gerados por automações carregam profundidade; acima de 3 níveis são ignorados (testado com duas automações movendo o mesmo negócio entre etapas).
- **Limite**: 2.000 execuções por organização a cada 24h.
- **Cada passo na sua própria transação**, com registro (ok, pulado, parou, falhou, aguardando). Falhas temporárias (rede, 5xx) são re-tentadas até 3 vezes; falhas definitivas podem ser **reprocessadas a partir do passo que falhou**, sem repetir os anteriores.
- **Envios** passam pelas mesmas regras das campanhas: quem pediu para sair nunca recebe; template de marketing exige consentimento.
- **Webhook**: apenas https, bloqueio de endereços internos (proteção contra SSRF), assinatura HMAC no cabeçalho `X-Retoma-Signature` e `Idempotency-Key` por passo. Entrega “pelo menos uma vez”.
- **Simulação**: mostra o caminho para um contato sem executar nada.

### Limitações atuais
- Editor em lista de passos (sem ramificações paralelas em canvas); condições funcionam como filtros (param a execução).
- Webhook não suporta cabeçalhos personalizados nem respostas usadas nos passos seguintes.
