-- 0002_ai.sql — Copiloto de IA: configuração do assistente, catálogo, base de conhecimento (busca textual),
-- sugestões com aprovação humana e registro de custo por chamada.

create extension if not exists unaccent;

-- Configuração de busca em português sem acentos ("preco" encontra "preço").
do $$ begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_unaccent') then
    create text search configuration public.pt_unaccent (copy = portuguese);
    alter text search configuration public.pt_unaccent
      alter mapping for hword, hword_part, word with unaccent, portuguese_stem;
  end if;
end $$;

alter table organizations
  add column ai_enabled boolean not null default true,
  add column ai_monthly_credits int not null default 300 check (ai_monthly_credits >= 0);
grant update (ai_enabled) on organizations to app_user;

alter table contacts
  add column ai_summary text,
  add column ai_summary_updated_at timestamptz;

-- Um assistente por organização (configuração editável pelo gestor)
create table ai_agents (
  organization_id uuid primary key references organizations(id) on delete cascade,
  name text not null default 'Assistente',
  tone text not null default 'cordial e objetivo',
  formality text not null default 'neutral' check (formality in ('informal','neutral','formal')),
  business_description text,
  business_hours text,
  policies text,
  handoff_rules text,
  forbidden_topics text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Catálogo: fonte de verdade de preços para a IA
create table products_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  price_cents bigint check (price_cents is null or price_cents >= 0),
  price_type text not null default 'fixed' check (price_type in ('fixed','from','on_request')),
  duration_min int check (duration_min is null or duration_min > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_org_idx on products_services (organization_id, active);

create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  kind text not null default 'text' check (kind in ('text','faq')),
  content text not null,
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  position int not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('public.pt_unaccent'::regconfig, content)) stored
);
create index knowledge_chunks_tsv_idx on knowledge_chunks using gin (tsv);
create index knowledge_chunks_org_idx on knowledge_chunks (organization_id, document_id);

-- Sugestões da IA: nada é aplicado ou enviado sem decisão humana
create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  kind text not null check (kind in ('reply','analysis')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','accepted','accepted_edited','rejected','superseded')),
  created_by uuid references users(id) on delete set null,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_suggestions_conv_idx on ai_suggestions (organization_id, conversation_id, kind, created_at desc);

-- Registro de cada chamada (sem conteúdo das conversas): custo, latência, resultado
create table ai_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  feature text not null,
  provider text not null default 'anthropic',
  model text,
  status text not null default 'pending' check (status in ('pending','ok','refused','blocked','error')),
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  cost_micros bigint,
  latency_ms int,
  error text,
  created_at timestamptz not null default now()
);
create index ai_calls_org_month_idx on ai_calls (organization_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['ai_agents','products_services','knowledge_documents','knowledge_chunks','ai_suggestions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (organization_id = (select app_current_org())) with check (organization_id = (select app_current_org()))', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- ai_calls: usuários só leem (escrita exclusiva do serviço, que controla créditos)
alter table ai_calls enable row level security;
create policy tenant_read on ai_calls for select using (organization_id = (select app_current_org()));
grant select on ai_calls to app_user;
