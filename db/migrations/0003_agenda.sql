-- 0003_agenda.sql — Agenda: profissionais, horários, bloqueios, agendamentos sem conflito, lembretes e Radar.

create table professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  user_id uuid references users(id) on delete set null,
  color text not null default 'teal',
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index professionals_org_idx on professionals (organization_id, active);

-- Horário semanal de trabalho (interpretado no fuso da organização). Vários intervalos por dia permitidos.
create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = domingo
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index availability_rules_prof_idx on availability_rules (professional_id, weekday);

-- Bloqueios (férias, almoço estendido, compromissos)
create table availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);
create index availability_exceptions_prof_idx on availability_exceptions (professional_id, starts_at);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete restrict,
  service_id uuid references products_services(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','canceled','no_show','done')),
  source text not null default 'manual' check (source in ('manual','demo')),
  notes text,
  cancel_reason text,
  confirmed_at timestamptz,
  confirmed_via text check (confirmed_via in ('user','whatsapp')),
  reminder_sent_at timestamptz,
  reminder_message_id uuid references messages(id) on delete set null,
  reminder_error text,
  rescheduled_from uuid references appointments(id) on delete set null,
  is_demo boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Garantia de consistência: dois agendamentos ativos do mesmo profissional nunca se sobrepõem,
  -- mesmo com requisições simultâneas (verificado pelo próprio Postgres).
  constraint appointments_no_overlap exclude using gist (
    professional_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('scheduled','confirmed'))
);
create index appointments_org_start_idx on appointments (organization_id, starts_at);
create index appointments_contact_idx on appointments (contact_id, starts_at desc);
create index appointments_reminder_idx on appointments (starts_at) where reminder_sent_at is null and status in ('scheduled','confirmed');

alter table organizations
  add column reminder_hours_before int not null default 24 check (reminder_hours_before between 1 and 168),
  add column reminder_template_id uuid references message_templates(id) on delete set null;
grant update (reminder_hours_before, reminder_template_id) on organizations to app_user;

-- Radar: novos tipos de alerta ligados à agenda
alter table opportunity_rules drop constraint opportunity_rules_kind_check;
alter table opportunity_rules add constraint opportunity_rules_kind_check
  check (kind in ('awaiting_reply','lead_silent','deal_stale','appointment_unconfirmed','no_show'));
alter table opportunity_signals drop constraint opportunity_signals_value_basis_check;
alter table opportunity_signals add constraint opportunity_signals_value_basis_check
  check (value_basis in ('deal_value','avg_ticket','service_price','unknown'));
alter table opportunity_signals add column appointment_id uuid references appointments(id) on delete cascade;

insert into opportunity_rules (organization_id, kind, threshold_hours)
select id, 'appointment_unconfirmed', 24 from organizations on conflict do nothing;
insert into opportunity_rules (organization_id, kind, threshold_hours)
select id, 'no_show', 24 from organizations on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['professionals','availability_rules','availability_exceptions','appointments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (organization_id = (select app_current_org())) with check (organization_id = (select app_current_org()))', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
