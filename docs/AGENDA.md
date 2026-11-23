# Agenda

## Funcionalidades
- Profissionais com horário semanal (até 2 intervalos por dia) e bloqueios (férias, compromissos).
- Visão do dia por profissional, com linha do horário atual; painel de detalhes do agendamento.
- Novo agendamento escolhendo entre **horários livres** calculados (a cada 15 min, pela duração do serviço). Gestores podem fazer **encaixe** fora do horário.
- Status: agendado → confirmado → atendido / faltou; cancelamento com motivo; **remarcação** que preserva o histórico (o original fica cancelado e o novo aponta para ele).
- **Lembrete automático pelo WhatsApp** com template aprovado, uma vez por agendamento, na antecedência configurada. Variáveis: {{1}} primeiro nome, {{2}} data, {{3}} horário, {{4}} profissional, {{5}} serviço. Não é enviado a quem pediu para sair.
- **Confirmação pela resposta**: “sim”, “confirmo”, “pode confirmar”… depois do lembrete confirmam o próximo agendamento. Cancelamentos nunca são automáticos.
- Radar: alerta de agendamento não confirmado perto do horário e de falta sem reagendamento.
- Ficha do cliente: histórico de agendamentos e contagem de faltas; painel: agendamentos de hoje e taxa de faltas.

## Garantias de consistência
- **Sem choque de horários, mesmo com cliques simultâneos:** restrição de exclusão no Postgres (`EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status in ('scheduled','confirmed')`). Teste: 20 pedidos ao mesmo tempo no mesmo horário → exatamente 1 é aceito.
- Remarcação é atômica: se o novo horário estiver ocupado, o agendamento original continua intacto.
- Horários são guardados em UTC e interpretados no fuso da organização (padrão `America/Sao_Paulo`).
- Lembretes usam `FOR UPDATE SKIP LOCKED` e marcam `reminder_sent_at` na mesma transação: nunca duplicam.

## Limitações atuais
- Interface exibe horários no fuso de São Paulo (o banco já suporta o fuso por organização).
- Sem lista de espera, sem visão semanal/mensal, sem sincronização com Google Calendar (próximas entregas).
- Agendamento pela IA ainda não existe (a IA só sugere textos).
