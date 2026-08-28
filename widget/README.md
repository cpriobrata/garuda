# Garuda website widget

The Garuda widget is a dependency-free, Shadow DOM chat client. A host website
loads one versioned JavaScript file and supplies only the public agent key:

```html
<script
  async
  src="https://api.garuda.example/widget.js"
  data-agent-key="pub_live_REPLACE_WITH_PUBLISHED_KEY"
></script>
```

When the asset host is different from the API host, add a validated HTTPS API
origin:

```html
<script
  async
  src="https://widget.garuda.example/v1.js"
  data-agent-key="pub_live_REPLACE_WITH_PUBLISHED_KEY"
  data-api-origin="https://api.garuda.example"
></script>
```

The backend currently serves the loader at `/widget.js`, so the minimal snippet
works without `data-api-origin` when the script and widget API share an origin
or the asset domain reverse-proxies `/widget/v1/*`.

## Runtime behavior

1. The loader validates its publishable key and API origin.
2. It requests public presentation settings from
   `GET /widget/v1/agents/{agentKey}`.
3. It asks the visitor whether this browser may remember the conversation.
4. It creates or resumes a session with `POST /widget/v1/sessions`.
5. Messages use `POST /widget/v1/sessions/{sessionId}/messages` and send the
   short-lived credential in `X-Garuda-Session-Token`.
6. Contact forms use `POST /widget/v1/sessions/{sessionId}/leads`, a stable
   client capture ID, and explicit contact consent.

Only the opaque, agent-scoped visitor token is persisted. Session IDs and signed
session tokens stay in memory. No tenant or organization identifier is accepted
from embed configuration or sent by the client.

The client accepts both JSON chat responses and SSE. Supported stream events are
the canonical `message.start`, `message.delta`, `lead.form`, and
`message.done`, plus the backend's compact `meta`, `delta`, and `done`
event names.

## Consent configuration

`data-memory-consent` supports:

- `prompt` (default): show an in-widget choice and remember that choice.
- `true`: use returning-visitor memory immediately. Set this only after the
  host site's consent manager has permission.
- `false`: always create an ephemeral chat and do not store a visitor token.

`data-analytics-consent="true"` forwards analytics consent during bootstrap.
It is false by default. `data-launcher-label`, `data-open`, and
`data-z-index` are optional presentation controls.

## Local demo

No API or package install is required:

```powershell
cd widget
npm run build
npm run demo
```

Open `http://127.0.0.1:4173`. Demo mode uses seeded replies and keeps consented
chat history in local storage so a reload demonstrates returning-session memory.
It never sends data over the network and does not persist submitted contact
fields.

## Build and verification

```powershell
npm run check
npm test
npm run build
```

The build has no runtime or development dependencies. It stamps the package
version into `dist/v1.js` and rejects HTML injection sinks before writing the
artifact.

## Security and deployment notes

- All agent names, messages, prompts, notices, and form values are rendered with
  DOM `textContent` or input properties. Untrusted HTML is never interpreted.
- Colors, positions, URLs, list sizes, key formats, restored message counts, and
  content lengths are bounded before use.
- The API must allow each approved customer origin through CORS and allow the
  `Content-Type` and `X-Garuda-Session-Token` request headers.
- A Content Security Policy should allow the versioned widget script origin in
  `script-src` and the API origin in `connect-src`. The Shadow DOM theme uses
  an injected style element, so strict host policies may also need an approved
  style strategy or nonce-aware distribution variant.
- Serve immutable versioned assets with a long cache lifetime. Keep
  `/widget.js` short-cached only when it is an alias to a versioned build.
- Do not put messages, contact fields, visitor tokens, or session tokens in URLs
  or application logs.
