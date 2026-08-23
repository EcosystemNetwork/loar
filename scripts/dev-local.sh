#!/usr/bin/env bash
# ============================================
# LOAR — one-command local stack
# ============================================
# Brings up the supporting services this repo needs but does not manage itself
# (Redis + a persistent Firestore emulator), then runs web + server + indexer.
#
#   bash scripts/dev-local.sh          # start everything
#   bash scripts/dev-local.sh --seed   # force re-seed of sample data
#
# Firestore data is persisted to .firebase/emulator-data, so universes and
# characters survive a restart instead of vanishing with the emulator.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EMULATOR_DATA="$ROOT/.firebase/emulator-data"
FORCE_SEED=false
[[ "${1:-}" == "--seed" ]] && FORCE_SEED=true

info() { echo -e "\033[0;34m[dev-local]\033[0m $1"; }
warn() { echo -e "\033[1;33m[dev-local]\033[0m $1"; }

if [ ! -f .env ]; then
  warn ".env not found — copy .env.example to .env and fill it in first."
  exit 1
fi

# ── Redis ────────────────────────────────────────────────────────────────────
# Without it the generation queue is disabled and rate limiting falls back to
# in-memory. Docker is optional here; a system redis-server is enough.
if redis-cli ping >/dev/null 2>&1; then
  info "redis already running"
elif command -v redis-server >/dev/null 2>&1; then
  redis-server --port 6379 --daemonize yes --save '' --appendonly no
  info "started redis on :6379"
else
  warn "redis-server not installed — queue + distributed rate limiting disabled"
fi

# ── Firestore emulator ───────────────────────────────────────────────────────
NEEDS_SEED=false
if curl -sf -m 2 http://127.0.0.1:8080/ >/dev/null 2>&1; then
  info "firestore emulator already running on :8080"
else
  # Seed when there is nothing to import — covers both a first run and a dir
  # that exists but is empty (e.g. a previous session that failed to export).
  if [ ! -d "$EMULATOR_DATA" ] || [ -z "$(ls -A "$EMULATOR_DATA" 2>/dev/null)" ]; then
    mkdir -p "$EMULATOR_DATA"
    NEEDS_SEED=true
    info "no Firestore export found — will seed sample data"
  fi
  # --import replays the previous session, --export-on-exit saves this one.
  firebase emulators:start --only firestore --project loar-db \
    --import "$EMULATOR_DATA" --export-on-exit "$EMULATOR_DATA" \
    >"$ROOT/.firebase/emulator.log" 2>&1 &
  EMULATOR_PID=$!
  # SIGINT, not SIGTERM: firebase-tools only runs its --export-on-exit save on
  # SIGINT. A TERM stops the emulator without writing anything, silently
  # losing the session's data. The wait lets the export finish before we exit.
  cleanup() { kill -INT "$EMULATOR_PID" 2>/dev/null || true; wait "$EMULATOR_PID" 2>/dev/null || true; }
  trap cleanup EXIT INT TERM
  info "starting firestore emulator (logs: .firebase/emulator.log)"
  for _ in $(seq 1 60); do
    curl -sf -m 2 http://127.0.0.1:8080/ >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf -m 2 http://127.0.0.1:8080/ >/dev/null 2>&1 \
    || { warn "emulator failed to start — see .firebase/emulator.log"; exit 1; }
  info "firestore emulator ready on :8080 (UI on :4000)"
fi

if [ "$FORCE_SEED" = true ] || [ "$NEEDS_SEED" = true ]; then
  info "seeding sample data..."
  pnpm -F server exec tsx scripts/seed.ts
fi

# ── Apps ─────────────────────────────────────────────────────────────────────
info "starting web (:3001), server (:3000), indexer (:42069)"
# Deliberately not exec'd: the EXIT trap above has to survive so the emulator
# gets a SIGTERM on Ctrl-C, which is what triggers its --export-on-exit save.
pnpm exec turbo -F web -F server -F indexer dev
