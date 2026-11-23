# Guia de publicação — staging e produção

> Comece sempre por **staging** (ambiente de testes com contas sandbox). Produção é uma cópia do mesmo processo com contas e chaves próprias, depois do checklist final.
> Painéis de fornecedores mudam com frequência: se um nome de menu não bater, procure a função equivalente na documentação oficial do serviço.

## 0. Visão geral

```
                ┌──────────────────────────┐
 Clientes ─────▶│ App Next.js (Vercel)     │──┐  /api/webhooks/whatsapp  ◀── Meta
 (navegador)    │ telas + API + webhooks   │  │  /api/webhooks/billing   ◀── Asaas
                └──────────────────────────┘  │  /api/health             ◀── monitor
                                              ▼
                                   ┌─────────────────────┐
                                   │ PostgreSQL          │
                                   │ (Supabase, São Paulo)│
                                   └─────────────────────┘
                                              ▲
                ┌──────────────────────────┐  │
                │ Worker (Fly.io, São Paulo)│──┘──▶ Meta Cloud API · Anthropic · Asaas · SMTP
                │ fila, automações, envios │
                └──────────────────────────┘
```

| Peça | Recomendação | Alternativas | Por quê |
|---|---|---|---|
| Banco | **Supabase** (região São Paulo) | Neon, RDS, Cloud SQL | Postgres gerenciado com backups, extensões necessárias e pooler; só usamos o banco (sem o SDK do Supabase) |
| App | **Vercel** | Render, Railway, Fly.io | Melhor suporte a Next.js, deploy por branch |
| Worker | **Fly.io** (região `gru`) | Railway, Render (worker) | Processo contínuo perto do banco; usa o `Dockerfile.worker` |
| E-mail | **Amazon SES** (sa-east-1) ou **Resend** | Brevo, Postmark | Qualquer um com SMTP |
| Monitor | UptimeRobot / Better Stack | — | Chama `/api/health` |

Ordem: **1** segredos → **2** banco → **3** app → **4** worker → **5** primeiro acesso → **6** Meta → **7** Anthropic → **8** Asaas → **9** e-mail → **10** monitor → **11** verificação.

---

## 1. Gerar os segredos

Gere localmente e guarde num gerenciador de senhas (um conjunto para staging e **outro** para produção):

```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('META_WEBHOOK_VERIFY_TOKEN=' + require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('ASAAS_WEBHOOK_TOKEN=' + require('crypto').randomBytes(36).toString('base64url'))"
```

- **ENCRYPTION_KEY** protege os tokens da Meta e os segredos da verificação em duas etapas. **Se for perdida, esses dados não podem mais ser lidos** (clientes teriam de reconectar o WhatsApp e reativar a verificação). Nunca troque sem um plano de migração.
- O token do Asaas precisa ter de 32 a 255 caracteres, sem espaços, e ser diferente da API key.

## 2. Banco (Supabase)

1. Crie um projeto na região **South America (São Paulo)** com senha forte.
2. Em *Connect*, copie duas URLs:
   - **Direta** (porta 5432) → usada para **migrações** e pelo **worker**.
   - **Pooler em modo transação** (porta 6543) → usada pelo **app na Vercel** (`DB_POOL_MAX=3`). O sistema é compatível: o contexto de cada empresa é definido por transação.
3. Aplique as migrações a partir do seu computador:
   ```bash
   npm ci
   npm run db:migrate -- "postgres://...URL_DIRETA..."
   ```
   Elas criam o papel `app_user` (sujeito ao isolamento entre empresas) e as extensões `pgcrypto`, `btree_gist` e `unaccent`.
4. Backups: confirme no plano contratado a retenção e, para produção, ative a recuperação a um ponto no tempo (PITR). Faça um teste de restauração antes de abrir para clientes.
5. Não habilite nem distribua as chaves públicas da API do Supabase: o navegador nunca acessa o banco diretamente.

## 3. App (Vercel)

1. Importe o repositório do GitHub. Framework: Next.js (detectado). Para staging, use a branch de desenvolvimento como *Production Branch* do projeto de staging, ou um projeto separado.
2. Região das funções: **São Paulo (`gru1`)** — já definida em `vercel.json` (confirme se o seu plano permite escolher a região; senão, ajuste no painel).
3. Variáveis de ambiente:

| Variável | Staging | Observação |
|---|---|---|
| `DATABASE_URL` | URL do **pooler** (6543) | |
| `DB_POOL_MAX` | `3` | serverless |
| `APP_URL` | `https://staging.seudominio.com.br` | sem barra no fim |
| `ENCRYPTION_KEY` | do passo 1 | **mesma** do worker |
| `META_APP_SECRET` | do passo 6 | |
| `META_WEBHOOK_VERIFY_TOKEN` | do passo 1 | |
| `META_GRAPH_VERSION` | `v23.0` | atualize quando a Meta descontinuar |
| `ANTHROPIC_API_KEY` | do passo 7 | opcional (sem ela, a IA fica desligada) |
| `AI_MODEL` | `claude-opus-5-5` | |
| `ASAAS_API_KEY` | do passo 8 (sandbox) | |
| `ASAAS_ENV` | `sandbox` | |
| `ASAAS_WEBHOOK_TOKEN` | do passo 1 | |
| `SMTP_URL` | do passo 9 | |
| `EMAIL_FROM` | `Retoma <nao-responda@seudominio.com.br>` | domínio verificado |

