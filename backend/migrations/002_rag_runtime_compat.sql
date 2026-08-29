-- Server-only compatibility vectors for Garuda's dependency-free file repository.
--
-- The primary production model in 001_supabase.sql remains authoritative and uses
-- UUID tenant keys plus composite foreign keys. This isolated table allows the
-- runnable Go service's high-entropy opaque IDs (org_*, agt_*, src_*) to use the
-- same free gte-small Edge inference before a Postgres repository is installed.
-- It is never exposed to anon/authenticated roles and is reachable only through
-- Edge Functions protected by GARUDA_RAG_SHARED_SECRET.

begin;

create table app.rag_runtime_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_key text not null check (
    char_length(organization_key) between 8 and 200
    and organization_key ~ '^[A-Za-z0-9._~:-]+$'
  ),
  agent_key text not null check (
    char_length(agent_key) between 8 and 200
    and agent_key ~ '^[A-Za-z0-9._~:-]+$'
  ),
  source_key text not null check (
    char_length(source_key) between 8 and 200
    and source_key ~ '^[A-Za-z0-9._~:-]+$'
  ),
  source_name text not null check (char_length(source_name) between 1 and 200),
  ordinal integer not null check (ordinal >= 0),
  content text not null check (octet_length(content) <= 65536),
  token_count integer not null default 0 check (token_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_key, agent_key, source_key, ordinal)
);

create index rag_runtime_scope_idx
  on app.rag_runtime_chunks (organization_key, agent_key, source_key);
create index rag_runtime_embedding_idx
  on app.rag_runtime_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Deliberately no browser RLS policy: normal API roles receive no rows. The
-- Supabase service_role used inside the protected Edge Functions has BYPASSRLS.
alter table app.rag_runtime_chunks enable row level security;
alter table app.rag_runtime_chunks force row level security;
revoke all on app.rag_runtime_chunks from public, anon, authenticated;
grant all on app.rag_runtime_chunks to service_role;

create or replace function public.match_garuda_runtime_knowledge(
  query_organization_key text,
  query_agent_key text,
  query_embedding extensions.vector(384),
  match_threshold real default 0.55,
  match_count integer default 4
)
returns table (
  id uuid,
  source_id text,
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
    chunk.source_key as source_id,
    chunk.source_name,
    chunk.content,
    chunk.metadata,
    (1 - (chunk.embedding OPERATOR(extensions.<=>) query_embedding))::real as similarity
  from app.rag_runtime_chunks as chunk
  where chunk.organization_key = query_organization_key
    and chunk.agent_key = query_agent_key
    and (1 - (chunk.embedding OPERATOR(extensions.<=>) query_embedding)) >= match_threshold
  order by chunk.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 8)
$$;

revoke all on function public.match_garuda_runtime_knowledge(text, text, extensions.vector, real, integer)
  from public, anon, authenticated;
grant execute on function public.match_garuda_runtime_knowledge(text, text, extensions.vector, real, integer)
  to service_role;

commit;
