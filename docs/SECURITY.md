# Segurança

## Controles implementados
| Risco | Controle | Onde |
|---|---|---|
| Vazamento entre empresas | RLS em todas as tabelas com `organization_id`; `app_current_org()` só aceita membros ativos; testes automáticos que falham se uma tabela nova não tiver RLS | `db/migrations/0001_init.sql`, `tests/integration/tenancy.test.ts` |
| Senhas | scrypt (N=16384, r=8, p=1, salt 16 bytes); mínimo 10 caracteres | `src/lib/crypto.ts` |
| Força bruta | Bloqueio após 5 falhas por e-mail em 15 minutos | `src/modules/auth/service.ts` |
| Sequestro de sessão | Token aleatório de 256 bits; banco guarda só o SHA-256; cookie httpOnly, SameSite=Lax, Secure em produção; expiração 30 dias | `src/lib/session.ts` |
| CSRF | Server actions do Next.js verificam a origem; cookies SameSite | framework |
| Tokens da Meta | AES-256-GCM com chave em variável de ambiente; coluna inacessível ao papel `app_user`; nunca enviados ao navegador | `src/lib/crypto.ts`, `channel.ts` |
| Webhooks forjados | HMAC-SHA256 (`X-Hub-Signature-256`) com comparação em tempo constante; limite de 1 MB | `signature.ts`, `route.ts` |
| Injeção SQL | Somente consultas parametrizadas | todo o código |
| Entradas inválidas | Validação com zod em todas as ações | módulos |
| Clickjacking/MIME | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | `next.config.ts` |
| Webhook de pagamento forjado | Token do cabeçalho `asaas-access-token` comparado em tempo constante; eventos deduplicados pelo `id` | `api/webhooks/billing/route.ts` |
| Dados de cartão | Nunca trafegam pela plataforma: pagamento na página de fatura do gateway | `billing/` |
| Rastreabilidade | `audit_logs` (append-only para usuários) em ações sensíveis | `modules/audit` |

## Pendências conhecidas (antes do lançamento)
- Rate limiting por IP nas rotas públicas e no webhook (hoje só por e-mail no login).
- MFA para donos/gestores; recuperação de senha; revogação de sessões pela interface.
- Content-Security-Policy estrita.
- Rotação da `ENCRYPTION_KEY` (formato `v1.` já prevê versionamento).
- Papel dono do banco sem superusuário em produção; backups e PITR no provedor.
- Pentest externo.

## Reporte de vulnerabilidades
Enquanto não houver canal público, reporte diretamente aos mantenedores do repositório.
