#!/usr/bin/env bash
# rollback.sh — Roll back to the previous deploy
#
# Reads the target SHA from .loar-deploy (written by deploy.yml), then
# resets the repo, rebuilds containers, and verifies with smoke tests.
#
# Usage:
#   ./scripts/rollback.sh                        # reads .loar-deploy
#   ROLLBACK_SHA=abc123 ./scripts/rollback.sh    # explicit SHA
#
# Exit codes:
#   0 — rollback succeeded and smoke tests passed
#   1 — nothing to roll back to (missing SHA)
#   2 — rollback deployed but smoke tests still failed (needs manual action)

set -euo pipefail

STATE_FILE=".loar-deploy"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve target SHA
if [ -n "${ROLLBACK_SHA:-}" ]; then
  TARGET="$ROLLBACK_SHA"
elif [ -f "$STATE_FILE" ]; then
  TARGET=$(grep '^PREV_SHA=' "$STATE_FILE" 2>/dev/null | cut -d= -f2 || true)
fi

if [ -z "${TARGET:-}" ] || [ "$TARGET" = "none" ]; then
  echo "rollback: no previous SHA available. Set ROLLBACK_SHA or ensure .loar-deploy exists." >&2
  exit 1
fi

echo ""
echo "Rolling back to $TARGET ..."

# Ensure the commit is available locally
git fetch origin --quiet

git reset --hard "$TARGET"

# Rebuild and restart
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Give containers time to start before probing
echo "Waiting 20s for services to initialise..."
sleep 20

# Verify the rollback actually works
echo "Running smoke tests on rolled-back deploy..."
if "$SCRIPT_DIR/smoke-test.sh"; then
  echo "Rollback to $TARGET succeeded."

  # Update state file
  printf 'PREV_SHA=\nCURRENT_SHA=%s\nDEPLOY_TIME=%s\nDEPLOY_STATUS=rolled_back\n' \
    "$TARGET" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE_FILE"

  exit 0
else
  echo "" >&2
  echo "ERROR: Smoke tests failed even after rollback to $TARGET." >&2
  echo "       Manual intervention is required." >&2
  echo "       Check: docker compose logs" >&2
  exit 2
fi
