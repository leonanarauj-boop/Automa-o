-- Sinal de vida dos workers (monitoramento: /api/health e painel da plataforma).
create table worker_heartbeats (
  id text primary key,
  started_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  version text
);
