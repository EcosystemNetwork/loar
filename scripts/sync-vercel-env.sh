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
add_env "VITE_LOAR_TOKEN_ADDRESS"       "0xAEC35cAAE68de337711E3bc06b51aaAa5551b63F"
add_env "VITE_TREASURY_ADDRESS"         "0x116C28e6DCABCa363f83217C712d79DCE168d90e"

# ── Firebase web client (public SDK credentials) ─────────────
add_env "VITE_FIREBASE_PROJECT_ID"          "loar-db"
add_env "VITE_FIREBASE_API_KEY"             "AIzaSyBw0t7WI6W9sHL5UQi2XG7CZ9jVosGNdRU"
add_env "VITE_FIREBASE_AUTH_DOMAIN"         "loar-db.firebaseapp.com"
add_env "VITE_FIREBASE_STORAGE_BUCKET"      "loar-db.firebasestorage.app"
add_env "VITE_FIREBASE_MESSAGING_SENDER_ID" "969698925631"
add_env "VITE_FIREBASE_APP_ID"              "1:969698925631:web:0689e201946506fb132c8a"

echo ""
echo "🎉 Done! Run 'vercel env ls' to verify."
echo "   Then trigger a redeploy: vercel --prod"