4. Domínio: aponte `staging.seudominio.com.br` para a Vercel (o HTTPS é automático).
5. Deploy. Teste: `https://staging.../api/health` deve responder `degraded` (o worker ainda não existe) — isso confirma que o app enxerga o banco.

## 4. Worker (Fly.io)

```bash
fly auth login
fly launch --no-deploy --copy-config --config fly.worker.toml --name retoma-worker-staging
fly secrets set --config fly.worker.toml \
  DATABASE_URL="postgres://...URL_DIRETA..." ENCRYPTION_KEY="..." APP_URL="https://staging..." \
  META_APP_SECRET="..." META_WEBHOOK_VERIFY_TOKEN="..." META_GRAPH_VERSION="v23.0" \
  ANTHROPIC_API_KEY="..." AI_MODEL="claude-opus-5-5" \
  ASAAS_API_KEY="..." ASAAS_ENV="sandbox" ASAAS_WEBHOOK_TOKEN="..." \
  SMTP_URL="..." EMAIL_FROM="..."
fly deploy --config fly.worker.toml
fly logs --config fly.worker.toml   # deve aparecer "worker iniciado"
```

- Variáveis: as **mesmas do app**, exceto `DATABASE_URL` (aqui a URL **direta**, processo de longa duração) e `DB_POOL_MAX=5`.
- Uma máquina basta. Mais máquinas são seguras (a fila não entrega o mesmo job duas vezes), úteis para volume ou redundância.
- Em Railway/Render: crie um serviço do tipo *worker* a partir do `Dockerfile.worker` com as mesmas variáveis.
- A imagem `Dockerfile.worker` não foi construída no ambiente de desenvolvimento usado até aqui (sem Docker disponível); o primeiro `fly deploy` é o teste dela.
- Depois de 1 minuto, `/api/health` deve responder `ok`.

## 5. Primeiro acesso e administrador

1. Abra `https://staging.../signup` e crie a sua conta (ela cria também uma empresa, que você pode usar como conta interna).
2. Conceda acesso ao painel da plataforma:
   ```bash
   DATABASE_URL="...URL_DIRETA..." npm run admin:grant -- seu@email.com
   ```
3. Entre, vá em **Configurações → Segurança → Ativar** a verificação em duas etapas e guarde os códigos de recuperação.
4. Acesse `/admin`. Sem a verificação ativa, o painel não abre.

## 6. WhatsApp (Meta — WhatsApp Business Platform)

1. **Portfólio empresarial** (Meta Business) com a empresa **verificada** (CNPJ e documentos). A verificação pode levar dias: comece cedo.
2. Em *developers.facebook.com*, crie um app do tipo **Business** e adicione o produto **WhatsApp**. A Meta fornece um **número de teste** — use-o em staging.
3. **App Secret**: em configurações básicas do app → `META_APP_SECRET`.
4. **Token permanente**: no Gerenciador de Negócios, crie um **usuário do sistema** (admin), atribua o app e a conta do WhatsApp, e gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Esse token é informado **na tela do sistema**, não em variável de ambiente.
5. **Webhook** (WhatsApp → Configuração):
   - URL de retorno: `https://staging.../api/webhooks/whatsapp`
   - Token de verificação: o `META_WEBHOOK_VERIFY_TOKEN`
   - Assine o campo **messages**.
6. No sistema: **Configurações → WhatsApp** → informe o ID da conta (WABA), o ID do número e o token. O sistema valida com a Meta antes de salvar.
7. **Templates**: crie no Gerenciador do WhatsApp (ex.: lembrete de agendamento, categoria *Utilidade*; retomada, categoria *Marketing*), aguarde aprovação e clique em **Sincronizar**.
8. Teste: mande uma mensagem do seu celular para o número → ela aparece em **Conversas** em segundos.
9. Para clientes reais: cada cliente usa a própria conta do WhatsApp (formulário atual). A conexão em um clique (*Embedded Signup*) exige aprovação do app como **Tech Provider** — processo da Meta a iniciar quando o produto for aberto.

## 7. IA (Anthropic)

1. Em *console.anthropic.com*, crie uma organização/workspace e uma **API key** só para este ambiente.
2. Defina um **limite de gastos** mensal no console (proteção extra além dos créditos por plano do sistema).
3. `ANTHROPIC_API_KEY` no app **e** no worker. Teste real: `ANTHROPIC_API_KEY=... npm run ai:smoke` (2 chamadas pequenas).
4. Atualize a Política de Privacidade: a Anthropic processa trechos de conversas quando a IA é usada (ver `docs/LGPD.md`).

## 8. Pagamentos (Asaas)

