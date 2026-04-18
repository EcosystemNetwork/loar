#!/usr/bin/env bash
# deploy-sepolia.sh
#
# Full deploy + codegen pipeline for Sepolia testnet.
# One command: deploys contracts, updates the address manifest, regenerates
# wagmi hooks, and rebuilds the abis package.
#
# Usage (from monorepo root):
#   pnpm deploy:sepolia
#
# Required env vars (loaded from root .env):
#   PRIVATE_KEY           — deployer private key (no 0x prefix)
#   RPC_11155111          — Sepolia RPC URL
#   VERIFICATION_KEY_1    — Etherscan API key for source verification

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
: "${RPC_11155111:?RPC_11155111 is required}"
: "${VERIFICATION_KEY_1:?VERIFICATION_KEY_1 is required}"

# ── 1. forge deploy ───────────────────────────────────────────────────────────
echo ""
echo "▶ Step 1/4 — forge deploy (Sepolia)"
cd "$ROOT/apps/contracts"

forge script script/DeployProtocol.s.sol \
  --rpc-url "$RPC_11155111" \
  --broadcast \
  --chain sepolia \
  --private-key "$PRIVATE_KEY" \
  --etherscan-api-key "$VERIFICATION_KEY_1" \
  --verify \
  -vvvv

cd "$ROOT"

# ── 2. sync manifest + addresses.ts ──────────────────────────────────────────
echo ""
echo "▶ Step 2/4 — sync address manifest + addresses.ts"
pnpm exec tsx scripts/sync-deployments.ts

# ── 3. wagmi codegen ──────────────────────────────────────────────────────────
echo ""
echo "▶ Step 3/4 — wagmi codegen"
pnpm exec wagmi generate

# ── 4. build abis package ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 4/4 — build @loar/abis"
pnpm --filter @loar/abis build:ts

echo ""
echo "✅ Sepolia deploy complete."
echo "   Commit deployments/sepolia.json and packages/abis/src/ to propagate addresses."
