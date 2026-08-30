#!/usr/bin/env bash
# Prove a deployment actually works, from outside it.
#
# Every check here goes over the public internet against the real service, in
# the order a real visitor exercises it. It creates a genuine widget session on
# a published agent and sends a genuine message, because the failures that
# matter are the ones that only appear when the whole chain is connected:
# TLS, the proxy, CORS, the origin allowlist, entitlement, the model provider.
#
# It writes one conversation to the customer's inbox. That is the price of
# testing the real path rather than a mock of it, and it is why AGENT_KEY and
# ORIGIN have to be passed in deliberately rather than defaulted.
#
#   ./smoke-test.sh                                  # public surface only
#   AGENT_KEY=pub_xxx ORIGIN=https://site.example \
#     ./smoke-test.sh                                # plus a real conversation
#
# Exit code is the number of failures, so it is usable from cron or a monitor.

set -uo pipefail

API="${API:-https://api.garuda.ravan.ai}"
SITE="${SITE:-https://garuda.ravan.ai}"
AGENT_KEY="${AGENT_KEY:-}"
ORIGIN="${ORIGIN:-}"

failures=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

status() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null; }

expect() {
  local want="$1" label="$2"; shift 2
  local got; got="$(status "$@")"
  if [ "$got" = "$want" ]; then pass "$label"; else fail "$label (got $got, want $want)"; fi
}

head "Liveness"
expect 200 "the API answers /healthz"                 "$API/healthz"
expect 200 "the API answers /readyz"                  "$API/readyz"
expect 200 "the marketing site answers"               "$SITE"
expect 200 "the help centre answers"                  "$SITE/help"

head "The widget asset"
widget_head="$(curl -sSI --max-time 20 "$API/widget.js" 2>/dev/null)"
if grep -qi '^etag:' <<<"$widget_head"; then pass "the widget carries a validator"; else fail "the widget has no ETag, so every visitor re-downloads it"; fi
if grep -qi '^cache-control:.*max-age' <<<"$widget_head"; then pass "the widget is cacheable"; else fail "the widget has no Cache-Control"; fi
tag="$(grep -i '^etag:' <<<"$widget_head" | tr -d '\r' | sed 's/^[Ee][Tt]ag: //')"
if [ -n "$tag" ]; then
  expect 304 "a returning visitor revalidates rather than re-downloads" -H "If-None-Match: $tag" "$API/widget.js"
fi
size="$(curl -sS -o /dev/null -w '%{size_download}' --max-time 20 -H 'Accept-Encoding: gzip' "$API/widget.js" 2>/dev/null)"
if [ "${size:-0}" -gt 0 ] && [ "${size:-0}" -lt 120000 ]; then pass "the widget is $size bytes on the wire"; else fail "the widget is $size bytes on the wire"; fi

head "Authentication is enforced"
# Every one of these must refuse an anonymous caller. A 200 here is a breach,
# and a 404 means the route was renamed and something is silently broken.
for route in /v1/me /v1/agents /v1/leads /v1/conversations /v1/dashboard \
             /v1/billing/invoices /v1/integrations/catalog /v1/leads/export; do
  expect 401 "$route refuses an anonymous caller" "$API$route"
done

head "Widget routes are session-gated"
for route in handoff activity slots messages; do
  expect 401 "/widget/v1/sessions/{id}/$route needs a session token" \
    -X POST -H 'Content-Type: application/json' -d '{}' "$API/widget/v1/sessions/x/$route"
done

head "Cross-origin rules"
allowed="$(curl -sSI --max-time 20 -X OPTIONS "$API/v1/me" -H "Origin: $SITE" -H 'Access-Control-Request-Method: GET' 2>/dev/null | grep -ci "access-control-allow-origin")"
if [ "$allowed" -ge 1 ]; then pass "the site's own origin is allowed"; else fail "the site's origin is NOT allowed, so the app cannot call the API"; fi
denied="$(curl -sSI --max-time 20 -X OPTIONS "$API/v1/me" -H 'Origin: https://not-garuda.example' -H 'Access-Control-Request-Method: GET' 2>/dev/null | grep -ci "access-control-allow-origin")"
if [ "$denied" -eq 0 ]; then pass "an unknown origin is refused"; else fail "an unknown origin was allowed"; fi

head "TLS and headers"
for header in strict-transport-security x-content-type-options; do
  if curl -sSI --max-time 20 "$API/healthz" 2>/dev/null | grep -qi "^$header:"; then
    pass "$header is set"
  else
    fail "$header is missing"
  fi
done

if [ -z "$AGENT_KEY" ] || [ -z "$ORIGIN" ]; then
  head "Conversation"
  printf '  \033[33mskipped\033[0m  set AGENT_KEY and ORIGIN to exercise a real conversation\n'
else
  head "A real conversation, end to end"
  session="$(curl -sS --max-time 25 -X POST "$API/widget/v1/sessions" \
    -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
    -d "{\"agent_key\":\"$AGENT_KEY\",\"page\":{\"url\":\"$ORIGIN/\",\"title\":\"Smoke test\"},\"locale\":\"en\",\"consent\":{\"memory\":false,\"analytics\":false}}" 2>/dev/null)"
  sid="$(grep -o '"session_id":"[^"]*"' <<<"$session" | cut -d'"' -f4)"
  stok="$(grep -o '"session_token":"[^"]*"' <<<"$session" | cut -d'"' -f4)"

  if [ -n "$sid" ] && [ -n "$stok" ]; then
    pass "a visitor can start a conversation"
  else
    fail "a visitor cannot start a conversation: $(head -c 160 <<<"$session")"
  fi

  if [ -n "$stok" ]; then
    expect 204 "the widget can report a page view" \
      -X POST -H 'Content-Type: application/json' -H "X-Garuda-Session-Token: $stok" -H "Origin: $ORIGIN" \
      -d '{"pages":[{"path":"/","title":"Smoke test","seconds":5}]}' \
      "$API/widget/v1/sessions/$sid/activity"

    reply="$(curl -sS --max-time 60 -X POST "$API/widget/v1/sessions/$sid/messages" \
      -H 'Content-Type: application/json' -H 'Accept: application/json' \
      -H "X-Garuda-Session-Token: $stok" -H "Origin: $ORIGIN" \
      -d '{"client_message_id":"smoke-1","content":"What do you do?"}' 2>/dev/null)"
    # The assertion is that a real answer came back with real words in it. An
    # empty or one-word reply means the model call failed and something
    # answered anyway, which is the failure most likely to go unnoticed.
    content="$(grep -o '"content":"[^"]*"' <<<"$reply" | head -1 | cut -d'"' -f4)"
    if [ "${#content}" -gt 40 ]; then
      pass "the agent answered (${#content} characters)"
    else
      fail "the agent did not answer usefully: $(head -c 160 <<<"$reply")"
    fi
  fi
fi

head "Result"
if [ "$failures" -eq 0 ]; then
  printf '  \033[32mall checks passed\033[0m\n\n'
else
  printf '  \033[31m%d check(s) failed\033[0m\n\n' "$failures"
fi
exit "$failures"
