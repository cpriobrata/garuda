# AI.md — Garuda project knowledge base

Working notes for an AI assistant picking up this project. Read this first.

**Updated:** 2026-08-30, late. Several build agents were running when this was
written, so files under `frontend/` may be mid-change. Everything below is
verified against the code or against production.

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

## 6b. Human handoff over WhatsApp — built 2026-08-30

When the model runs out, the visitor is handed to the site owner on WhatsApp.

- Config lives on the agent: `model.HandoffConfig` (number, label, pre-typed
  message, availability, trigger phrases, auto-offer-after-N, notify email).
- **The number never appears in the widget bootstrap.** That payload is public,
  served to every allowed origin. The widget is told only that a handoff exists;
  `POST /widget/v1/sessions/{id}/handoff` builds the wa.me link after checking
  the session token. `TestPublicAgentNeverCarriesTheOwnersNumber` enforces it.
- The link pre-types a message and appends the page URL. **The visitor presses
  send** — nothing is messaged on their behalf.
- Recorded once per conversation as a `role: system` message with
  `metadata.event = handoff`, so the inbox can tell a bored visitor from one now
  waiting on WhatsApp. `publicWidgetHistory` filters system rows, so it never
  reaches the visitor or the model.
- Numbers are stored as E.164 digits. A leading zero is rejected: wa.me accepts
  the link and then silently fails to open a chat.

## 6c. Team replies — built 2026-08-30

`POST /v1/conversations/{sessionID}/messages` (owner) and
`GET /widget/v1/sessions/{sessionID}/messages?after={id}` (visitor poll).

- The reply is stored with role `assistant` and `metadata.author = operator`, so
  the widget renders it unchanged and the model reads it as its own prior turn.
- The poll cursor is a **message id, not a timestamp**. Two messages written in
  the same millisecond are indistinguishable by time.
- The widget polls every 12s only while the panel is open, and stops on
  `visibilitychange`. An open panel used to hold the interval forever — the
  Node test runner hanging is what surfaced it.

## 6d. Alerting — built 2026-08-30

`internal/alerts` pages the owner on WhatsApp when the service itself fails.

- **Only panics and 5xx.** A 404/401/422 is the service working correctly.
- Deduplicated by fingerprint (kind|where|status) with a 15-minute cooldown and
  a suppressed count; hard capped at 12/hour with the last slot reserved for a
  message saying it has gone quiet.
- Alerts carry a route with ids stripped (`safeRoute`), a status, an error class
  and a request id. Never a prompt, transcript, email or token.
- WhatsApp Cloud API needs an **approved template** to reach a phone outside the
  24-hour service window, which is when alerts actually fire. Set
  `ALERT_WHATSAPP_TEMPLATE`. Without it, alerts only arrive inside the window.
- Credentials absent → `Enabled()` false → the service runs exactly as before.

---

## 6e. Visitor journey tracking — built 2026-08-30

Where a lead came from, which pages they read, how long they spent. The
differentiator; treat its bounds as load-bearing.

- `POST /widget/v1/sessions/{id}/activity`, batched every 15s by the widget and
  flushed on pagehide. `model.VisitorJourney` hangs off the Session.
- **Every field is capped.** Page views are the highest-volume thing a visitor
  can make this service store, and the store is one file read back at boot
  through a size limit. 50 pages per session, 20 per batch, oldest dropped.
- Engaged time is tab-visible-AND-focused only. A tab open overnight adds zero.
- **No IP geolocation.** Region comes from the browser time zone, is
  approximate, and `region_is_approximate` says so in the payload, not just the
  UI. Referrer is host-only. Click ids are booleans, never stored. Paths have
  their query strings stripped.
- sendBeacon is NOT usable: it sets no headers and the session token is one.
  The widget uses a keepalive fetch. Do not fix this with a public route.

## 6f. Retention and growth caps — built 2026-08-30

Read this before changing anything that writes to the store.

- The boot read limit is 1GiB (was 64MiB, which measured as unbootable at ~97k
  messages). Crossing it is now an operator-readable error, not a crash loop.
- Hourly sweep: conversations older than 90 days and their messages, jobs older
  than 7 days. **Leads are never deleted.**
- `maxSessionsPerVisitor = 12`. Without it one IP could write 94MB/day through
  the public session route and brick every tenant in ~17 hours.
- `persistLocked` writes compact and buffered. Do not reinstate `SetIndent`:
  measured 4x the time and 5x the allocation for a file no human reads.
- **`store.Update` rollback decodes into a FRESH State.** encoding/json MERGES
  into an existing value, so the old restore left every omitempty field the
  rejected callback had written -- a 422 on a published agent changed what the
  widget served to visitors.

## 6g. Website import — built 2026-08-30

`internal/fetcher` is mostly SSRF guards and that is the point: https only,
every resolved IP checked at DIAL time (not by hostname -- a public name
resolving to 169.254.169.254 is trivial), every redirect hop re-checked, no
credentials, size cap, deadline. Verified against real addresses.

Two endpoints on purpose: `POST /v1/agents/{id}/sources/fetch` returns the
extracted text for review, then the existing sources endpoint saves it.

## 6h. Prompt and token budget — changed 2026-08-30

- Knowledge block capped at 16k chars, checked BEFORE each append. The old 40k
  guard was checked after, overshooting by a quarter.
