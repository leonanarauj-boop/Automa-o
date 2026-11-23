-- 0006_billing.sql — Assinaturas, faturas, cupons e eventos do gateway (Asaas).

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  plan_key text not null,
  status text not null default 'pending' check (status in ('pending','active','past_due','canceled')),
  gateway text not null default 'asaas',
  gateway_customer_id text,
  gateway_subscription_id text unique,
  billing_type text not null default 'UNDEFINED' check (billing_type in ('UNDEFINED','PIX','BOLETO','CREDIT_CARD')),
  price_cents bigint not null check (price_cents >= 0),
  coupon_code text,
  coupon_months_left int,
  customer_name text not null,
  customer_document text not null,
  customer_email text,
  current_period_end timestamptz,
  pending_plan_key text,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  gateway_payment_id text not null unique,
  gateway_subscription_id text,
  amount_cents bigint not null,
  status text not null check (status in ('pending','paid','overdue','refunded','canceled','chargeback')),
  billing_type text,
  due_date date not null,
  paid_at timestamptz,
  invoice_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_org_idx on invoices (organization_id, due_date desc);

-- Cupons são gerenciados pela plataforma (não pelos clientes)
create table coupons (
  code text primary key check (code = upper(code)),
  percent_off int not null check (percent_off between 1 and 100),
  duration_months int check (duration_months is null or duration_months > 0), -- null = enquanto durar a assinatura
  max_redemptions int,
  redeemed_count int not null default 0,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table billing_events (
  id text primary key,                -- id do evento no gateway (idempotência)
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

alter table subscriptions enable row level security;
create policy tenant_read on subscriptions for select using (organization_id = (select app_current_org()));
grant select on subscriptions to app_user;
alter table invoices enable row level security;
create policy tenant_read on invoices for select using (organization_id = (select app_current_org()));
grant select on invoices to app_user;
-- coupons e billing_events: somente serviço
