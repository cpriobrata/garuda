# AI.md — Garuda project knowledge base

Working notes for an AI assistant picking up this project. Read this first; it should
save you a full re-exploration.

**Snapshot taken:** 2026-08-29, ~02:25 IST.
**Important caveat:** this snapshot was taken while another developer was actively
editing nearly every file in the repo. Treat specific line numbers and "current state"
claims as *approximate*. Architecture and conventions are stable; in-progress details
may not be.

**No secrets in this file.** Credential *values* live in `backend/.env` and
`frontend/.env.local` (both gitignored). Only variable names and non-sensitive,
browser-visible identifiers appear here.

---

## 1. What Garuda is

A multi-tenant SaaS for creating an AI sales/support chatbot and embedding it on a
customer's website. The intended journey:

1. Sign up (email/password or Google) → 2. Pay $17/mo via Stripe → 3. Answer a
4-question conversational onboarding → 4. Garuda drafts an agent → 5. User edits and
explicitly publishes → 6. User copies one `<script>` snippet onto their site →
7. Widget answers from the agent's knowledge, captures leads after consent →
8. Owner sees conversations and leads in the portal.

Pricing is **USD 17/month recurring**. The amount shown in the UI must come from the
server's configured Stripe Price, never from the client.

`docs/integration-contract.md` (686 lines) is the **source of truth** when the UI and
API disagree. Read it before making contract-level decisions.

---

## 2. Repo map

| Path | What it is |
|---|---|
| `backend/` | Go 1.22+ REST API, no web framework — stdlib `net/http` + `ServeMux` |
| `backend/cmd/api/` | Entrypoint |
| `backend/internal/api/` | HTTP handlers, middleware, routing |
| `backend/internal/model/` | All persisted types, single `State` struct |
| `backend/internal/store/` | Atomic JSON file persistence |
| `backend/internal/security/` | JWT (HS256), PBKDF2 passwords, HMAC token hashing |
| `backend/internal/googleauth/` | Google ID-token verifier (JWKS, RS256) |
| `backend/internal/{llm,rag,billing,supabase}/` | External provider adapters |
| `backend/migrations/` | Postgres/pgvector schema (not yet the runtime store) |
| `backend/supabase/functions/` | Deno Edge Functions for RAG ingest/search |
| `frontend/` | Next.js App Router, TypeScript, Tailwind, shadcn/ui-style Radix |
| `frontend/lib/api.ts` | The entire API client + demo-mode fallbacks |
| `widget/` | Dependency-free embeddable widget (Shadow DOM), own tests |
| `docs/integration-contract.md` | Canonical API/security/production contract |

---

## 3. Architecture essentials

- **Zero-dependency Go backend.** `go.mod` has no third-party deps. JWT, PBKDF2,
  rate limiting, and the Stripe/Google/Supabase clients are all hand-rolled. Don't
  reach for a library without a good reason — it breaks the project's stated posture.
- **Persistence is a single JSON file** (`backend/data/garuda.json`), guarded by a
  `sync.RWMutex`, written atomically via temp-file + rename, with in-memory rollback
  on write failure. `store.Store` is an interface — the Postgres repository is the
  planned successor, and `backend/migrations/` already has the schema.
- **Everything degrades gracefully.** Every provider adapter has `Enabled()` and a
  local fallback. The whole app runs with **zero credentials** in demo mode.
- **`GARUDA_DEMO_MODE` is the master switch.** When true: entitlement checks always
  pass, `localhost` origins are allowed, reset tokens are exposed in API responses,
  and `AUTH_RESET_URL` may be plain HTTP. Setting it `false` forces HTTPS on
  `AUTH_RESET_URL`, which localhost cannot satisfy — so **demo mode must stay `true`
  for local development.**

---

## 4. Authentication — three coexisting paths

This is the most confusing area. There are three ways a user can authenticate, and
which one runs depends on config.

