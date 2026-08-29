# AI.md — Garuda project knowledge base

Working notes for an AI assistant picking up this project. Read this first.

**Updated:** 2026-08-30. Three build workflows were running when this was written, so
files under `frontend/`, `backend/internal/api/` and `widget/` may be mid-change.
Architecture and deployment facts below are stable.

**No secrets here.** Values live in `backend/.env` and `frontend/.env.local`, both
gitignored. Only variable names and public identifiers appear below.

---

## 1. What Garuda is

Multi-tenant SaaS that creates a knowledge-grounded AI chat agent for a company's
website. Sign up, pay $17/mo, answer a conversational onboarding, the model drafts an
agent, the owner edits and publishes it, then one embed snippet goes on their site.
The widget answers from approved knowledge and captures leads after explicit consent.

`docs/integration-contract.md` is the source of truth when UI and API disagree.

---

## 2. It is LIVE

| | |
|---|---|
| API | `https://api.garuda.ravan.ai` on VPS `2.29.22.88`, Caddy TLS, systemd |
| Frontend | `https://garuda-olive.vercel.app` (Vercel project `garuda`, account `cpriobrata-6081`) |
| Custom domain | `garuda.ravan.ai` — DNS points at Vercel but is NOT attached to the project |
| Repo | `github.com/cpriobrata/garuda`, frontend auto-deploys on push to `main` |

SSH with the key at `C:/Users/cprio/.ssh/prio-server.pem`, publickey only.
Backend deploys by cross-compiling and replacing the binary — see `deploy/README.md`:

    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o garuda-api ./cmd/api

Server layout: binary and `.env` in `/opt/garuda`, data at
`/opt/garuda/data/garuda.json`, backups every 6h into `/opt/garuda/backups`
(JSON-validated before keeping, 14-day retention).

---

## 3. Architecture essentials

- **Zero third-party Go dependencies.** `go.mod` has no requires. JWT, PBKDF2, rate
  limiting and the Stripe / Google / Supabase / SendGrid / Composio clients are all
  hand-rolled. Do not add a dependency.
- **Persistence is ONE JSON file** behind `store.Store`, guarded by an RWMutex,
  written atomically. Postgres is designed but NOT built; nothing imports
  `database/sql` or `pgx`.
- **Everything degrades.** Every adapter has `Enabled()` and a local fallback, so the
  product runs with zero credentials.
- **`GARUDA_DEMO_MODE` defaults to true**, and in demo mode `hasEntitlement` returns
  true for everyone. Startup now REFUSES demo mode alongside any production signal
  (environment other than development, an https public URL, an https allowed origin).
  That guard is what keeps billing switched on in production.

---

## 4. The rules that bite

1. **`store.View` hands out LIVE state.** Copying a struct copies only map and slice
   headers. Anything outliving the callback must be deep-copied with the `model`
   Clone helpers. Reading a Go map while another goroutine writes it is a FATAL
   error — unrecoverable, kills the process, `recoverPanic` cannot catch it. This was
   a real production crash path through `getOnboarding`.
2. **`store.Update` rolls back on callback error too.** It did not, so a request
   rejected with 422 still applied every other field, and the next successful write
   persisted it.
3. Cross-tenant access returns **404, never 403**.
4. Envelopes: `data`/`meta` on success, `error` with `code`, `message`, `request_id`
   and `details` on failure. Always use `writeData` / `writeError`.
5. `decodeJSON` uses `DisallowUnknownFields` and a 1MB cap, so a new request field
   must exist on both sides or it is a 400.
6. **Do not bump `model.SchemaVersion`.** `OpenFile` refuses to boot when the file's
   version exceeds the binary's, which makes rollback an incident.
7. Never log or URL-encode prompts, chat bodies, tokens, emails or phone numbers.
8. `.env` values containing spaces must be quoted, or sourcing the file executes the
   second word.
9. `StartLimitIntervalSec` and `StartLimitBurst` belong in systemd's `[Unit]`, not
   `[Service]`. Both are 0 so restarts are unlimited — verified by killing the
   process eight times in a row.

---

## 5. Auth — three coexisting paths

- **Local:** PBKDF2 at 160k iterations, HS256 access tokens, opaque `grt1_` refresh
  tokens with whole-family revocation on reuse. Email verification enforced outside
  demo mode.
