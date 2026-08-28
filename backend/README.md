# Garuda backend

Garuda's backend is a runnable Go service for the multi-tenant chatbot SaaS flow: account access, a USD $17/month Stripe plan, four-question onboarding, AI-assisted agent generation, multiple agents per account, an embeddable widget, consented lead capture, returning-visitor memory, conversations, knowledge sources, and dashboard metrics.

The default local store is an atomic JSON file. That keeps local setup dependency-free: no CGO, package download, Docker, or external database is needed. Production data should use Supabase Postgres through a repository adapter and the included RLS schema. The local file store is deliberately not described as horizontally scalable production storage.

## Start locally

Go 1.22 or newer is required.

```powershell
$env:GARUDA_DEMO_MODE = "true"
$env:GARUDA_JWT_SECRET = "local-secret-that-is-longer-than-32-characters"
$env:GARUDA_VISITOR_HMAC_KEY = "another-local-secret-longer-than-32-characters"
go run ./cmd/api
```

`.env.example` is a configuration reference. Garuda never searches for a dotenv file, but it can safely load one when explicitly requested from the backend working directory:

```powershell
$env:GARUDA_ENV_FILE = ".env"
go run ./cmd/api
```

The loader accepts only a relative regular file contained by the working directory, caps it at 64 KiB, performs no variable expansion, and never overrides an existing process environment variable. The three direct assignments above remain the simplest zero-key demo setup; `go run ./cmd/api` also works with the built-in demo defaults.

The API listens on `http://localhost:8080`. `GET /healthz` is the liveness check; `GET /readyz` verifies storage access.

Local demo flow:

1. `POST /v1/auth/signup` with `name`, `email`, `password`, and optional `business_name`.
2. Use the returned bearer token with `POST /v1/billing/demo/complete`. This route exists only when `GARUDA_DEMO_MODE=true` and never claims to represent a real payment.
3. Save the four canonical `answers` with `PUT /v1/onboarding`, then call `POST /v1/onboarding/complete`.
4. Publish the draft with `POST /v1/agents/{agentID}/publish`.
5. Copy the snippet from `GET /v1/agents/{agentID}/embed` into a website.

Demo mode bypasses external payment proof and provider setup only. It intentionally enforces the same starter quotas as production so local testing cannot hide plan-limit behavior.

