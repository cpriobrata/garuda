-- Garuda production schema for Supabase Postgres.
-- Apply with the Supabase CLI after reviewing vector dimensions and retention policy.
-- The local Go demo intentionally uses its zero-dependency JSON store instead.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;
create schema if not exists app;

-- Business tables are server-only. Add `app` to the Supabase API exposed schemas
-- for the Edge Functions, but keep browser roles unprivileged.
revoke all on schema app from anon, authenticated;
grant usage on schema app to service_role;
alter default privileges in schema app revoke all on tables from anon, authenticated;
alter default privileges in schema app grant all on tables to service_role;
alter default privileges in schema app grant usage, select on sequences to service_role;

create or replace function app.current_organization_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_organization_id', true), '')::uuid
$$;

create or replace function app.set_current_organization(target uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.current_organization_id', target::text, true);
end
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end
$$;

create table app.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table app.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table app.organization_members (
  organization_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx on app.organization_members (user_id, organization_id);

create table app.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references app.organizations(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan_code text not null default 'starter_17',
  status text not null default 'incomplete' check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_event_created_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table app.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references app.organizations(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'generating', 'completed', 'failed')),
  answers jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  generated_agent_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table app.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft', 'generating', 'published', 'archived')),
  revision integer not null default 1 check (revision > 0),
  draft_config jsonb not null default '{}'::jsonb,
  public_key text not null unique,
  current_version integer,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id)
);

alter table app.onboarding_sessions
  add constraint onboarding_generated_agent_fk
  foreign key (organization_id, generated_agent_id)
  references app.agents(organization_id, id)
  deferrable initially deferred;

create index agents_organization_status_idx on app.agents (organization_id, status, updated_at desc);

create table app.agent_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  version integer not null check (version > 0),
  config jsonb not null,
  content_checksum text not null,
  published_by uuid references auth.users(id),
  published_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, agent_id, version),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id) on delete cascade
);

create table app.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  type text not null check (type in ('text', 'url', 'file')),
  name text not null check (char_length(name) between 1 and 200),
  canonical_url text,
  storage_key text,
  content_checksum text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed', 'deleting')),
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id) on delete cascade
);

create index knowledge_sources_agent_status_idx on app.knowledge_sources (organization_id, agent_id, status);

create table app.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  source_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  content text not null check (octet_length(content) <= 65536),
  token_count integer not null default 0 check (token_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (to_tsvector('english', content)) stored,
  -- Supabase Edge Runtime's built-in gte-small model emits 384 dimensions.
  embedding extensions.vector(384),
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, source_id, ordinal),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id) on delete cascade,
  foreign key (organization_id, source_id) references app.knowledge_sources(organization_id, id) on delete cascade
);

create index knowledge_chunks_source_idx on app.knowledge_chunks (organization_id, agent_id, source_id);
create index knowledge_chunks_search_idx on app.knowledge_chunks using gin (search_vector);
create index knowledge_chunks_embedding_idx on app.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;

-- Service-role-only semantic retrieval used by the internal Edge Function.
-- It applies tenant and agent predicates before vector ranking.
create or replace function public.match_garuda_knowledge(
  query_organization_id uuid,
  query_agent_id uuid,
  query_embedding extensions.vector(384),
  match_threshold real default 0.55,
  match_count integer default 4
)
returns table (
  id uuid,
  source_id uuid,
  source_name text,
  content text,
  metadata jsonb,
  similarity real
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    chunk.id,
    chunk.source_id,
    source.name as source_name,
    chunk.content,
    chunk.metadata,
    (1 - (chunk.embedding <=> query_embedding))::real as similarity
  from app.knowledge_chunks as chunk
  join app.knowledge_sources as source
    on source.organization_id = chunk.organization_id
   and source.id = chunk.source_id
  where chunk.organization_id = query_organization_id
    and chunk.agent_id = query_agent_id
    and source.status = 'ready'
    and chunk.embedding is not null
    and (1 - (chunk.embedding <=> query_embedding)) >= match_threshold
  order by chunk.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 8)
$$;

revoke all on function public.match_garuda_knowledge(uuid, uuid, extensions.vector, real, integer) from public, anon, authenticated;
grant execute on function public.match_garuda_knowledge(uuid, uuid, extensions.vector, real, integer) to service_role;

create table app.visitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  token_digest bytea not null,
  memory_consent boolean not null default false,
  analytics_consent boolean not null default false,
  consented_at timestamptz,
  expires_at timestamptz,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, agent_id, token_digest),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id) on delete cascade
);

create index visitors_agent_seen_idx on app.visitors (organization_id, agent_id, last_seen_at desc);

create table app.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  agent_version_id uuid not null,
  visitor_id uuid not null,
  status text not null default 'open' check (status in ('open', 'closed', 'blocked')),
  origin text,
  page_url text,
  page_title text,
  referrer text,
  locale text,
  started_at timestamptz not null default timezone('utc', now()),
  last_message_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id) on delete cascade,
  foreign key (organization_id, agent_version_id) references app.agent_versions(organization_id, id),
  foreign key (organization_id, visitor_id) references app.visitors(organization_id, id)
);

