-- 0009_mfa_admin.sql — Verificação em duas etapas (TOTP), política por organização e administradores da plataforma.

alter table users
  add column mfa_secret_encrypted text,
  add column mfa_pending_secret_encrypted text,
  add column mfa_enabled_at timestamptz,
  add column mfa_last_step bigint;

create table mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index mfa_recovery_user_idx on mfa_recovery_codes (user_id) where used_at is null;

-- Desafio entre a senha correta e o código de verificação (curta duração, tentativas limitadas)
create table mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  active_org_id uuid references organizations(id) on delete set null,
  next_path text,
  attempts int not null default 0,
  user_agent text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table sessions add column mfa_verified_at timestamptz;

alter table organizations add column require_mfa boolean not null default false;
grant update (require_mfa) on organizations to app_user;

-- Administradores da plataforma (equipe do SaaS), separados dos papéis das organizações
create table platform_admins (
  user_id uuid primary key references users(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now()
);
