-- 0004_campaigns_automations.sql — Campanhas com consentimento/aprovação e motor de automações.

alter table organizations
  add column daily_template_limit int not null default 250 check (daily_template_limit between 0 and 100000),
  add column campaign_frequency_days int not null default 7 check (campaign_frequency_days between 0 and 90);

-- ---------------------------------------------------------------------------------------------
-- Campanhas
-- ---------------------------------------------------------------------------------------------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  template_id uuid references message_templates(id) on delete set null,
  param_mapping jsonb not null default '[]',
  segment jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft','pending_approval','scheduled','sending','done','canceled')),
  scheduled_at timestamptz,
  max_recipients int not null default 1000 check (max_recipients between 1 and 100000),
  created_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_org_idx on campaigns (organization_id, status, scheduled_at);

create table campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status text not null check (status in ('queued','skipped','canceled')),
  skip_reason text,
  message_id uuid references messages(id) on delete set null,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index campaign_recipients_unique on campaign_recipients (campaign_id, contact_id) where not is_test;
create index campaign_recipients_contact_idx on campaign_recipients (contact_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Eventos de domínio (outbox) que alimentam as automações
-- ---------------------------------------------------------------------------------------------
create table domain_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null,
  contact_id uuid references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  payload jsonb not null default '{}',
  depth int not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index domain_events_pending_idx on domain_events (id) where processed_at is null;

-- ---------------------------------------------------------------------------------------------
-- Automações (versionadas e imutáveis por versão)
-- ---------------------------------------------------------------------------------------------
create table automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused')),
  trigger_type text not null,
  current_version_id uuid,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automations_org_trigger_idx on automations (organization_id, status, trigger_type);

create table automation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  version int not null,
  definition jsonb not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (automation_id, version)
);
alter table automations add constraint automations_current_version_fk foreign key (current_version_id) references automation_versions(id) on delete set null;

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  version_id uuid not null references automation_versions(id) on delete cascade,
  event_key text not null,
  contact_id uuid references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  depth int not null default 0,
  status text not null default 'running' check (status in ('running','waiting','succeeded','stopped','failed','canceled')),
  current_step int not null default 0,
  resume_at timestamptz not null default now(),
  attempts int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (version_id, event_key)
);
-- Um contato só tem uma execução ativa por automação (evita duplicidade e laços)
create unique index workflow_runs_one_active on workflow_runs (automation_id, contact_id) where status in ('running','waiting');
create index workflow_runs_due_idx on workflow_runs (resume_at) where status in ('running','waiting');
create index workflow_runs_automation_idx on workflow_runs (automation_id, started_at desc);

create table workflow_run_steps (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  step_index int not null,
  step_type text not null,
  status text not null check (status in ('ok','stopped','failed','waiting','skipped')),
  detail text,
  created_at timestamptz not null default now()
);
create index workflow_run_steps_run_idx on workflow_run_steps (run_id, id);

do $$
declare t text;
begin
  foreach t in array array['campaigns','campaign_recipients','automations','automation_versions','workflow_runs','workflow_run_steps','domain_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (organization_id = (select app_current_org())) with check (organization_id = (select app_current_org()))', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
grant usage on sequence domain_events_id_seq, workflow_run_steps_id_seq to app_user;
grant update (daily_template_limit, campaign_frequency_days) on organizations to app_user;

-- Enfileiramento de envio com horário opcional, utilizável tanto pelo usuário (com RLS) quanto pelo serviço.
-- Para o papel app_user, a mensagem precisa pertencer à organização da sessão.
drop function if exists app_enqueue_message_send(uuid);
create or replace function app_enqueue_message_send(p_message_id uuid, p_run_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from messages where id = p_message_id and status = 'pending' and direction = 'outbound';
  if v_org is null then raise exception 'mensagem inválida'; end if;
  if current_setting('role', true) = 'app_user' and v_org is distinct from app_current_org() then
    raise exception 'mensagem inválida para este tenant';
  end if;
  insert into jobs (type, payload, run_at) values ('whatsapp.send', jsonb_build_object('messageId', p_message_id, 'orgId', v_org), coalesce(p_run_at, now()));
end $$;
revoke all on function app_enqueue_message_send(uuid, timestamptz) from public;
grant execute on function app_enqueue_message_send(uuid, timestamptz) to app_user;