create index conversations_agent_activity_idx on app.conversations (organization_id, agent_id, last_message_at desc);
create index conversations_visitor_activity_idx on app.conversations (organization_id, agent_id, visitor_id, last_message_at desc);

create table app.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (char_length(content) <= 32000),
  client_message_id text,
  provider_message_id text,
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, conversation_id, client_message_id),
  foreign key (organization_id, conversation_id) references app.conversations(organization_id, id) on delete cascade
);

create index messages_conversation_time_idx on app.messages (organization_id, conversation_id, created_at, id);

create table app.visitor_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  visitor_id uuid not null,
  summary text not null default '' check (char_length(summary) <= 8000),
  facts jsonb not null default '[]'::jsonb,
  consented_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, agent_id, visitor_id),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id) on delete cascade,
  foreign key (organization_id, visitor_id) references app.visitors(organization_id, id) on delete cascade
);

create table app.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  visitor_id uuid,
  conversation_id uuid not null,
  name text,
  email text,
  phone text,
  company text,
  custom_fields jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'qualified', 'contacted', 'converted', 'disqualified')),
  source text not null default 'widget',
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id),
  foreign key (organization_id, visitor_id) references app.visitors(organization_id, id),
  foreign key (organization_id, conversation_id) references app.conversations(organization_id, id)
);

create index leads_status_created_idx on app.leads (organization_id, status, created_at desc);
create index leads_agent_created_idx on app.leads (organization_id, agent_id, created_at desc);
create index leads_email_idx on app.leads (organization_id, agent_id, lower(email)) where email is not null;

create table app.lead_capture_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  client_capture_id text not null,
  consent_granted boolean not null check (consent_granted),
  notice_version text not null,
  captured_fields text[] not null,
  origin text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, conversation_id, client_capture_id),
  foreign key (organization_id, lead_id) references app.leads(organization_id, id),
  foreign key (organization_id, conversation_id) references app.conversations(organization_id, id)
);

create table app.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid,
  metric text not null,
  quantity integer not null check (quantity > 0),
  billing_period text not null,
  idempotency_reference text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, metric, idempotency_reference),
  foreign key (organization_id, agent_id) references app.agents(organization_id, id)
);

create index usage_events_period_idx on app.usage_events (organization_id, billing_period, metric);

create table app.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  available_at timestamptz not null default timezone('utc', now()),
  lease_owner text,
  lease_expires_at timestamptz,
  safe_error_code text,
  safe_error_message text,
  result jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index jobs_claim_idx on app.jobs (status, available_at, created_at) where status = 'queued';

create table app.stripe_events (
  event_id text primary key,
  organization_id uuid references app.organizations(id) on delete set null,
  event_type text not null,
  stripe_created_at timestamptz not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempt_count integer not null default 1,
  safe_error text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index stripe_events_org_time_idx on app.stripe_events (organization_id, stripe_created_at desc);

create table app.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  scope text not null,
  key text not null,
  request_hash bytea not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  unique (organization_id, scope, key)
);

create index idempotency_expiry_idx on app.idempotency_keys (expires_at);

create table app.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index audit_logs_org_time_idx on app.audit_logs (organization_id, created_at desc);

-- Updated-at triggers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'organizations', 'organization_members', 'subscriptions',
    'onboarding_sessions', 'agents', 'knowledge_sources', 'conversations',
    'visitor_memories', 'leads', 'jobs'
  ]
  loop
    execute format('create trigger %I before update on app.%I for each row execute function app.touch_updated_at()', table_name || '_touch_updated_at', table_name);
  end loop;
end
$$;

-- Profiles are user-owned. Business data is tenant-bound to a transaction-local
-- organization ID set by the Go repository after it verifies membership.
alter table app.profiles enable row level security;
alter table app.profiles force row level security;
create policy profiles_self on app.profiles
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table app.organizations enable row level security;
alter table app.organizations force row level security;
create policy organizations_current_tenant on app.organizations
  using (id = app.current_organization_id())
  with check (id = app.current_organization_id());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organization_members', 'subscriptions', 'onboarding_sessions', 'agents',
    'agent_versions', 'knowledge_sources', 'knowledge_chunks', 'visitors',
    'conversations', 'messages', 'visitor_memories', 'leads',
    'lead_capture_events', 'usage_events', 'jobs', 'idempotency_keys', 'audit_logs'
  ]
  loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('alter table app.%I force row level security', table_name);
    execute format(
      'create policy tenant_isolation on app.%I using (organization_id = app.current_organization_id()) with check (organization_id = app.current_organization_id())',
      table_name
    );
  end loop;
end
$$;

-- Stripe events may briefly be unassigned while a valid signed event is matched.
-- Only tenant-matched rows are visible through the normal application role.
alter table app.stripe_events enable row level security;
alter table app.stripe_events force row level security;
create policy stripe_events_tenant on app.stripe_events
  using (organization_id = app.current_organization_id())
  with check (organization_id = app.current_organization_id());

revoke all on all tables in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to service_role;

commit;