**Staging (sandbox):**
1. Crie uma conta em **sandbox.asaas.com** (separada da conta de produção) e gere a **API key**.
2. `ASAAS_API_KEY`, `ASAAS_ENV=sandbox`, `ASAAS_WEBHOOK_TOKEN` no app e no worker.
3. No painel do Asaas, em integrações → **Webhooks**, crie um webhook:
   - URL: `https://staging.../api/webhooks/billing`
   - Token de autenticação: o `ASAAS_WEBHOOK_TOKEN`
   - Eventos de **cobranças**; envio **sequencial**; versão da API v3.
4. Teste em **Assinatura**: escolha um plano com CPF/CNPJ de teste válido → você é levado à fatura do Asaas. No sandbox, confirme o pagamento pelo painel do Asaas (opção de simular/confirmar recebimento da cobrança — veja a documentação de sandbox) → em segundos o plano fica **Ativo**.
5. Teste também: fatura vencida (status pendente → acesso restrito após 7 dias), troca de plano e cancelamento.

**Produção:** conta real aprovada no Asaas, nova API key, `ASAAS_ENV=production`, **novo** token e **novo** webhook apontando para o domínio de produção.

## 9. E-mail (SMTP)

1. Escolha o provedor (Amazon SES na região de São Paulo, Resend, Brevo…).
2. **Verifique o domínio** de envio e publique no DNS os registros de **SPF**, **DKIM** e **DMARC** indicados pelo provedor (sem isso, convites e redefinições caem no spam).
3. Gere credenciais SMTP e monte: `SMTP_URL=smtps://USUARIO:SENHA@smtp.provedor.com:465` (caracteres especiais da senha precisam de *URL encoding*).
4. `EMAIL_FROM` com endereço do domínio verificado.
5. Teste: convide alguém em **Configurações → Equipe** e use **Esqueci minha senha**. Falhas aparecem em `/admin/saude`.

## 10. Monitoramento

- Monitor externo em `https://.../api/health` a cada 1–5 min, alertando quando não for 200 (`503` = banco fora ou worker sem sinal há mais de 2 minutos).
- Logs: Vercel (app) e `fly logs` (worker); ambos em JSON.
- `/admin`: worker, jobs com falha, erros de webhook, pagamentos e e-mail.

## 11. Verificação antes de liberar

```bash
# com as variáveis do ambiente carregadas (ex.: arquivo .env.staging)
npm run check:env                  # staging
npm run check:env -- --production  # exige tudo o que produção precisa
```

Roteiro manual (staging):
- [ ] Cadastro, login, verificação em duas etapas, "esqueci minha senha" (e-mail chega)
- [ ] Convite de atendente (e-mail chega, link funciona uma vez)
- [ ] WhatsApp: receber, responder, status entregue/lido, template fora da janela, "SAIR"
- [ ] IA: sugestão de resposta e análise (com catálogo cadastrado)
- [ ] Agenda: agendar, lembrete com template, resposta "sim" confirma
- [ ] Automação "Novo lead" e campanha para contato com consentimento
- [ ] Assinatura no sandbox: pagar, troca de plano, cancelar
- [ ] `/api/health` = 200 e alerta do monitor testado (pare o worker por 3 min)

## 12. De staging para produção

Repita os passos 1–10 com **outro** banco, **outros** segredos e contas de produção. Antes de abrir:
- [ ] Revisão jurídica: Termos, Política de Privacidade, DPA, suboperadores (Anthropic, Asaas, provedor de e-mail, hospedagem)
- [ ] Empresa verificada na Meta; números de clientes com nome de exibição aprovado
- [ ] Asaas em produção e webhook de produção
- [ ] Backups com PITR e um teste de restauração feito
- [ ] `npm run check:env -- --production` sem erros
- [ ] Integração contínua verde (`.github/workflows/ci.yml`)
- [ ] Administrador(es) com verificação em duas etapas; `ENCRYPTION_KEY` guardada fora do provedor

## 13. Operação

- **Atualizações:** aplique as migrações **antes** de publicar o código novo (`npm run db:migrate -- URL_DIRETA`). As migrações são aditivas; evite remover colunas no mesmo deploy em que o código deixa de usá-las.
- **Ordem do deploy:** migrações → worker → app.
- **Rollback:** volte o app e o worker para a versão anterior (Vercel: *Promote* do deploy antigo; Fly: `fly deploy --image` da versão anterior). Migrações aditivas não precisam ser desfeitas.
- **Rotação de chaves:** tokens da Meta e chaves de API podem ser trocados a qualquer momento. `ENCRYPTION_KEY` exige migração dos dados criptografados (ainda não automatizada).

## 14. Custos mensais aproximados (staging pequeno)

> Valores aproximados de referência; confirme nas páginas de preço antes de contratar.

| Serviço | Faixa | Observação |
|---|---|---|
| Supabase | gratuito a ~US$ 25 | produção: plano pago (backups, sem pausa por inatividade) |
| Vercel | gratuito a ~US$ 20 | uso comercial exige plano pago |
| Fly.io (worker) | ~US$ 2–5 | 1 máquina pequena |
| E-mail | gratuito no início | cobrado por volume |
| Anthropic | por uso | limitado pelos créditos por plano e pelo limite do console |
| Asaas | por transação | sem mensalidade para começar |
| Meta (WhatsApp) | por mensagem | pago por cada cliente na própria conta |
