-- 0010_admin.sql — Controles administrativos da plataforma.
alter table organizations
  add column ai_credits_override int check (ai_credits_override is null or ai_credits_override >= 0),
  add column admin_blocked_reason text;  -- bloqueio manual (abuso, fraude); não nulo = acesso restrito

create table admin_audit (
  id bigserial primary key,
  admin_user_id uuid references users(id) on delete set null,
  action text not null,
  organization_id uuid references organizations(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
