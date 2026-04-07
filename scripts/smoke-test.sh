#!/usr/bin/env bash
# smoke-test.sh — Post-deploy smoke tests for LOAR services
#
# Usage:
#   ./scripts/smoke-test.sh                            # defaults (localhost)
#   SERVER_URL=https://api.loartech.xyz ./scripts/smoke-test.sh
#   INDEXER_URL=https://idx.loartech.xyz ./scripts/smoke-test.sh
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:3000}"
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
  -H "Origin: https://loartech.xyz" \
  "$SERVER_URL/health" 2>/dev/null \
  | grep -i "access-control-allow-origin" || true)
if [ -n "$CORS" ]; then
  pass "server CORS header present for loartech.xyz"
else
  fail "server CORS header missing for loartech.xyz (check CORS_ORIGIN env var)"
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
