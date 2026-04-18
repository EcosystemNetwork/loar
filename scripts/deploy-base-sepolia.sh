#!/usr/bin/env bash
# deploy-base-sepolia.sh
#
# Full deploy + codegen pipeline for Base Sepolia testnet.
# One command: deploys contracts, updates the address manifest, regenerates
# wagmi hooks, and rebuilds the abis package.
#
# Usage (from monorepo root):
#   pnpm deploy:base-sepolia
#
# Required env vars (loaded from root .env):
#   PRIVATE_KEY             — deployer private key (no 0x prefix)
#   RPC_84532               — Base Sepolia RPC URL
#   VERIFICATION_KEY_84532  — BaseScan API key for source verification

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── load env ──────────────────────────────────────────────────────────────────
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${PRIVATE_KEY:?PRIVATE_KEY is required}"
: "${RPC_84532:?RPC_84532 is required}"
: "${VERIFICATION_KEY_84532:?VERIFICATION_KEY_84532 is required}"

# ── 1. forge deploy ───────────────────────────────────────────────────────────
echo ""
echo "▶ Step 1/4 — forge deploy (Base Sepolia)"
cd "$ROOT/apps/contracts"

forge script script/DeployProtocol.s.sol \
  --rpc-url "$RPC_84532" \
  --broadcast \
  --chain base-sepolia \
  --private-key "$PRIVATE_KEY" \
  --etherscan-api-key "$VERIFICATION_KEY_84532" \
  --verify \
  -vvvv

cd "$ROOT"

# ── 2. sync manifest + addresses.ts ──────────────────────────────────────────
echo ""
echo "▶ Step 2/4 — sync address manifest + addresses.ts"
DEPLOY_CHAIN=base-sepolia pnpm exec tsx scripts/sync-deployments.ts

# ── 3. wagmi codegen ──────────────────────────────────────────────────────────
echo ""
echo "▶ Step 3/4 — wagmi codegen"
pnpm exec wagmi generate

# ── 4. build abis package ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 4/4 — build @loar/abis"
pnpm --filter @loar/abis build:ts

echo ""
echo "✅ Base Sepolia deploy complete."
echo "   Commit deployments/base-sepolia.json and packages/abis/src/ to propagate addresses."