### a) Local (default, demo)
Password hashed with PBKDF2-SHA256, 160k iterations. Access token is a self-signed
HS256 JWT (`GARUDA_JWT_SECRET`). Refresh tokens are opaque, prefixed `grt1_`, stored
as SHA-256 hashes.

**Refresh rotation is family-based:** reusing an already-used refresh token revokes
the *entire family*. This is deliberate replay defense — don't "simplify" it away.

### b) Supabase Auth
Active when `SUPABASE_URL` + `SUPABASE_ANON_KEY` are both set (they're validated as a
pair — one without the other is a startup error). The Go API *proxies* Supabase; the
browser never talks to Supabase directly and has no `@supabase/supabase-js` dependency.
Local users are matched by `User.ExternalAuthID`.

### c) Google Sign-In — **ID token, not the redirect flow**

This is the single most misunderstood part. Get it right:

- Frontend uses **Google Identity Services** (`accounts.google.com/gsi/client`) with
  `ux_mode: "popup"` and `renderButton`. See `frontend/components/auth/google-auth-button.tsx`.
- It obtains an **ID token (JWT)** and POSTs it to `/v1/auth/google`.
- `internal/googleauth/verifier.go` verifies it against Google's JWKS: RS256 only,
  `iss` must be Google, `aud` must **exactly** equal the client ID, `email_verified`
  must be true, plus strict timestamp bounds and RSA key sanity checks.
- The backend then issues **its own local JWT** — Google is not used for sessions.

Consequences that trip people up:

- **There is no redirect URI.** Do not register the Supabase
  `/auth/v1/callback` URL and do not chase `redirect_uri_mismatch`. What matters is
  **Authorized JavaScript origins** (`http://localhost:3000` for local dev).
- **The Google client secret is never used.** `config.go` reads only
  `GOOGLE_OAUTH_CLIENT_ID`. No `GOOGLE_OAUTH_CLIENT_SECRET` is consumed anywhere.
- Google sign-in does **not** go through Supabase at all.
- The OAuth consent screen is in **Testing** mode, so only listed test users can sign
  in regardless of everything else.

**Account-linking safety rule** (`googleauth.AuthoritativeEmail`): a Google identity
may silently link to an existing account by email *only* if the claim carries a hosted
domain (`hd`) or is `@gmail.com`. Otherwise the user must prove ownership with their
existing password first. This blocks account takeover via a self-controlled mail
domain. Preserve this.

---

## 5. Billing

- Stripe Checkout and billing-portal sessions are created **server-side**. The API
  ignores any client-supplied amount, currency, price, or success URL.
- Webhook signature verification is hand-written standard Stripe v1 HMAC with a
  ±5 minute timestamp tolerance (`internal/billing/stripe.go`).
- Replay protection: handled event IDs are recorded in `State.WebhookEvents`.
- Handled events: `checkout.session.completed`, `customer.subscription.*`,
  `invoice.paid`, `invoice.payment_failed`.
- Config validation: outside demo mode, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  and `STRIPE_PRICE_ID` must be set **together or not at all**.
- A Stripe success URL is *not* proof of payment. `/checkout/success` polls `/v1/me`
  and waits for webhook-derived entitlement.

---

## 6. AI and RAG

- **LLM:** Gemini via its **OpenAI-compatible** endpoint
  (`https://generativelanguage.googleapis.com/v1beta/openai`). `LLM_API_KEY` falls
  back to `GEMINI_API_KEY`.
- When the key is missing, `llm.Chat` returns `localReply()` and `GenerateAgent`
  returns `localDraft()` — **deterministic canned text, silently**. Responses carry
  `provider_mode: "local_demo"` vs `"configured"`. If the chatbot feels dumb, check
  this before debugging prompts.
- **RAG (as designed):** Supabase Postgres + pgvector, with two Deno Edge Functions
  (`garuda-rag-ingest`, `garuda-rag-search`) that embed using Supabase's built-in
  `gte-small` model → **384 dimensions**, no separate embedding provider.