- **Supabase:** active when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both set. The
  Go API proxies it; the browser never talks to Supabase directly.
- **Google:** Google Identity Services **ID tokens**, verified against Google's JWKS.
  **No redirect URI is used** — only Authorized JavaScript origins matter, and the
  client secret is never read. The consent screen is still in Testing mode.

---

## 6. Integrations via Composio — built 2026-08-30

Each customer connects **their own** third-party accounts. Garuda writes no
per-provider integration code.

- `backend/internal/composio` — hand-rolled HTTPS client using the `x-api-key` header.
- Endpoints: `GET /v1/integrations/catalog`, `/categories`, `/connections`;
  `POST /v1/integrations/connections`; `DELETE /v1/integrations/connections/{id}`.
- **1,431 toolkits** verified live. Managed auth (needing no OAuth app of your own)
  confirmed for Google Calendar, Slack, HubSpot and Salesforce. **Highlevel and
  Pipedrive have NO managed auth**, so those two need Garuda's own OAuth app and the
  provider review that comes with it.
- Uses **Connect Link**, not `initiate()` — Composio retired that path for managed
  OAuth during 2026 (8 May for new orgs, 3 July for the rest).
- Tenant boundary: the Composio `user_id` IS the Garuda account id. Listing
  connections without one is refused; disconnect re-verifies ownership first.
- Two key types exist and are easy to confuse. Platform keys (`ak_`) use `x-api-key`
  and are the ones this code needs. Connect/MCP keys (`ck_`) use `x-consumer-api-key`
  and will not work here.
- **Known risk:** Composio disclosed a breach on 2026-05-21, roughly 5,241 API keys
  and 5,001 GitHub OAuth tokens exfiltrated. The key in use has no IP restriction; an
  allowlist scoped to 2.29.22.88 would cut the blast radius.

---

## 7. Providers

| | State |
|---|---|
| **Gemini** | Working. `gemini-3.7-flash` is a REASONING model, so a small `max_tokens` gets consumed by thinking before any answer |
| **Stripe** | TEST keys. Webhook signature verified against production. Account is sandbox with payouts paused |
| **SendGrid** | Working. Sends from `info@ravan.ai`, a verified sender on a DKIM-authenticated domain |
| **Supabase** | Both migrations APPLIED. Nothing reads them — there is no Postgres client in the Go code |
| **Pinecone** | Index `garuda-knowledge` exists, 1024-dim, integrated embedding. NOT wired to any code |

---

## 8. Environment

The authoritative list is whatever `config.Load()` actually reads. The frontend uses
exactly two variables — `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` —
and nothing else may be exposed as `NEXT_PUBLIC_*`.

Paired and enforced at startup: `SUPABASE_URL` with `SUPABASE_ANON_KEY`,
`RAG_EDGE_URL` with `RAG_EDGE_BEARER_TOKEN`, and the three `STRIPE_*` values outside
demo mode.

`GARUDA_TRUSTED_PROXIES=127.0.0.1/32` is REQUIRED in production, or Caddy collapses
every visitor on earth into a single rate-limit bucket.

---

## 9. Verification

    cd backend  && go build ./... && go vet ./... && go test ./...
    cd frontend && npx tsc --noEmit --incremental false && npx eslint . && npx next build
    cd widget   && npm test

Health endpoints are `GET /healthz` and `GET /readyz` — **not** `/v1/health`.
The race detector needs cgo and there is no gcc on this machine, so run `-race` in CI
on Linux instead.

---

## 10. Open items

- `garuda.ravan.ai` is not attached to the Vercel project; the domain lives in a
  different Vercel account than the one holding the project
- Stripe is sandbox with payouts paused, so no real money can move
- The database is still a single JSON file
- The Composio API key has no IP restriction
- Designed but unbuilt: Postgres repository, jobs worker, file upload with vision,
  visitor memory, admin panel, widget design system

---

## 11. Working agreements

- Verify claims against the running system rather than asserting them. Several
  confident statements here turned out to be wrong — a broken test of my own reported
  the Supabase migrations as unapplied when they were fine.
- Prove every regression test by reverting the fix and watching it fail.
- Never `pkill -f` a pattern that also matches the shell running it.
- Scan for secrets before every push. A QA agent once left a test JWT in the tree.
