# Cobrança e planos

## Planos (hipóteses de preço do planejamento — validar com clientes)
| Plano | Preço/mês | Usuários | Contatos | IA/mês | Automações ativas | Campanhas |
|---|---|---|---|---|---|---|
| Teste grátis (14 dias) | — | 3 | 1.000 | 300 | 10 | sim |
| Essencial | R$ 149 | 2 | 2.000 | — | 3 | não |
| Profissional | R$ 349 | 5 | 10.000 | 1.500 | 20 | sim |
| Empresa | R$ 799 | 12 | 50.000 | 5.000 | 100 | sim |

Definidos em `src/modules/billing/plans.ts`. Assinaturas guardam o preço contratado; mudar a tabela não altera clientes existentes. Mensagens do WhatsApp são pagas pelo cliente diretamente à Meta.

## Gateway: Asaas (API v3)
Verificado na documentação oficial (docs.asaas.com):
- Base: `https://api-sandbox.asaas.com/v3` (sandbox) e `https://api.asaas.com/v3` (produção); cabeçalhos `access_token` e `User-Agent`.
- `POST /customers` (name, cpfCnpj), `POST /subscriptions` (customer, billingType, value, nextDueDate, cycle=MONTHLY), `GET /subscriptions/{id}/payments` (com `invoiceUrl`), `DELETE /subscriptions/{id}`.
- **A atualização de assinatura não aceita alterar o valor**: troca de plano e fim de cupom criam uma nova assinatura e removem a anterior.
- Webhook autenticado pelo cabeçalho `asaas-access-token` (token de 32 a 255 caracteres definido na configuração do webhook); cada evento tem `id` (`evt_…`), usado para idempotência.

O pagamento (Pix, boleto ou cartão) acontece na **página de fatura do Asaas**: dados de cartão nunca passam pela plataforma.

## Regras
- **Durante o teste**, a primeira cobrança vence no fim do teste (o cliente pode pagar antes; o plano é liberado ao confirmar o pagamento).
- **Upgrade**: recursos liberados na hora; novo valor a partir do próximo vencimento (sem cobrança proporcional).
- **Downgrade**: só é aceito se o uso atual couber no plano menor; vale no fim do período pago.
- **Cupons** (gerenciados pela plataforma na tabela `coupons`): percentual, por N meses ou permanente, com limite de usos e validade. Ao fim dos meses, a assinatura passa ao preço cheio automaticamente.
- **Inadimplência**: fatura vencida → “pagamento pendente” com tudo funcionando por 7 dias → depois, **acesso restrito**: param envios, campanhas, automações, lembretes e IA. Mensagens recebidas de clientes **continuam sendo gravadas** (nada se perde). Pagar regulariza automaticamente.
- **Fim do teste sem assinatura paga** → acesso restrito.
- **Cancelamento**: remove a assinatura no gateway (sem novas cobranças); acesso até o fim do período pago.
- **Status calculado por função pura** (`computeOrgStatus`) a partir de assinatura, faturas e datas — eventos fora de ordem não corrompem o estado; uma fatura paga nunca volta a “vencida”.
- Limite de contatos vale para cadastro manual; contatos que chegam pelo WhatsApp nunca são bloqueados.

## Operação
1. Crie uma conta **sandbox** em sandbox.asaas.com, gere a API key e defina `ASAAS_API_KEY`, `ASAAS_ENV=sandbox`.
2. Configure o webhook no Asaas para `https://SEU_DOMINIO/api/webhooks/billing` com um token forte em `ASAAS_WEBHOOK_TOKEN`, eventos de cobrança, envio sequencial.
3. Cupom: `insert into coupons (code, percent_off, duration_months, max_redemptions) values ('FUNDADOR', 50, 3, 20);`
4. Só troque para `ASAAS_ENV=production` depois de validar todos os fluxos no sandbox.

## Ainda não implementado
Plano anual, nota fiscal de serviço, cobrança proporcional, painel administrativo para planos/cupons, retentativa de cartão com outro meio, exclusão automática de dados após cancelamento.