When no LLM key is set, generation and chat use a deterministic local demo responder. The default provider settings use Gemini's OpenAI-compatible endpoint and `gemini-3.7-flash`; set `GEMINI_API_KEY` to enable it. `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` can target another compatible `/chat/completions` provider. See Google's current [OpenAI compatibility documentation](https://ai.google.dev/gemini-api/docs/openai).

## Contract and endpoints

Portal calls use `Authorization: Bearer <token>`. Set `GARUDA_AUTH_MODE=local` for Garuda-owned email/password plus direct Google Identity Services, or `GARUDA_AUTH_MODE=supabase` for Supabase Auth. The explicit switch prevents Supabase settings used by RAG from silently changing the login provider. If the switch is omitted, compatibility mode selects Supabase only when both Supabase Auth variables are present; new deployments should always set it.

Local mode uses PBKDF2-SHA256 password hashes, short-lived signed access tokens, rotating single-use refresh families, and hashed single-use email/reset tokens. Outside demo mode, password signup returns `verification_required=true` without access or refresh tokens; login is blocked until verification. `AUTH_VERIFY_URL` and `AUTH_RESET_URL` are frontend pages, and `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and an HTTPS `SENDGRID_API_URL` are required. `SENDGRID_FROM_EMAIL` must be a verified SendGrid sender; `SENDGRID_FROM_NAME` and `SENDGRID_REPLY_TO` customize identity. Welcome mail is recorded after the first successful verification and retried after a provider failure, not sent on every login. Forgot/resend responses are generic, per-address cooldowns are persisted, and issuing a replacement invalidates older unused links. Raw tokens and the SendGrid key are never stored or logged.

Demo local auth is zero-key and auto-verifies signup; a reset token is returned only when both demo mode and `GARUDA_EXPOSE_RESET_TOKEN=true`. In Supabase mode, signup/recovery/verification remain provider-owned; configure SendGrid as Supabase custom SMTP if desired. Supabase returns the recovery session in the redirect fragment; the frontend reads `#access_token` and submits it as the reset request's `token` field (or as a Bearer token). URL fragments never reach this API. A tenant ID in a resource request body is never accepted as authority.

Successes use `{ "data": ..., "meta": ... }`. Errors use `{ "error": { "code", "message", "request_id", "details" } }`. Known cross-tenant resource IDs return `404`.

### Portal API

| Method | Route | Purpose |
|---|---|---|
| POST | `/v1/auth/signup`, `/v1/auth/login`, `/v1/auth/refresh` | Account creation, login, and refresh-token rotation |
| POST | `/v1/auth/verify-email`, `/v1/auth/resend-verification` | Consume or resend local verification; resend is generic |
| POST | `/v1/auth/google` | Verify a Google GIS ID credential and create/sign in |
| POST | `/v1/auth/google/link` | Authenticated exact-email Google identity linking |
| POST | `/v1/auth/forgot-password`, `/v1/auth/reset-password` | Generic reset request and token consumption |
| GET | `/v1/me` | Canonical user, organization, subscription, onboarding bootstrap |
| PATCH | `/v1/profile` | Update the signed-in user's name |
| GET, PUT | `/v1/onboarding` | Read/save onboarding state |
| GET | `/v1/onboarding/questions` | Four deterministic business questions |
| POST | `/v1/onboarding/messages` | Answer the next required question |
| POST | `/v1/onboarding/complete` | Generate one draft agent; repeat-safe after completion |
| GET | `/v1/jobs/{jobID}` | Read a generation result |
| GET, POST | `/v1/agents` | List/create tenant agents |
| POST | `/v1/agents/generate` | Generate another draft from onboarding plus a brief |
| GET, PATCH, DELETE | `/v1/agents/{agentID}` | Read/edit/archive an owned agent |
| POST | `/v1/agents/{agentID}/preview/messages` | Non-persisted draft preview |
| POST | `/v1/agents/{agentID}/publish`, `/unpublish` | Control live availability |
| GET | `/v1/agents/{agentID}/embed` | Return the widget loader snippet |
| GET, POST | `/v1/agents/{agentID}/sources` | List/add text knowledge sources |
| DELETE | `/v1/agents/{agentID}/sources/{sourceID}` | Remove a source and its vector chunks |
| GET | `/v1/dashboard`, `/v1/analytics/overview` | Metrics, seven-day activity, recent leads |
| GET | `/v1/conversations`, `/v1/conversations/{sessionID}` | Tenant conversation list/transcript |
| GET | `/v1/leads`, `/v1/leads/{leadID}` | Search/read leads |
| PATCH | `/v1/leads/{leadID}` | Update workflow status and notes only |
| GET | `/v1/billing/subscription` | Webhook-derived billing state |
| POST | `/v1/billing/checkout-sessions` | Server-selected Stripe subscription Checkout |
| POST | `/v1/billing/portal-sessions` | Owner-only Stripe billing portal |
| POST | `/v1/webhooks/stripe` | Raw, signature-verified, replay-safe events |

The shorter `/v1/billing/checkout` and `/v1/billing/portal` aliases remain available for the portal client.

Knowledge content is mutable only through the `/sources` routes so the file repository and remote vector index cannot silently diverge. Agent create/update payloads therefore reject a top-level `knowledge` field.

### Widget API

| Method | Route | Credential |
|---|---|---|
| GET | `/widget/v1/agents/{agentKey}` | Publishable agent key; safe display fields only |
| POST | `/widget/v1/sessions` | Agent key, optional visitor token, page context and consent |
| POST | `/widget/v1/sessions/{sessionID}/messages` | `X-Garuda-Session-Token` |
| POST | `/widget/v1/sessions/{sessionID}/leads` | Session token plus explicit consent |
| GET | `/widget.js` | Self-contained loader |

Widget session tokens expire after 15 minutes and bind the conversation to its browser Origin. A consenting visitor gets a high-entropy token; only an agent-scoped HMAC digest is stored. Using the same raw token with another agent creates unrelated memory. The message endpoint returns JSON normally and `meta`, `delta`, and `done` events for `Accept: text/event-stream`. Provider work has a 45-second whole-request budget, including an 8-second RAG budget; the browser widget gives message requests 60 seconds while keeping non-message requests at 20 seconds.

Outside demo mode, publishing requires at least one exact website hostname. Save it without replacing the rest of the theme using `PATCH /v1/agents/{agentID}` and `{ "branding": { "allowed_domains": ["www.customer.example"] } }`. Schemes, paths, wildcards, credentials, queries, and fragments are rejected. Widget bootstrap then matches the browser Origin to this list.

## Stripe

Create a recurring USD $17/month Price and put its ID in `STRIPE_PRICE_ID` (or `STRIPE_PRICE_ID_STARTER_17`). Checkout rejects/ignores client amount, currency, price, customer, mode, and return URL inputs. A success redirect does not grant access. Only a verified webhook or the explicitly gated local simulator updates entitlement.

Outside demo mode, Stripe configuration is fail-closed: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` must be supplied together. The service will not start with a payment-capable Checkout configuration that cannot verify entitlement webhooks. Checkout also returns a conflict for a workspace that is already active or trialing; subscription changes belong in the billing portal.

Checkout requires an `Idempotency-Key` header containing 8 to 255 characters. The key is hashed in local state and forwarded to Stripe. The single-instance repository reserves checkout creation atomically: concurrent provider creation is blocked, identical retries replay the saved session, and a later browser-generated key receives the same unexpired pending Checkout URL instead of creating another subscription.

Handled events are `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Event IDs are persisted so replaying a valid event does not reapply it.

The starter plan constants are returned by `/v1/me` and `/v1/billing/subscription` and enforced atomically by the same service: at most 10 simultaneously published agents, 100 engaged widget conversations across the workspace in a rolling 30-day window, and five knowledge sources per agent. A bootstrap session is not metered; its first user message atomically sets `started_at` and consumes the conversation slot. Reopening an already engaged consented visitor conversation within 30 days remains allowed at the limit. Unpublishing or archiving an agent frees a publish slot; conversations age out of the rolling window automatically. Dashboard metrics and conversation lists omit untouched bootstrap sessions.

## Free Supabase RAG

[`migrations/001_supabase.sql`](migrations/001_supabase.sql) defines the strong production model: organizations, memberships, subscriptions, immutable agent versions, knowledge sources/chunks, visitors, conversations, messages, memories, consent evidence, leads, jobs, usage, idempotency, webhooks, and audit logs. It includes composite tenant foreign keys, indexes, 384-dimensional pgvector storage, and forced RLS policies using a transaction-local `app.current_organization_id`.

[`migrations/002_rag_runtime_compat.sql`](migrations/002_rag_runtime_compat.sql) adds an isolated vector table for the currently runnable file repository's opaque `org_*`, `agt_*`, and `src_*` identifiers. It has no browser grants or browser RLS policy and is accessed only by the service-role Edge Functions after a separate high-entropy internal-secret check. Every delete, insert, and search includes exact organization, agent, and source keys. This makes free semantic RAG work with the executable today without pretending the compatibility table replaces the relational production model.

[`supabase/`](supabase/) contains two Edge Functions for ingestion and search. They use Edge Runtime's built-in `gte-small` model, so there is no embedding API key or embedding bill. Supabase documents that model as 384 dimensions, English-focused, and limited to 512 tokens per input; ingestion creates bounded overlapping chunks. See the official [embedding quickstart](https://supabase.com/docs/guides/ai/quickstarts/generate-text-embeddings) and [semantic-search guide](https://supabase.com/docs/guides/functions/examples/semantic-search).

Production setup:

1. Apply both SQL migrations in numeric order and add the `app` schema to Supabase's exposed API schemas. Browser roles have their table/schema grants revoked; only `service_role` can use these Edge data paths.
2. Deploy `garuda-rag-ingest` and `garuda-rag-search` from `backend/supabase`.
3. Set the same separate 32+ byte secret as `GARUDA_RAG_SHARED_SECRET` in Edge secrets and `RAG_EDGE_BEARER_TOKEN` in Go. Set `RAG_EDGE_URL=https://PROJECT_REF.supabase.co/functions/v1`.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge environment. Never put it in a `NEXT_PUBLIC_*` variable, browser bundle, widget, or local storage.

The Go `internal/rag` adapter calls Edge server-to-server. Opaque file-repository IDs automatically use the compatibility table and therefore need no mirrored source row. UUID IDs automatically use the relational `knowledge_sources` and `knowledge_chunks` path and require the composite tenant source relationship. Both searches filter organization and agent before vector ranking, and retrieved passages are labeled untrusted reference data in the model prompt. With no RAG settings, file-mode knowledge still works by injecting bounded source text.

## Build and deploy

```powershell
go test ./...
go vet ./...
go build -o garuda-api.exe ./cmd/api
docker build -t garuda-api .
```

The container runs as a non-root user and defaults to `GARUDA_DEMO_MODE=false`. Persist `/app/data` only for a single-instance demo. For production, replace the file repository with a Supabase/Postgres implementation of `store.Store`; after membership verification, each transaction should call `select app.set_current_organization($1)` and use a non-owner, non-`BYPASSRLS` database role.

Before public launch, also add cached local Supabase JWKS validation, a Postgres repository/worker, immutable published-version reads, transactional idempotency for every critical write, secure URL/file ingestion, provider concurrency and usage quotas, private storage, PII export/deletion/retention workflows, observability, backups, and load/security tests. The in-memory limiter intentionally trusts only the socket peer address; behind a reverse proxy, preserve the real client address at the network layer or replace it with trusted-proxy-aware/distributed rate limiting, otherwise users behind that proxy share one bucket. Those limits are explicit: this is a strong runnable MVP and production-shaped scaffold, not a claim that provider and operational setup can be skipped.
