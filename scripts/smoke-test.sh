#!/usr/bin/env bash
# smoke-test.sh — Post-deploy smoke tests for LOAR services
#
# Usage:
#   ./scripts/smoke-test.sh                            # defaults (localhost)
#   SERVER_URL=https://api.loar.fun ./scripts/smoke-test.sh
#   INDEXER_URL=https://idx.loar.fun ./scripts/smoke-test.sh
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost}"
INDEXER_URL="${INDEXER_URL:-http://localhost:42069}"
PASS=0
FAIL=0

# ANSI colours — disabled when not writing to a terminal
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  GREEN='' RED='' BOLD='' NC=''
fi

pass() { PASS=$((PASS + 1)); printf "${GREEN}  ✓${NC} %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "${RED}  ✗${NC} %s\n" "$1"; }

echo ""
printf "${BOLD}LOAR Smoke Tests${NC}\n"
echo "  Server  : $SERVER_URL"
echo "  Indexer : $INDEXER_URL"
echo ""

# ── Server ────────────────────────────────────────────────────────────────────

# 1. Server health endpoint must report healthy (Firebase reachable)
RESP=$(curl -sf --max-time 10 "$SERVER_URL/health" 2>/dev/null) || RESP=""
if echo "$RESP" | grep -q '"status":"healthy"'; then
  pass "server /health → healthy"
elif echo "$RESP" | grep -q '"status":"degraded"'; then
  fail "server /health → degraded (Firebase unreachable — check FIREBASE_SERVICE_ACCOUNT)"
else
  fail "server /health → unreachable or unexpected response"
fi

# 2. Server root must serve HTTP 200
HTTP=$(curl -sf --max-time 10 -o /dev/null -w "%{http_code}" "$SERVER_URL/" 2>/dev/null) || HTTP="000"
if [ "$HTTP" = "200" ]; then
  pass "server / → 200 OK"
else
  fail "server / → HTTP $HTTP (expected 200)"
fi

# 3. Server returns CORS header for the production origin
CORS=$(curl -sf --max-time 10 -I \
  -H "Origin: https://loar.fun" \
  "$SERVER_URL/health" 2>/dev/null \
  | grep -i "access-control-allow-origin" || true)
if [ -n "$CORS" ]; then
  pass "server CORS header present for loar.fun"
else
  fail "server CORS header missing for loar.fun (check CORS_ORIGIN env var)"
fi

# ── Auth & tRPC ───────────────────────────────────────────────────────────────

# 4. tRPC credit packages endpoint must respond (public)
RESP=$(curl -sf --max-time 10 \
  "$SERVER_URL/trpc/credits.getPackages" 2>/dev/null) || RESP=""
if echo "$RESP" | grep -q '"result"'; then
  pass "tRPC credits.getPackages → returns result"
else
  fail "tRPC credits.getPackages → unexpected response (tRPC may not be mounted)"
fi

# 5. tRPC credit costs endpoint must respond (public)
RESP=$(curl -sf --max-time 10 \
  "$SERVER_URL/trpc/credits.getCosts" 2>/dev/null) || RESP=""
if echo "$RESP" | grep -q '"result"'; then
  pass "tRPC credits.getCosts → returns result"
else
  fail "tRPC credits.getCosts → unexpected response"
fi

# 6. Protected endpoint must reject unauthenticated requests
HTTP=$(curl -sf --max-time 10 -o /dev/null -w "%{http_code}" \
  "$SERVER_URL/trpc/credits.getBalance" 2>/dev/null) || HTTP="000"
if [ "$HTTP" = "401" ]; then
  pass "tRPC credits.getBalance → 401 (auth enforced)"
elif [ "$HTTP" = "200" ]; then
  fail "tRPC credits.getBalance → 200 without auth (SECURITY: auth not enforced!)"
else
  fail "tRPC credits.getBalance → HTTP $HTTP (expected 401)"
fi

# 7. Admin-only grant endpoint must reject unauthenticated requests
HTTP=$(curl -sf --max-time 10 -o /dev/null -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d '{"targetUid":"x","credits":1,"reason":"test"}' \
  "$SERVER_URL/trpc/credits.grant" 2>/dev/null) || HTTP="000"
if [ "$HTTP" = "401" ]; then
  pass "tRPC credits.grant → 401 (admin auth enforced)"
elif [ "$HTTP" = "200" ]; then
  fail "tRPC credits.grant → 200 without auth (CRITICAL: admin endpoint open!)"
else
  # 403 or other non-200 is acceptable — the endpoint is protected
  pass "tRPC credits.grant → HTTP $HTTP (protected)"
fi

# 8. Stripe availability check (informational — not a blocker)
RESP=$(curl -sf --max-time 10 \
  "$SERVER_URL/trpc/stripe.isAvailable" 2>/dev/null) || RESP=""
if echo "$RESP" | grep -q '"available":true'; then
  pass "Stripe → configured and available"
elif echo "$RESP" | grep -q '"available":false'; then
  pass "Stripe → not configured (card payments disabled — expected if no STRIPE_SECRET_KEY)"
else
  fail "Stripe → isAvailable endpoint unreachable"
fi

# 9. Treasury pool balance endpoint (public)
RESP=$(curl -sf --max-time 10 \
  "$SERVER_URL/trpc/universeTreasury.getPoolBalance?input=%7B%22universeId%22%3A%22test%22%7D" \
  2>/dev/null) || RESP=""
if echo "$RESP" | grep -q '"result"'; then
  pass "tRPC universeTreasury.getPoolBalance → returns result"
else
  fail "tRPC universeTreasury.getPoolBalance → unexpected response"
fi

# ── Infrastructure (Redis, Queue, Circuit Breakers) ──────────────────────────

# 10. Health endpoint must report Redis and queue status
HEALTH=$(curl -sf --max-time 10 "$SERVER_URL/health" 2>/dev/null) || HEALTH=""
if echo "$HEALTH" | grep -q '"redis":"ok"'; then
  pass "Redis → connected and healthy"
elif echo "$HEALTH" | grep -q '"redis":"not_configured"'; then
  fail "Redis → not configured (REDIS_URL not set — no queue, no distributed rate limiting)"
elif echo "$HEALTH" | grep -q '"redis":"degraded"'; then
  fail "Redis → degraded (connection issues)"
else
  fail "Redis → status unknown (check /health response)"
fi

# 11. Queue should be initialized
if echo "$HEALTH" | grep -q '"queue":"ok"'; then
  pass "BullMQ queue → healthy"
elif echo "$HEALTH" | grep -q '"queue"'; then
  fail "BullMQ queue → degraded or not initialized"
else
  pass "BullMQ queue → not reported (may not be initialized yet)"
fi

# ── Indexer ───────────────────────────────────────────────────────────────────

# 4. Indexer health endpoint must report healthy (DB reachable)
RESP=$(curl -sf --max-time 20 "$INDEXER_URL/health" 2>/dev/null) || RESP=""
if echo "$RESP" | grep -q '"status":"healthy"'; then
  pass "indexer /health → healthy"
elif echo "$RESP" | grep -q '"status":"degraded"'; then
  fail "indexer /health → degraded (DB unreachable — Ponder may still be syncing)"
else
  fail "indexer /health → unreachable or unexpected response (start period is 30s)"
fi

# 5. Indexer REST API must respond to a parameterised request
HTTP=$(curl -sf --max-time 20 -o /dev/null -w "%{http_code}" \
  "$INDEXER_URL/creator/0x0000000000000000000000000000000000000000/summary" \
  2>/dev/null) || HTTP="000"
if [ "$HTTP" = "200" ]; then
  pass "indexer REST /creator/:address/summary → 200 OK"
else
  fail "indexer REST /creator/:address/summary → HTTP $HTTP (expected 200)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
echo ""
if [ "$FAIL" -eq 0 ]; then
  printf "${GREEN}${BOLD}All $TOTAL smoke tests passed.${NC}\n\n"
  exit 0
else
  printf "${RED}${BOLD}$FAIL of $TOTAL smoke tests FAILED.${NC}\n\n"
  exit 1
fi