- Edge functions authenticate with a shared bearer secret compared in constant time;
  `RAG_EDGE_URL` and `RAG_EDGE_BEARER_TOKEN` are validated as a pair, token ≥32 chars.
- The functions support two ID modes: `relationalMode` (UUIDs, the Postgres future)
  and `runtimeMode` (opaque keys, what the JSON store actually uses today).
- **Enabling RAG before deploying the functions is worse than leaving it off** — every
  ingested knowledge source gets marked `status: "failed"`.

---

## 7. Widget

- Dependency-free, Shadow DOM isolated, served from `GET /widget.js` (embedded in the
  Go binary via `go:embed`).
- Returning visitors are recognized by an **opaque, agent-scoped** token:
  `visitorID = "vst_" + HMAC(GARUDA_VISITOR_HMAC_KEY, agentID, visitorToken)`.
  Scoping by agent means the same browser cannot be correlated across tenants.
- `GARUDA_VISITOR_HMAC_KEY` must differ from `GARUDA_JWT_SECRET` outside demo mode —
  enforced at startup.
- Widget writes use `X-Garuda-Session-Token`, a much narrower credential than a portal
  token. Sessions also pin `Origin` and re-check it on later requests.
- Per-agent `Branding.AllowedDomains` gates which sites may embed. Empty list is
  permitted **only** in demo mode.

---

## 8. Conventions and gotchas

- **Response envelope:** success `{"data": ..., "meta": ...}`, error
  `{"error": {code, message, request_id, details}}`. Always use `writeData` /
  `writeError`.
- **Cross-tenant resources return `404`, never `403`.**
- `decodeJSON` sets `DisallowUnknownFields` and caps bodies at 1 MB — adding a field
  to a frontend request without adding it to the Go struct is a `400`.
- ID prefixes: `org_`, `usr_`, `agt_`, `cvs_`, `msg_`, `rst_`, `rfs_`, `src_`, `sub_`,
  `vst_`.
- Rate limiting is in-memory fixed-window, keyed by client IP + bucket, with bounded
  eviction (4096 entries). It does not survive restart and is not shared across
  instances — production needs real shared storage.
- **Never log or URL-encode** prompts, chat bodies, tokens, emails, or phone numbers.
- Windows/PowerShell is the documented dev environment.
- `.env` values containing spaces **must be quoted** — `set -a && . ./.env` will try to
  execute the second word otherwise.

---

## 9. Environment variables

Authoritative list = whatever `config.Load()` in `backend/internal/config/config.go`
actually reads. Verify against it; the file changes.

**Read by the backend:** `GARUDA_ADDRESS`, `GARUDA_PUBLIC_URL`, `GARUDA_DATA_FILE`,
`GARUDA_ALLOWED_ORIGINS`, `GARUDA_LOG_LEVEL`, `GARUDA_DEMO_MODE`,
`GARUDA_EXPOSE_RESET_TOKEN`, `GARUDA_JWT_SECRET`, `GARUDA_VISITOR_HMAC_KEY`,
`GARUDA_ACCESS_TOKEN_TTL`, `GARUDA_REFRESH_TOKEN_TTL`, `GARUDA_PASSWORD_RESET_TTL`,
`AUTH_RESET_URL`, `GARUDA_PLAN_AMOUNT_CENTS`, `GARUDA_PLAN_CURRENCY`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `STRIPE_*`, `LLM_BASE_URL`, `LLM_MODEL`/`LLM_CHAT_MODEL`,
`LLM_API_KEY`/`GEMINI_API_KEY`, `RAG_EDGE_URL`, `RAG_EDGE_BEARER_TOKEN`,
`GOOGLE_OAUTH_CLIENT_ID`.

**Frontend:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. That is the
complete list — never expose any other secret as `NEXT_PUBLIC_*`.

