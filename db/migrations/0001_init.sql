-- 0001_init.sql — Fundação multi-tenant, CRM, caixa de entrada, WhatsApp, Radar, filas e auditoria.
--
-- Modelo de isolamento:
--   * O usuário dono do schema (DATABASE_URL) aplica migrations e é usado APENAS por código de
--     serviço (webhooks, worker, cadastro), que sempre filtra por organization_id explicitamente.
--   * Requisições de usuários rodam dentro de uma transação com `SET LOCAL ROLE app_user` e as
--     variáveis app.user_id / app.org_id. app_user NÃO ignora RLS.
--   * Toda tabela com organization_id tem RLS habilitado e política baseada em app_current_org(),
--     que só retorna a organização se o usuário for membro ativo dela.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin nobypassrls;
  end if;
end $$;

grant app_user to current_user;
grant usage on schema public to app_user;

-- ---------------------------------------------------------------------------------------------
-- Identidade (globais, acessadas somente por código de serviço)
-- ---------------------------------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment text not null,
  timezone text not null default 'America/Sao_Paulo',
  plan text not null default 'trial',
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','canceled')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  active_org_id uuid references organizations(id) on delete set null,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

create table auth_attempts (
  id bigserial primary key,
  email text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index auth_attempts_email_idx on auth_attempts (lower(email), created_at desc);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','manager','agent')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- Função de contexto: só devolve a org se o usuário corrente for membro ativo.
create or replace function app_current_org() returns uuid
language sql stable security definer set search_path = public as $$
  select m.organization_id
  from memberships m
  where m.organization_id = nullif(current_setting('app.org_id', true), '')::uuid
    and m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    and m.status = 'active'
$$;
revoke all on function app_current_org() from public;
grant execute on function app_current_org() to app_user;

-- ---------------------------------------------------------------------------------------------
-- Canais (WhatsApp Cloud API)
-- ---------------------------------------------------------------------------------------------
create table channel_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null default 'meta_cloud' check (provider in ('meta_cloud')),
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone text,
  access_token_encrypted text not null,
  status text not null default 'active' check (status in ('active','disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index channel_accounts_org_idx on channel_accounts (organization_id);

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  provider_template_id text,
  name text not null,
  language text not null,
  category text not null,
  status text not null,
  body_text text,
  body_param_count int not null default 0,
  synced_at timestamptz not null default now(),
  unique (channel_account_id, name, language)
);

-- ---------------------------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  display_name text not null,
  phone_e164 text,
  wa_id text,
  email text,
  company text,
  source text not null default 'manual',
  notes text,
  owner_user_id uuid references users(id) on delete set null,
  temperature text check (temperature in ('cold','warm','hot')),
  is_demo boolean not null default false,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index contacts_org_wa_key on contacts (organization_id, wa_id) where wa_id is not null and deleted_at is null;
create unique index contacts_org_phone_key on contacts (organization_id, phone_e164) where phone_e164 is not null and deleted_at is null;
create index contacts_org_created_idx on contacts (organization_id, created_at desc);

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel text not null default 'whatsapp',
  purpose text not null check (purpose in ('service','marketing')),
  status text not null check (status in ('granted','revoked')),
  source text not null,
  evidence text,
  recorded_by uuid references users(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index consent_contact_idx on consent_records (organization_id, contact_id, purpose, recorded_at desc);

create table tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  color text not null default 'slate',
  unique (organization_id, name)
);

create table contact_tags (
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (contact_id, tag_id)
);

create table pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  name text not null,
  position int not null,
  kind text not null default 'open' check (kind in ('open','won','lost')),
  unique (pipeline_id, position) deferrable initially deferred
);

create table deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  pipeline_id uuid not null references pipelines(id) on delete restrict,
  stage_id uuid not null references pipeline_stages(id) on delete restrict,
  owner_user_id uuid references users(id) on delete set null,
  title text not null,
  value_cents bigint not null default 0 check (value_cents >= 0),
  currency char(3) not null default 'BRL',
  status text not null default 'open' check (status in ('open','won','lost')),
  lost_reason text,
  won_at timestamptz,
  is_demo boolean not null default false,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_org_stage_idx on deals (organization_id, stage_id);
create index deals_org_status_idx on deals (organization_id, status, last_activity_at);

create table deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  from_stage_id uuid references pipeline_stages(id) on delete set null,
  to_stage_id uuid not null references pipeline_stages(id) on delete cascade,
  changed_by uuid references users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  assignee_user_id uuid references users(id) on delete set null,
  title text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done')),
  created_by_type text not null default 'user' check (created_by_type in ('user','system','ai')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_org_status_idx on tasks (organization_id, status, due_at);

create table contact_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Conversas e mensagens
-- ---------------------------------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_account_id uuid references channel_accounts(id) on delete set null,
  status text not null default 'open' check (status in ('open','closed')),
  assignee_user_id uuid references users(id) on delete set null,
  service_window_expires_at timestamptz,
  last_message_at timestamptz,
  unread_count int not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index conversations_contact_channel_key on conversations (organization_id, contact_id, coalesce(channel_account_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index conversations_org_last_idx on conversations (organization_id, status, last_message_at desc);

create table messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender_type text not null check (sender_type in ('contact','user','system','ai')),
  sender_user_id uuid references users(id) on delete set null,
  type text not null default 'text',
  body text,
  payload jsonb,
  template_id uuid references message_templates(id) on delete set null,
  provider_message_id text unique,
  status text not null default 'pending' check (status in ('pending','sent','delivered','read','failed','received')),
  error text,
  idempotency_key text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index messages_conv_idx on messages (conversation_id, sent_at);

-- ---------------------------------------------------------------------------------------------
-- Radar de oportunidades
-- ---------------------------------------------------------------------------------------------
create table opportunity_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('awaiting_reply','lead_silent','deal_stale')),
  threshold_hours int not null check (threshold_hours > 0),
  active boolean not null default true,
  unique (organization_id, kind)
);

create table opportunity_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_kind text not null,
  contact_id uuid not null references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  potential_value_cents bigint,
  value_basis text not null check (value_basis in ('deal_value','avg_ticket','unknown')),
  recovered_value_cents bigint,
  reason text not null,
  recommended_action text not null,
  status text not null default 'open' check (status in ('open','dismissed','resolved','recovered')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);
-- Apenas um sinal aberto por regra/contato/negócio
create unique index signals_open_key on opportunity_signals (organization_id, rule_kind, contact_id, coalesce(deal_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';
create index signals_org_status_idx on opportunity_signals (organization_id, status);

-- ---------------------------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------------------------
create table audit_logs (
  id bigserial primary key,
  organization_id uuid references organizations(id) on delete cascade,
  actor_type text not null check (actor_type in ('user','system','platform_admin')),
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_org_idx on audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Infra: eventos de webhook e fila de jobs (globais, somente service)
-- ---------------------------------------------------------------------------------------------
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  dedupe_key text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, dedupe_key)
);

create table jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_ready_idx on jobs (run_at) where status = 'queued';

-- ---------------------------------------------------------------------------------------------
-- RLS em todas as tabelas com organization_id + permissões do app_user
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'organization_id' and tb.table_type = 'BASE TABLE'
      and c.table_name not in ('audit_logs')
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (organization_id = (select app_current_org())) with check (organization_id = (select app_current_org()))', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- audit_logs: usuário só lê e insere na própria org (não altera/apaga)
alter table audit_logs enable row level security;
create policy audit_read on audit_logs for select using (organization_id = (select app_current_org()));
create policy audit_insert on audit_logs for insert with check (organization_id = (select app_current_org()));
grant select, insert on audit_logs to app_user;
grant usage on sequence audit_logs_id_seq to app_user;

-- organizations: usuário lê e atualiza somente a própria org
alter table organizations enable row level security;
create policy org_self_read on organizations for select using (id = (select app_current_org()));
create policy org_self_update on organizations for update using (id = (select app_current_org())) with check (id = (select app_current_org()));
grant select, update (name, timezone, updated_at) on organizations to app_user;

-- users: app_user pode ver nome/e-mail dos colegas da org atual (sem hash de senha)
grant select (id, email, full_name) on users to app_user;
alter table users enable row level security;
create policy users_same_org on users for select using (
  exists (select 1 from memberships m where m.user_id = users.id and m.organization_id = (select app_current_org()))
);

-- Tabelas globais (sessions, auth_attempts, webhook_events, jobs) não recebem grant para app_user.
-- channel_accounts: o token criptografado não é legível pelo app_user.
revoke select on channel_accounts from app_user;
grant select (id, organization_id, provider, waba_id, phone_number_id, display_phone, status, created_at, updated_at) on channel_accounts to app_user;

-- Enfileira o envio de uma mensagem da própria organização. SECURITY DEFINER para que o app_user
-- não precise de acesso à tabela global de jobs; valida que a mensagem pertence ao tenant atual.
create or replace function app_enqueue_message_send(p_message_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from messages where id = p_message_id and status = 'pending' and direction = 'outbound';
  if v_org is null or v_org is distinct from app_current_org() then
    raise exception 'mensagem inválida para este tenant';
  end if;
  insert into jobs (type, payload) values ('whatsapp.send', jsonb_build_object('messageId', p_message_id, 'orgId', v_org));
end $$;
revoke all on function app_enqueue_message_send(uuid) from public;
grant execute on function app_enqueue_message_send(uuid) to app_user;
