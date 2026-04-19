#!/usr/bin/env bash
# LOAR Video Skill — Install validator
#
# Run when the skill is installed into OpenClaw / Hermes / any MCP host.
# Verifies that the environment has what the skill needs to function
# and prints a copy-paste MCP config block.
#
# Exit codes:
#   0  OK, skill ready to use
#   1  Missing required env / binary
#   2  LOAR server unreachable or key invalid

set -u

readonly SKILL_NAME="loar-video"
readonly MIN_NODE_MAJOR=18
readonly DEFAULT_SERVER_URL="https://api.loar.fun"

# ── Color helpers (no-op if not a TTY) ───────────────────────────────────
if [ -t 1 ]; then
  readonly C_RED=$'\033[31m'
  readonly C_GREEN=$'\033[32m'
  readonly C_YELLOW=$'\033[33m'
  readonly C_BLUE=$'\033[34m'
  readonly C_DIM=$'\033[2m'
  readonly C_RESET=$'\033[0m'
else
  readonly C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_DIM="" C_RESET=""
fi

fail() { printf "%s[fail]%s %s\n" "$C_RED" "$C_RESET" "$1" >&2; }
warn() { printf "%s[warn]%s %s\n" "$C_YELLOW" "$C_RESET" "$1" >&2; }
ok()   { printf "%s[ ok ]%s %s\n" "$C_GREEN" "$C_RESET" "$1"; }
info() { printf "%s[info]%s %s\n" "$C_BLUE" "$C_RESET" "$1"; }

# ── 1. Node ──────────────────────────────────────────────────────────────

if ! command -v node >/dev/null 2>&1; then
  fail "node is not installed (need >= ${MIN_NODE_MAJOR})"
  echo "       install: https://nodejs.org"
  exit 1
fi

node_major=$(node -p "process.versions.node.split('.')[0]")
if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
  fail "node ${node_major} is too old (need >= ${MIN_NODE_MAJOR})"
  exit 1
fi
ok "node $(node --version)"

# ── 2. LOAR_API_KEY ──────────────────────────────────────────────────────

if [ -z "${LOAR_API_KEY:-}" ]; then
  fail "LOAR_API_KEY is not set"
  cat <<EOF

       Get one from https://loar.fun (Settings → API Keys).
       The key must have the 'mcp_server' scope. Then:

         export LOAR_API_KEY=loar_...
         ./setup.sh

EOF
  exit 1
fi

if [[ "$LOAR_API_KEY" != loar_* ]]; then
  fail "LOAR_API_KEY does not look valid (expected prefix 'loar_')"
  exit 1
fi
ok "LOAR_API_KEY present (prefix: ${LOAR_API_KEY:0:12}…)"

# ── 3. LOAR_SERVER_URL ───────────────────────────────────────────────────

server_url="${LOAR_SERVER_URL:-$DEFAULT_SERVER_URL}"
if [[ "$server_url" != http://* && "$server_url" != https://* ]]; then
  fail "LOAR_SERVER_URL must start with http:// or https:// (got: $server_url)"
  exit 1
fi
ok "server: $server_url"

# ── 4. Reachability + auth check ─────────────────────────────────────────

info "pinging server..."
http_status=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $LOAR_API_KEY" \
  --max-time 10 \
  "$server_url/trpc/credits.getBalance" 2>/dev/null || echo "000")

case "$http_status" in
  200|201)
    ok "server reachable, key accepted"
    ;;
  401|403)
    fail "server reachable but key rejected (HTTP $http_status)"
    echo "       the key may be revoked, expired, or missing the 'mcp_server' scope"
    exit 2
    ;;
  404)
    # Expected if the server only has /api/trpc or the endpoint moved; try legacy header
    http_status=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "X-API-Key: $LOAR_API_KEY" \
      --max-time 10 \
      "$server_url/trpc/credits.getBalance" 2>/dev/null || echo "000")
    if [ "$http_status" = "200" ]; then
      warn "server accepted legacy X-API-Key header; consider rotating the key to a Bearer-scoped one"
    else
      fail "server returned $http_status (path not found — server version too old?)"
      exit 2
    fi
    ;;
  000)
    fail "could not reach $server_url (network error / DNS / firewall)"
    exit 2
    ;;
  *)
    fail "server returned HTTP $http_status"
    exit 2
    ;;
esac

# ── 5. Check that the key has mcp_server scope (best-effort) ─────────────

info "checking key scope..."
scope_check=$(curl -s \
  -H "Authorization: Bearer $LOAR_API_KEY" \
  --max-time 10 \
  "$server_url/trpc/apiKeys.self" 2>/dev/null || echo "{}")

if echo "$scope_check" | grep -q '"mcp_server"'; then
  ok "key has 'mcp_server' scope"
elif echo "$scope_check" | grep -q '"admin.all"'; then
  warn "key has 'admin.all' — that is internal-only and should not be used for skills"
else
  warn "could not verify 'mcp_server' scope on this key"
  warn "the skill may hit rate limits or fail on some tools if the scope is missing"
fi

# ── 6. Print MCP config block ────────────────────────────────────────────

cat <<EOF

${C_GREEN}${SKILL_NAME} ready.${C_RESET}

Copy this into your MCP host config:

  ${C_DIM}# OpenClaw / Claude Desktop / Cursor / most MCP clients:${C_RESET}
  {
    "mcpServers": {
      "loar": {
        "command": "npx",
        "args": ["-y", "@loar/mcp-server"],
        "env": {
          "LOAR_SERVER_URL": "$server_url",
          "LOAR_API_KEY": "${LOAR_API_KEY:0:12}…<rest of key>"
        }
      }
    }
  }

  ${C_DIM}# Hosted SSE (no local Node process):${C_RESET}
  {
    "mcpServers": {
      "loar": {
        "url": "https://mcp.loar.fun/sse",
        "oauth": true
      }
    }
  }

Docs: https://loar.fun/docs/agent-integration

EOF

exit 0
