# Garuda

Garuda is a multi-tenant AI website-agent SaaS foundation. It includes a polished Next.js portal, a dependency-light Go API, Stripe subscription hooks, guided agent creation, conversation memory, lead capture, a production embeddable widget, and a free-tier Supabase RAG path.

## What is included

- **Frontend:** Next.js App Router, TypeScript, Tailwind, and shadcn/ui-style Radix components.
- **Backend:** Go REST API with local atomic JSON persistence for a zero-key demo.
- **Billing:** server-created Stripe Checkout and billing-portal sessions; signed, replay-safe webhooks control entitlement.
- **AI:** Gemini through its OpenAI-compatible API, with a deterministic local fallback when no key is configured.
- **RAG:** Supabase Postgres + pgvector and protected Edge Functions using the built-in `gte-small` embedding model.
- **Widget:** dependency-free Shadow DOM loader, returning-visitor memory, SSE/JSON response modes, explicit consent, and lead capture.
- **Documentation:** production integration contract, tenant-isolation model, security boundaries, deployment guidance, and acceptance checklist.

## Run the complete local demo

Prerequisites: Node.js 20+, pnpm 10+, and Go 1.22+.

Start the API in terminal one:

```powershell
Set-Location .\backend
go run .\cmd\api
```

The API starts at `http://localhost:8080` in explicit demo mode. It needs no Stripe, Supabase, or model key.

Start the portal in terminal two:

```powershell
Set-Location .\frontend
Copy-Item .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:3000`, create an account, continue through the simulated local checkout, answer onboarding, create or edit an agent, publish it, and copy its widget snippet. Demo billing is deliberately marked and cannot run outside `GARUDA_DEMO_MODE=true`.

Or start both services with the included local-only container profile:

```powershell
docker-compose up --build
```

This Compose profile intentionally enables demo mode and stores the JSON database in a named volume. Replace its local secrets and use managed Postgres before any shared or production deployment.

To preview the standalone widget without the portal/API:

```powershell
Set-Location .\widget
pnpm test
pnpm demo
```

## Free RAG setup

The recommended development stack uses one Supabase Free project for Auth, Postgres/pgvector, and embedding Edge Functions. The built-in `gte-small` model creates 384-dimensional embeddings, so no separate embedding provider or key is needed.

Other free vector services are viable if the RAG adapter is changed: Qdrant Cloud has a no-card single-node free cluster, Pinecone has a Starter free plan, and Cloudflare Vectorize is included with Workers Free. They are not wired into this repository because Supabase avoids adding a second database and identity vendor.

Apply these migrations in order:

1. `backend/migrations/001_supabase.sql`
2. `backend/migrations/002_rag_runtime_compat.sql`

Then deploy the two functions in `backend/supabase/functions` and configure:

```text
RAG_EDGE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
RAG_EDGE_BEARER_TOKEN=<same 32+ byte secret as GARUDA_RAG_SHARED_SECRET>
```

See `backend/supabase/README.md` for exact deployment commands and security details. The compatibility table lets the runnable local JSON repository use real vectors immediately; the primary schema retains UUID composite foreign keys and forced RLS for the production repository.

## Details needed from the project owner

Keep these in a password manager/deployment secret store. Do not paste service-role, Stripe, database, or model secrets into browser code or commit them.

- Supabase project URL, anon key, database pooler/connection URL, service-role key, project reference, and preferred region.
- A separate 32+ byte `GARUDA_RAG_SHARED_SECRET` used only between the Go service and RAG Edge Functions.
- Gemini API key for development chat generation.
- Stripe test secret key, webhook signing secret, and the recurring USD 17 Price ID.
- Final app/API domains, allowed widget customer domains, support email, privacy URL, and legal copy.
- Approved websites, FAQs, policy text, or extracted document text for each agent.

The current frontend needs only `NEXT_PUBLIC_API_URL`; Supabase Auth is proxied through the Go API. Never expose the service-role, Stripe, Gemini, visitor-HMAC, JWT, RAG shared, or database secrets as `NEXT_PUBLIC_*` values.

Gemini's free API tier may use submitted content to improve Google's products. Use only synthetic or approved non-confidential content during free-tier development; move live lead conversations to an appropriately contracted paid provider tier before production.

## Project map

- `frontend/` — customer journey and portal
- `backend/` — Go API, tests, Dockerfile, migrations, and Supabase functions
- `widget/` — source, tested distribution, and offline widget demo
- `docs/integration-contract.md` — canonical API/security/production contract

Each subproject has its own README and environment example.

## Verification

```powershell
Set-Location .\frontend
pnpm lint
pnpm typecheck
pnpm build

Set-Location ..\backend
go test ./...
go vet ./...
go build ./cmd/api

Set-Location ..\widget
pnpm test
pnpm build
```

## Production boundary

The local demo is runnable and the external provider adapters are real, but deployment credentials and managed services are intentionally not embedded. Before public launch, finish the Postgres repository/worker rollout, secure file and URL ingestion, email delivery, quotas and cost controls, backup/restore drills, monitoring, rate-limit storage, privacy retention/deletion workflows, accessibility testing, and legal review. The detailed checklist lives in `docs/integration-contract.md`.
