#!/usr/bin/env bash
# Ship a new API binary to the server.
#
# WHY THIS EXISTS. Doing it by hand is three commands, and it went wrong twice in
# ways worth never repeating.
#
#   1. scp lost the connection part-way and left a truncated file. The next line
#      moved that truncated file over the working binary, the service could not
#      exec it, and the site was down until somebody looked.
#   2. Retrying the transfer left the FIRST attempt's sftp-server alive on the
#      server, still holding the staged file open for writing. Renaming it into
#      place carried that open handle with the inode, and exec on a file open for
#      writing is ETXTBSY -- so a byte-perfect binary still would not start.
#
# So this script never lets a partial transfer become the running binary, and
# never starts a binary something else still holds open:
#
#   - Upload to a STAGING path that nothing executes.
#   - Compare checksums. A truncated transfer stops here, with the old binary
#     still running and untouched.
#   - Clear anything holding the staged or live file before swapping.
#   - Swap by RENAME, never by writing in place.
#   - Keep the running binary as .prev, so rolling back is a rename.
#   - Prove it answers, and roll back automatically if it does not.
#
# Usage: deploy/release.sh [user@host]
set -euo pipefail

# Both are required rather than defaulted. A server address and a key path baked
# into a repository are the sort of thing that is still there, and still wrong,
# long after the server has moved.
TARGET="${1:-${GARUDA_DEPLOY_TARGET:-}}"
KEY="${GARUDA_DEPLOY_KEY:-}"
REMOTE_DIR=/opt/garuda
HEALTH_URL="${GARUDA_HEALTH_URL:-https://api.garuda.ravan.ai/healthz}"

# ServerAliveInterval keeps a quiet connection from being reaped mid-transfer,
# which is the most likely cause of the truncation this script exists to catch.
SSH_OPTS=(-i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=no
          -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=6)

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$TARGET" ] || fail "Set GARUDA_DEPLOY_TARGET=user@host, or pass it as the first argument."
[ -n "$KEY" ] || fail "Set GARUDA_DEPLOY_KEY to the path of the deploy private key."
[ -r "$KEY" ] || fail "The deploy key at $KEY cannot be read."

cd "$(dirname "$0")/.."

say "Building"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -C backend -trimpath -ldflags "-s -w" -o "$PWD/garuda-api.release" ./cmd/api
trap 'rm -f "$PWD/garuda-api.release"' EXIT

LOCAL_SUM=$(sha256sum garuda-api.release | cut -d' ' -f1)
LOCAL_SIZE=$(wc -c < garuda-api.release | tr -d ' ')
say "Built $LOCAL_SIZE bytes, sha256 ${LOCAL_SUM:0:16}…"

# A dropped connection is a retry, not a failure. Three attempts, because a
# transfer that fails three times is a network problem rather than bad luck.
uploaded=""
for attempt in 1 2 3; do
  say "Uploading (attempt $attempt)"
  if scp "${SSH_OPTS[@]}" -C garuda-api.release "$TARGET:$REMOTE_DIR/garuda-api.staged"; then
    REMOTE_SUM=$(ssh "${SSH_OPTS[@]}" "$TARGET" "sha256sum $REMOTE_DIR/garuda-api.staged | cut -d' ' -f1" || true)
    if [ "$REMOTE_SUM" = "$LOCAL_SUM" ]; then uploaded=yes; break; fi
    say "  checksum mismatch (got ${REMOTE_SUM:0:16}…), retrying"
  else
    say "  transfer failed, retrying"
  fi
done
[ -n "$uploaded" ] || fail "Upload never arrived intact. The running binary was not touched."

# rollback puts back the binary that was running before this release.
rollback() {
  say "Rolling back"
  ssh "${SSH_OPTS[@]}" "$TARGET" '
    cd /opt/garuda
    systemctl stop garuda-api || true
    systemctl reset-failed garuda-api || true
    fuser -k garuda-api >/dev/null 2>&1 || true
    cp -f garuda-api.prev garuda-api.rollback
    chown garuda:garuda garuda-api.rollback && chmod 755 garuda-api.rollback
    mv -f garuda-api.rollback garuda-api
    systemctl start garuda-api
  ' || true
}

say "Swapping and restarting"
# fuser -k takes a FILE, not a pattern, so it can only reach processes actually
# holding this binary -- there is no way for it to match the shell running it.
# That is the whole reason it is used here rather than pkill.
if ! ssh "${SSH_OPTS[@]}" "$TARGET" '
  set -e
  cd /opt/garuda
  systemctl stop garuda-api
  systemctl reset-failed garuda-api || true
  fuser -k garuda-api.staged garuda-api >/dev/null 2>&1 || true
  chown garuda:garuda garuda-api.staged
  chmod 755 garuda-api.staged
  # Keep what was running, so a rollback is a rename rather than a rebuild.
  cp -f garuda-api garuda-api.prev
  mv -f garuda-api.staged garuda-api
  systemctl start garuda-api
'; then
  rollback
  fail "The new binary would not start. Rolled back. Check journalctl -u garuda-api."
fi

say "Verifying"
ok=""
for _ in $(seq 1 15); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL")" = "200" ]; then ok=yes; break; fi
  sleep 2
done

if [ -z "$ok" ]; then
  say "Health check failed."
  rollback
  fail "Rolled back to the previous binary. Check journalctl -u garuda-api."
fi

say "Deployed and answering."
