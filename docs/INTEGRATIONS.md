# Integrações

## WhatsApp Business Platform — Cloud API
Implementação: `src/modules/whatsapp/*`. Versão da Graph API configurável em `META_GRAPH_VERSION` (padrão `v23.0`; atualize quando a Meta descontinuar a versão).

| Operação | Endpoint oficial | Uso |
|---|---|---|
| Enviar mensagem | `POST /{phone-number-id}/messages` | texto (`type: text`) e template (`type: template`) |
| Listar templates | `GET /{waba-id}/message_templates` | sincronização |
| Dados do número | `GET /{phone-number-id}?fields=display_phone_number,verified_name` | validar credenciais ao conectar |
| Webhook | `GET` verificação (`hub.mode`, `hub.verify_token`, `hub.challenge`) e `POST` eventos com `X-Hub-Signature-256` | recebimento de mensagens e status |

Regras aplicadas no código: janela de atendimento de 24h para texto livre; fora dela somente templates `APPROVED`; descadastro bloqueia templates; status só avança (`sent → delivered → read`, `failed` prevalece); erros 5xx/429 são re-tentados com backoff, demais marcam a mensagem como falha.

Limitações conhecidas: sem histórico anterior à conexão; mídia recebida é registrada como texto descritivo (download de mídia pendente); não existe API oficial para publicar Status; política da Meta (jan/2026) proíbe assistentes de IA de propósito geral — a IA futura será restrita ao negócio do cliente.

Próximo passo: Embedded Signup (requer app aprovado como Tech Provider).