**Staged in `backend/.env` but NOT read by any code** (credentials parked so they
aren't lost; each has a comment block saying so):
`PINECONE_*`, `SENDGRID_*`, `GOOGLE_OAUTH_CLIENT_SECRET`.

Paired variables — set both or neither, enforced at startup:
`SUPABASE_URL`+`SUPABASE_ANON_KEY`; `RAG_EDGE_URL`+`RAG_EDGE_BEARER_TOKEN`;
and the three `STRIPE_*` values outside demo mode.

---

## 10. External accounts provisioned

| Service | State |
|---|---|
| **Stripe** (test mode) | Product + $17/mo recurring price created and wired. Webhook secret set; signature verification confirmed working against a live signed request. |
| **Supabase** | Project exists; URL + publishable key set. Edge functions **not deployed**. Migrations **not applied**. |
| **Gemini** | Key is valid and the configured model is real, but the **free tier quota is exhausted** (limit 20 req). Until billing is enabled, the bot silently serves canned fallback text. |
| **Pinecone** | Index `garuda-knowledge` created — serverless aws/us-east-1, cosine, **1024-dim**, integrated `llama-text-embed-v2` embedding. Verified with a live upsert + semantic search round-trip. **Not wired to any code.** |
| **SendGrid** | Key valid. `info@ravan.ai` verified both as a single sender and under the fully DKIM-authenticated `ravan.ai` domain — use it as the from-address. **Not wired to any code.** |
| **Google OAuth** | Client ID/secret pair verified valid. Consent screen in Testing mode. |

Note the **dimension mismatch**: the built-in RAG path is 384-dim (`gte-small`), the
Pinecone index is 1024-dim. They are alternative backends, not interchangeable stores.

---

## 11. Known gaps / open items

Ordered roughly by impact:

1. **Gemini quota exhausted** — the only thing blocking genuinely working AI replies.
   Everything else about the LLM path is correct.
2. **`POST /v1/auth/google/link` is called by the frontend but has no backend route.**
   `frontend/lib/api.ts` defines `linkGoogle()`; `server.go` registers only
   `POST /v1/auth/google`.
3. **The `account_link_required` flow appears unreachable.** The backend returns that
   error with `details: nil`, but the frontend only shows the link form when
   `details.email` is present. Verify against current code before acting — this area
   was being edited.
4. **Pinecone, SendGrid, and Google-secret env values are staged but unused.** Wiring
   any of them requires code, not configuration.
5. **RAG edge functions not deployed; migrations not applied.** RAG is intentionally
   left disabled in `.env` until they are.
6. **`docker-compose.yml` cannot run real integrations** — it hardcodes demo secrets
   and passes no Stripe/Gemini/Supabase/RAG variables. It needs an
   `env_file: ./backend/.env` (or explicit passthrough) first.
7. Not yet built, per the README's own production boundary: Postgres repository and
   worker, file/URL ingestion, email delivery, quotas, backups, monitoring, shared
   rate-limit storage, privacy retention/deletion.

---

## 12. Verification commands

```powershell
cd backend;  go build ./... ; go vet ./... ; go test ./...
cd frontend; pnpm lint ; pnpm typecheck ; pnpm build
cd widget;   pnpm test ; pnpm build
```

Run the API with the real env (bash):

```bash
cd backend && set -a && . ./.env && set +a && go run ./cmd/api
```

Health endpoints are `GET /healthz` and `GET /readyz` (**not** `/v1/health`).

---

## 13. Working agreements

- The project owner works alongside another developer in this repo. **Check before
  editing shared files**, and never kill processes by name pattern — port 8080 may be
  someone else's running server.
- When a credential is provided but nothing reads it yet, stage it in `.env` with a
  comment block stating plainly that it is unused, rather than implying it is live.
- Prefer verifying a credential with a real API call over assuming it works. Every
  external claim in section 10 was confirmed against the live service.
