#!/usr/bin/env bash
# deploy-mcp-gateway.sh — Railway deploy helper for the MCP OAuth gateway.
#
# Runs a pre-flight validator, provisions the Railway service (idempotent),
# sets required env vars, and triggers a build. Stops BEFORE the first `up`
# so you can review the state before any external traffic flows.
#
# Usage:
#   ./scripts/deploy-mcp-gateway.sh           # dry-run: validate + print plan
#   ./scripts/deploy-mcp-gateway.sh --apply   # actually run railway commands

set -u
set -o pipefail

APPLY=0
if [ "${1:-}" = "--apply" ]; then
  APPLY=1
fi

if [ -t 1 ]; then
  readonly C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m' C_DIM=$'\033[2m' C_RESET=$'\033[0m'
else
  readonly C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_DIM="" C_RESET=""
fi
fail() { printf "%s[fail]%s %s\n" "$C_RED" "$C_RESET" "$1" >&2; }
warn() { printf "%s[warn]%s %s\n" "$C_YELLOW" "$C_RESET" "$1" >&2; }
ok()   { printf "%s[ ok ]%s %s\n" "$C_GREEN" "$C_RESET" "$1"; }
step() { printf "\n%s▸ %s%s\n" "$C_BLUE" "$1" "$C_RESET"; }
plan() { printf "%s$%s %s\n" "$C_DIM" "$C_RESET" "$1"; }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_ROOT"

# ── 1. Preconditions ────────────────────────────────────────────────────
step "preconditions"

if ! command -v railway >/dev/null 2>&1; then
  fail "railway CLI not installed — run 'npm i -g @railway/cli'"
  exit 1
fi
ok "railway CLI: $(railway --version 2>&1 | head -1)"

if ! railway whoami >/dev/null 2>&1; then
  fail "not logged in — run 'railway login'"
  exit 1
fi
ok "railway auth: $(railway whoami 2>&1 | head -1)"

# ── 2. Validate source state ────────────────────────────────────────────
step "source state"

if [ ! -f apps/mcp-gateway/Dockerfile ]; then
  fail "apps/mcp-gateway/Dockerfile missing"
  exit 1
fi
ok "Dockerfile present"

if [ ! -f apps/mcp-gateway/railway.json ]; then
  fail "apps/mcp-gateway/railway.json missing"
  exit 1
fi
ok "railway.json present"

if ! git diff --quiet apps/mcp-gateway apps/mcp apps/server; then
  warn "apps/mcp-gateway, apps/mcp, or apps/server has uncommitted changes"
  warn "Railway will deploy from the last pushed commit, not your working tree"
fi

# ── 3. Generate required secrets locally (operator copies these) ───────
step "secrets checklist"

cat <<EOF
Before --apply you MUST have generated these secrets (generate with:
  openssl rand -hex 32)

  OAUTH_JWT_SECRET           — signs access tokens issued by the gateway
  MCP_GATEWAY_SERVICE_KEY    — shared with apps/server for internal auth

Upstream apps/server env must also be updated with the SAME value of:
  MCP_GATEWAY_SERVICE_KEY

If these aren't in place, abort and set them first.
EOF

# ── 4. Service name + env var plan ──────────────────────────────────────
step "railway service plan"

SERVICE="${MCP_GATEWAY_SERVICE:-mcp-gateway}"
plan "railway link --project <your-loar-project>"
plan "railway service ${SERVICE}       # select the service"
plan ""

REQUIRED_VARS=(
  "PORT=3334"
  "HOST=0.0.0.0"
  "OAUTH_ISSUER=https://mcp.loar.fun"
  "LOAR_SERVER_URL=https://api.loar.fun"
  "LOAR_WEB_URL=https://loar.fun"
)
SECRET_VARS=(
  "OAUTH_JWT_SECRET"
  "MCP_GATEWAY_SERVICE_KEY"
  "REDIS_URL"
)

for v in "${REQUIRED_VARS[@]}"; do
  plan "railway variables --service ${SERVICE} --set ${v}"
done
for v in "${SECRET_VARS[@]}"; do
  plan "railway variables --service ${SERVICE} --set ${v}=<value>"
done

plan ""
plan "railway domain --service ${SERVICE} add mcp.loar.fun"
plan "railway up --service ${SERVICE}"

# ── 5. Execute or stop ──────────────────────────────────────────────────

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "${C_GREEN}Dry run complete.${C_RESET}"
  echo "To actually execute: ${C_DIM}./scripts/deploy-mcp-gateway.sh --apply${C_RESET}"
  echo "Run from a shell where \$OAUTH_JWT_SECRET, \$MCP_GATEWAY_SERVICE_KEY, and \$REDIS_URL are exported."
  exit 0
fi

# ── --apply: actually run the commands ─────────────────────────────────

if [ -z "${OAUTH_JWT_SECRET:-}" ] || [ -z "${MCP_GATEWAY_SERVICE_KEY:-}" ]; then
  fail "OAUTH_JWT_SECRET and MCP_GATEWAY_SERVICE_KEY must be exported before --apply"
  exit 1
fi

step "executing railway commands (--apply)"

for v in "${REQUIRED_VARS[@]}"; do
  railway variables --service "${SERVICE}" --set "${v}"
done

railway variables --service "${SERVICE}" --set "OAUTH_JWT_SECRET=${OAUTH_JWT_SECRET}"
railway variables --service "${SERVICE}" --set "MCP_GATEWAY_SERVICE_KEY=${MCP_GATEWAY_SERVICE_KEY}"
if [ -n "${REDIS_URL:-}" ]; then
  railway variables --service "${SERVICE}" --set "REDIS_URL=${REDIS_URL}"
fi

ok "env vars set"

warn "About to run 'railway up' — this builds + deploys the service."
warn "Ctrl-C within 5s to abort."
sleep 5

railway up --service "${SERVICE}"

echo
ok "Deploy triggered. Monitor with: railway logs --service ${SERVICE}"
echo
echo "Next steps:"
echo "  1. Add custom domain:  railway domain --service ${SERVICE} add mcp.loar.fun"
echo "  2. Point DNS CNAME to the generated railway target"
echo "  3. Mirror MCP_GATEWAY_SERVICE_KEY into the apps/server env"
echo "  4. Smoke test: curl https://mcp.loar.fun/health"