- **Retrieval REPLACES the knowledge dump.** It used to be added on top, paying
  twice for the same facts.
- History is 12 turns, not 30.
- `max_tokens` and `reasoning_effort` are now explicit. Verified live: one
  exchange cost 236 total tokens at medium against 185 at low.

---

## 6i. What an integration is FOR — built 2026-08-30

`internal/composio/capability.go` is the single place that answers "what will
connecting this app do". Three jobs, because there are only three things this
product sends elsewhere:

| Job | Apps |
|---|---|
| `calendar` | Google Calendar, Outlook, Cal.com, Calendly |
| `leads` | HubSpot, Google Sheets |
| `notify` | Slack, Gmail |

`GET /v1/integrations/roles` serves the table. An app NOT in it can still be
connected and the screen must say plainly that nothing is wired to it yet — the
outbound webhook already reaches everything else through Zapier/Make/n8n. A test
fails if any listed app has no use case, or if an advertised calendar cannot
actually be driven.

## 6n. Lead delivery — built 2026-08-30

`internal/api/lead_routing.go` + `internal/composio/delivery.go`. A captured lead
also lands in the app the customer connected.

**Polled, not called from the lead handler.** The obvious design — one line in
`widgetLead` saying "also send it to HubSpot" — puts a customer's CRM on the
widget request path and loses the lead on a restart between the write and the
send. Reading committed state on an interval makes the durable fact the trigger.
Same shape as the outbound webhook dispatcher, deliberately.

**The watermark starts at process start**, so connecting a CRM never replays
weeks of history as notifications. A bounded batch per pass, and the watermark
only advances as far as what was actually attempted — advancing past an untried
remainder would skip it forever.

**Circuit breaker at 5 consecutive failures.** Revoked credentials would
otherwise cost one paid request per lead forever. Saving the route releases it,
because editing the setting is somebody fixing what broke; leaving it latched
means a destination that can only come back through support.

Per ACCOUNT, not per agent — a customer's CRM is their CRM. The list of direct
destinations is short on purpose; the outbound webhook stays the answer for the
long tail, and the screen says so rather than implying 1,400 apps receive leads.

## 6j. Calendars — built 2026-08-30

`internal/composio/calendars.go`. **One calendar per agent**, deliberately: an
agent stands for one job and "when are you free" needs a single answer.

Two shapes, and the difference is load-bearing:

- **Free/busy** (Google, Outlook) answer "when am I busy". We invert against the
  owner's working day ourselves. Our rule.
- **Scheduling** (Cal.com, Calendly) already own an event type with its own
  availability, buffers and limits. We ask THEM what is bookable and take it —
  re-deriving would fight rules the customer set there.
- **Calendly cannot be booked through an API at all**; it finishes on its own
  page. `booking.completes_elsewhere` tells the widget BEFORE a visitor picks a
  time.

`BookingConfig.Calendar` empty means `googlecalendar` — that is what it meant
when it was written, and stored blanks must keep meaning it. A provider missing
its one setting (Cal.com event type, Calendly URL) is refused at save time.

## 6k. Appointments — built 2026-08-30

`GET /v1/appointments` reads from the LEADS Garuda records per booking, not from
the calendars. One read instead of one API call per connected calendar, no
per-provider failure mode, and it still answers after a calendar is
disconnected. **The honest limit:** an appointment moved or cancelled inside the
customer's own calendar is not reflected, because nothing tells us. The payload
says so in `reflects_changes_made_in_the_calendar`, not just the UI.

## 6l. Widget voice messages — built 2026-08-30

`POST /widget/v1/sessions/{id}/voice` transcribes via Deepgram and **hands the
words back without sending them**. The visitor sees what was heard and presses
send. Speech recognition is wrong sometimes and a misheard sentence sent to
somebody's business is worse than an extra tap; and one chat path means one
place where quota, consent and storage are decided.

Billed to the CUSTOMER whose site it is, through the same hourly budget the
portal's voice onboarding uses. Entitlement is checked before a byte is read —
this route needs no login. **The audio is never stored.** A failed transcription
does not refund the reservation: refunding would open a free unmetered channel.

## 6m. Reply length — changed 2026-08-30

`chatStyleRule` in `agents.go` is appended to every chat prompt, NOT written into
the customer's instructions — they would delete it by accident and nobody would
notice until the bill. Measured live: 340 chars and 89 completion tokens became
203 and 55, and the shorter answer was better.

`chatMaxTokens` is 1,200 and is a CEILING, not a target. This is a reasoning
model and spends ~300 tokens thinking before it writes; a budget tight enough to
force brevity would truncate mid-sentence. The instruction is the right lever.
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
- Alerting, Meta conversion tracking and the Meta pixel are built but have no
  credentials yet -- see the morning list
- The frontend now exposes three NEXT_PUBLIC_* variables, not two:
  NEXT_PUBLIC_API_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_SITE_URL, plus
  NEXT_PUBLIC_META_PIXEL_ID once the pixel is configured

---

## 11. Working agreements

- Verify claims against the running system rather than asserting them. Several
  confident statements here turned out to be wrong — a broken test of my own reported
  the Supabase migrations as unapplied when they were fine.
- Prove every regression test by reverting the fix and watching it fail.
- Never `pkill -f` a pattern that also matches the shell running it.
- Scan for secrets before every push. A QA agent once left a test JWT in the tree.
