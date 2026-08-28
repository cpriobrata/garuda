# Garuda frontend

Next.js App Router portal built with TypeScript, Tailwind CSS, and local shadcn/ui-style components.

## Run locally

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

The UI runs in an instant demo mode when `NEXT_PUBLIC_API_URL` is not set. Set it to the Go API origin (for example `http://localhost:8080`) to use real `/v1` endpoints. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to a Google Identity Services Web client ID to enable the official Google button in connected mode. No Google client secret belongs in the frontend.

Both `NEXT_PUBLIC_*` values are embedded by Next.js at build time. Pass them as Docker build arguments and rebuild the web image whenever either value changes; runtime-only environment changes do not rewrite an existing browser bundle.

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

## Main routes

- `/` — marketing site and interactive agent demo
- `/auth/sign-up`, `/auth/verify-email`, `/auth/sign-in`, `/auth/forgot-password`, `/auth/reset-password`
- `/checkout`, `/checkout/success`
- `/app/onboarding`, `/app/generating`
- `/app` — dashboard overview
- `/app/agents`, `/app/agents/new`, `/app/agents/[id]`
- `/app/conversations`, `/app/leads`, `/app/widget`
- `/app/settings`, `/app/billing`

## API behavior

`lib/api.ts` normalizes `NEXT_PUBLIC_API_URL` to `${origin}/v1`, unwraps the shared `{ data }` envelope, surfaces typed `{ error }` responses, and attaches the active Bearer token. Access and rotated refresh tokens are kept in tab-scoped session storage; one race-safe, single-flight refresh and request replay is attempted after a 401. Email verification and password-recovery tokens are consumed from the URL, immediately removed from the address bar, and retained only in page memory. Checkout sends no amount or Price ID: the backend selects the configured Stripe Price.

Connected sign-in and sign-up render the official Google Identity Services control. If Google matches an existing password account, the inline confirmation flow obtains a normal Garuda session and calls the protected link endpoint; the Google credential and password are never written to browser storage.

The embedded widget snippet uses only the public agent key. The loader creates an agent-scoped opaque visitor token and widget session; portal credentials are never exposed to the host website.
