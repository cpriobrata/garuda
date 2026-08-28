# Free Supabase RAG deployment

This directory contains the production Postgres/Edge implementation for semantic knowledge retrieval. Supabase Edge Runtime runs the built-in `gte-small` embedding model, so ingestion and search require no external embedding API key. `gte-small` produces 384-dimensional vectors and truncates long individual inputs; the ingest function therefore creates bounded, overlapping chunks before inference.

1. Apply `../migrations/001_supabase.sql` and `../migrations/002_rag_runtime_compat.sql` in order, then add `app` to the project's exposed API schemas. The migrations revoke browser-role access and grant the server role only.
2. Link the project with the Supabase CLI from this `backend/supabase` directory.
3. Generate a random secret of at least 32 bytes and set it only on the Edge Functions and Go backend:

   ```powershell
   supabase secrets set GARUDA_RAG_SHARED_SECRET="replace-with-a-long-random-value"
   supabase functions deploy garuda-rag-ingest
   supabase functions deploy garuda-rag-search
   ```

4. Configure the Go service:

   ```text
   RAG_EDGE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
   RAG_EDGE_BEARER_TOKEN=the-same-GARUDA_RAG_SHARED_SECRET
   ```

Both functions disable the gateway JWT check because the caller is the Go service, not a Supabase user. They enforce a separate high-entropy bearer secret before doing work. `SUPABASE_SERVICE_ROLE_KEY` is read only inside the Edge environment and must never be placed in `NEXT_PUBLIC_*`, widget code, browser storage, or frontend deployment settings.

The functions select storage by ID shape:

- UUID organization/agent/source IDs use the production relational tables. Ingestion rechecks the composite source relationship before writing.
- Opaque `org_*`/`agt_*`/`src_*` IDs use the isolated `rag_runtime_chunks` table, allowing the dependency-free JSON repository to use real vectors immediately. This table has no anon/authenticated grants, and every operation contains exact organization, agent, and source predicates.

Both search functions are executable by `service_role` only and apply the organization and agent filter before ranking. The Go runtime treats retrieved text as untrusted reference data in its prompt.

After creating and publishing an agent through the Go API, `POST /v1/agents/{agentID}/sources` performs ingestion automatically. A direct Edge smoke test can also use opaque keys without pre-creating a relational row:

```powershell
$headers = @{ Authorization = "Bearer $env:GARUDA_RAG_SHARED_SECRET"; "Content-Type" = "application/json" }
$body = @{ organization_id = "org_smoketest01"; agent_id = "agt_smoketest01"; source_id = "src_smoketest01"; name = "FAQ"; content = "Our support hours are Monday through Friday, 9 to 5." } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://YOUR_PROJECT_REF.supabase.co/functions/v1/garuda-rag-ingest" -Headers $headers -Body $body
```

Use the same organization and agent keys with `garuda-rag-search` and `{ "query": "When is support open?", "limit": 4 }`.
