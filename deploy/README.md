# Deploying the Garuda API

The frontend and widget go to Vercel. This directory covers the Go API, which
needs a real host: it is a long-running process that owns a writable data file,
so it cannot run on Vercel.

Target: `api.garuda.ravan.ai`, proxied by Caddy, on the VPS.

## Prerequisites, in order

1. **DNS.** An A record `api.garuda.ravan.ai` -> the server's public IP.
   Caddy cannot obtain a certificate before this resolves.
2. **SSH access** to the server.
3. **A restricted SendGrid key** (`mail.send` only) and live Stripe keys.

## 1. Build the binary

Built on any machine; the server needs no Go toolchain. The binary is static.

```bash
cd backend
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags "-s -w" -o garuda-api ./cmd/api
```

## 2. Prepare the server, once

```bash
adduser --system --group --home /opt/garuda garuda
mkdir -p /opt/garuda/data
chown -R garuda:garuda /opt/garuda
apt-get update && apt-get install -y caddy
```

## 3. Install

```bash
scp garuda-api root@SERVER:/opt/garuda/garuda-api
scp deploy/env.production.example root@SERVER:/opt/garuda/.env   # then edit it
scp deploy/garuda-api.service root@SERVER:/etc/systemd/system/
scp deploy/Caddyfile root@SERVER:/etc/caddy/Caddyfile

ssh root@SERVER '
  chmod 600 /opt/garuda/.env
  chown garuda:garuda /opt/garuda/.env /opt/garuda/garuda-api
  chmod 755 /opt/garuda/garuda-api
  systemctl daemon-reload
  systemctl enable --now garuda-api
  systemctl reload caddy
'
```

## 4. Verify before pointing the frontend at it

```bash
curl -fsS https://api.garuda.ravan.ai/healthz   # {"data":{"status":"ok",...}}
curl -fsS https://api.garuda.ravan.ai/readyz    # {"data":{"status":"ready"}}
```

Then confirm the safety rails actually engaged:

```bash
# Demo mode must be OFF. If this returns anything with "demo_mode":true, stop.
ssh root@SERVER 'journalctl -u garuda-api -n 20 --no-pager | grep listening'

# An unentitled account must be refused, not served.
curl -s -o /dev/null -w '%{http_code}\n' https://api.garuda.ravan.ai/v1/me   # 401
```

The API refuses to start if `GARUDA_DEMO_MODE=true` alongside a production
environment, an https public URL, or an https allowed origin. If systemd reports
the service failing on boot, read the error before overriding anything -- it is
almost certainly telling you billing would have been disabled.

## 5. Point the frontend at it

In the Vercel project, set and then **redeploy** (these are build-time values):

```
NEXT_PUBLIC_API_URL=https://api.garuda.ravan.ai
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<the web client id>
```

Until `NEXT_PUBLIC_API_URL` is set, `frontend/lib/api.ts` falls back to
`lib/demo-data.ts` and the portal shows mock data. That is the single reason a
deployed frontend looks like it has no backend.

Also add `https://garuda.ravan.ai` to **Authorized JavaScript origins** on the
Google OAuth client, or the sign-in button will fail with `origin_mismatch`.

## Updating later

```bash
scp garuda-api root@SERVER:/opt/garuda/garuda-api.new
ssh root@SERVER 'mv /opt/garuda/garuda-api.new /opt/garuda/garuda-api \
  && chown garuda:garuda /opt/garuda/garuda-api \
  && chmod 755 /opt/garuda/garuda-api \
  && systemctl restart garuda-api'
```

## Back up the database

The entire database is one JSON file. Until Postgres lands, back it up:

```bash
ssh root@SERVER 'cp /opt/garuda/data/garuda.json /opt/garuda/data/garuda.$(date +%F).json'
```

A restore is a file copy and a restart. Rehearse it once before you have
customers, not after.
