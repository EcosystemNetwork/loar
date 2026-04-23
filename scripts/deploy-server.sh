#!/usr/bin/env bash
#
# deploy-server.sh — production deploy runner.
#
# INF-8: previously this logic lived inline in .github/workflows/deploy.yml
# as a heredoc inside an `ssh` invocation. That made it invisible to normal
# source review, hard to test locally, and easy to introduce shell-injection
# regressions via secret interpolation. Keeping the runner in-repo means
# every change to production-deploy behaviour goes through code review like
# any other diff, and an operator can run the same script manually for
# disaster recovery.
#
# Called from .github/workflows/deploy.yml via:
#   ssh $SSH_USER@$SSH_HOST 'cd $WORK_DIR && ./scripts/deploy-server.sh'
#
# Preconditions (set by CI env):
#   - cwd is the deploy checkout (a git working tree tracking origin/main).
#   - docker-compose.prod.yml + scripts/smoke-test.sh + scripts/rollback.sh
#     are present (checked in at repo root).
#
# Exit codes:
#   0  deploy + smoke test succeeded
#   1  readiness timeout or smoke failure (rollback attempted)
#   2  precondition violation (no git repo, missing files)
#
set -euo pipefail

log() { printf '[deploy] %s\n' "$*"; }
die() { log "ERROR: $*"; exit "${2:-1}"; }

[ -d .git ] || die "not a git repo (cwd=$PWD)" 2
[ -f docker-compose.prod.yml ] || die "docker-compose.prod.yml missing" 2
[ -x scripts/smoke-test.sh ] || chmod +x scripts/smoke-test.sh || die "cannot chmod smoke-test.sh" 2
[ -x scripts/rollback.sh ] || chmod +x scripts/rollback.sh || die "cannot chmod rollback.sh" 2

# ── 1. Record rollback point ─────────────────────────────────────────
PREV_SHA=$(git rev-parse HEAD 2>/dev/null || echo "none")
DEPLOY_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log "Previous SHA : $PREV_SHA"

# ── 2. Pull latest code ──────────────────────────────────────────────
git pull origin main
CURRENT_SHA=$(git rev-parse HEAD)
log "Current SHA  : $CURRENT_SHA"

printf 'PREV_SHA=%s\nCURRENT_SHA=%s\nDEPLOY_TIME=%s\n' \
  "$PREV_SHA" "$CURRENT_SHA" "$DEPLOY_TIME" > .loar-deploy

# ── 3. Build & start containers ──────────────────────────────────────
SERVER_REPLICAS="${SERVER_REPLICAS:-4}"
WORKER_REPLICAS="${WORKER_REPLICAS:-2}"
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d \
  --scale server="$SERVER_REPLICAS" \
  --scale worker="$WORKER_REPLICAS"
docker compose -f docker-compose.prod.yml ps

# ── 4. Wait for health endpoints (max 90s) ───────────────────────────
log ""
log "Waiting for services to become ready..."
READY=0
for i in $(seq 1 18); do
  SRV=$(curl -sf --max-time 5 http://localhost/health         >/dev/null 2>&1 && echo ok || echo no)
  IDX=$(curl -sf --max-time 5 http://localhost:42069/health   >/dev/null 2>&1 && echo ok || echo no)
  RDS=$(docker compose -f docker-compose.prod.yml exec -T redis redis-cli ping 2>/dev/null | grep -q PONG && echo ok || echo no)
  if [ "$SRV" = "ok" ] && [ "$IDX" = "ok" ] && [ "$RDS" = "ok" ]; then
    READY=1
    log "  All services responding after $((i * 5))s"
    break
  fi
  log "  [$i/18] nginx=$SRV indexer=$IDX redis=$RDS — retrying in 5s..."
  sleep 5
done

if [ "$READY" -eq 0 ]; then
  log "ERROR: Services did not respond within 90s — triggering rollback"
  ROLLBACK_SHA="$PREV_SHA" ./scripts/rollback.sh || true
  printf 'DEPLOY_STATUS=failed_timeout\n' >> .loar-deploy
  exit 1
fi

# ── 5. Smoke tests ───────────────────────────────────────────────────
log ""
if ! ./scripts/smoke-test.sh; then
  log "Smoke tests FAILED — triggering rollback to $PREV_SHA"
  ROLLBACK_SHA="$PREV_SHA" ./scripts/rollback.sh || true
  printf 'DEPLOY_STATUS=failed_smoke\n' >> .loar-deploy
  exit 1
fi

printf 'DEPLOY_STATUS=ok\n' >> .loar-deploy

# ── 6. Summary ───────────────────────────────────────────────────────
REPLICAS=$(docker compose -f docker-compose.prod.yml ps --format '{{.Service}}' | grep -c server || echo "?")
WORKERS=$(docker compose -f docker-compose.prod.yml ps --format '{{.Service}}' | grep -c worker || echo "?")
cat <<EOF

========================================
  Deploy Summary
========================================
  Commit   : $CURRENT_SHA
  App      : https://loar.fun
  API      : https://api.loar.fun
  Indexer  : https://idx.loar.fun
  Servers  : $REPLICAS replicas
  Workers  : $WORKERS replicas
  Redis    : redis:6379
  LB       : nginx:80
  Smoke    : PASSED
  Time     : $DEPLOY_TIME
========================================
EOF
