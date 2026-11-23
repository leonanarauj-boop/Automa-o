-- 0007_team_and_password.sql — Convites de equipe, redefinição de senha e registro de e-mails enviados.

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager','agent')),
  token_hash text not null unique,
  invited_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- só um convite pendente por e-mail em cada organização
create unique index invitations_pending_key on invitations (organization_id, lower(email)) where accepted_at is null and revoked_at is null;

create table password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  ip text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index password_resets_user_idx on password_resets (user_id, created_at desc);

-- Registro de envios (sem o corpo: links contêm tokens)
create table email_log (
  id bigserial primary key,
  organization_id uuid references organizations(id) on delete set null,
  to_address text not null,
  template text not null,
  status text not null check (status in ('sent','failed','not_configured')),
  error text,
  created_at timestamptz not null default now()
);

alter table invitations enable row level security;
create policy tenant_isolation on invitations using (organization_id = (select app_current_org())) with check (organization_id = (select app_current_org()));
grant select, insert, update on invitations to app_user;
-- memberships: gestores alteram papel/status pela aplicação (RLS já restringe à própria org)
