#!/usr/bin/env bash
# ============================================
# Sync Vercel env vars for the LOAR web deploy
# ============================================
# Only VITE_* vars are needed (Vite SPA).
# Plus a few build-time vars like CORS_ORIGIN.
#
# Usage: bash scripts/sync-vercel-env.sh
# Requires: vercel CLI logged in & linked

set -euo pipefail
cd "$(dirname "$0")/.."

echo "🧹 Phase 1: Removing vars that don't belong in a Vite frontend deploy..."

# Vars to REMOVE — server-only secrets & stale DB vars that Vite can't use
REMOVE_VARS=(
  # Firebase without VITE_ prefix — Vite ignores these
  "FIREBASE_API_KEY"
  "FIREBASE_AUTH_DOMAIN"
  "FIREBASE_PROJECT_ID"
  "FIREBASE_MESSAGING_SENDER_ID"
  "FIREBASE_APP_ID"
  "FIREBASE_SERVICE_ACCOUNT_PATH"
  "FIREBASE_STORAGE_BUCKET"
  # Server-only secrets
  "PRIVATE_KEY"
  "PORT"
  "OPENAI_API_KEY"
  "GOOGLE_API_KEY"
  "FAL_KEY"
  "MESHY_API_KEY"
  "PONDER_RPC_URL_2"
  # Stale DB vars (no database in web frontend)
  "DATABASE_URL"
  "DATABASE_URL_UNPOOLED"
  "POSTGRES_USER"
  "POSTGRES_PRISMA_URL"
  "POSTGRES_URL_NO_SSL"
  "POSTGRES_URL_NON_POOLING"
  "POSTGRES_URL"
  "POSTGRES_PASSWORD"
  "POSTGRES_DATABASE"
  "POSTGRES_HOST"
  "PGPASSWORD"
  "PGHOST"
  "PGHOST_UNPOOLED"
  "PGUSER"
  "PGDATABASE"
  "NEON_PROJECT_ID"
  # CDP secrets (server-only)
  "CDP_API_KEY"
  "CDP_API_SECRET"
  "CDP_PROJECT_ID"
  # Old admin email var
  "VITE_ADMIN_EMAILS"
)

for var in "${REMOVE_VARS[@]}"; do
  echo "  Removing $var..."
  # Remove from all environments; ignore errors if not found
  vercel env rm "$var" production -y 2>/dev/null || true
  vercel env rm "$var" preview -y 2>/dev/null || true
  vercel env rm "$var" development -y 2>/dev/null || true
done

echo ""
echo "✅ Phase 2: Adding correct VITE_* vars for Production + Preview..."

# Helper: add a var to production + preview (overwrites if exists)
add_env() {
  local name="$1"
  local value="$2"
  echo "  Setting $name"
  echo -n "$value" | vercel env add "$name" production --force 2>/dev/null || true
  echo -n "$value" | vercel env add "$name" preview --force 2>/dev/null || true
}

# ── Production URLs ──────────────────────────────────────────
add_env "VITE_SERVER_URL"               "https://api.loar.fun"
add_env "VITE_PONDER_URL"               "https://idx.loar.fun"

# ── Public contract addresses ────────────────────────────────
# Per-chain addresses (LOAR token, manager, routers, etc.) are compiled in
# apps/web/src/configs/addresses.ts — only treasury remains env-driven.
add_env "VITE_TREASURY_ADDRESS"         "0x116C28e6DCABCa363f83217C712d79DCE168d90e"

# ── Firebase web client — INTENTIONALLY NOT SYNCED ───────────
# apps/web has no `firebase` dependency and never calls getFirestore() or
# getStorage(); the VITE_FIREBASE_* vars in apps/web/src/lib/env.ts are
# vestigial and all optional. All Firestore/Storage access is server-side
# via the Admin SDK.
#
# Publishing these to the web bundle handed anyone reading the JS the exact
# bucket name (`loar-db.firebasestorage.app`) and project id — the only two
# things needed to exercise Storage rules directly. That mattered: the
# Storage ruleset was the console starter template (world read+write) from
# 2026-04-19 until it expired 2026-05-18. See storage.rules.
#
# Don't re-add these unless the client SDK is genuinely adopted. If it ever
# is, restrict the browser API key by HTTP referrer and turn on App Check
# first — and note the key below is burned, having been committed here in
# plaintext; generate a fresh one rather than reusing it.
#   (was: VITE_FIREBASE_API_KEY = AIzaSyBw0t7WI6W9sHL5UQi2XG7CZ9jVosGNdRU)
#
# NOTE: this only stops FUTURE syncs. Vars already set on Vercel must be
# removed explicitly:
#   for v in PROJECT_ID API_KEY AUTH_DOMAIN STORAGE_BUCKET MESSAGING_SENDER_ID APP_ID; do
#     vercel env rm "VITE_FIREBASE_$v" production -y
#     vercel env rm "VITE_FIREBASE_$v" preview -y
#   done

echo ""
echo "🎉 Done! Run 'vercel env ls' to verify."
echo "   Then trigger a redeploy: vercel --prod"
