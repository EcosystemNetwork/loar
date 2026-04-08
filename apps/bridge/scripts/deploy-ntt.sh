#!/bin/bash
# ============================================================================
# Deploy Wormhole NTT for $LOAR across 4 chains
#
# Architecture:
#   Base (Hub / Locking) — 1B supply minted here
#   Solana (Spoke / Burn-and-Mint)
#   SUI (Spoke / Burn-and-Mint)
#   Ethereum (Spoke / Burn-and-Mint)
#
# Prerequisites:
#   - ntt CLI: npm install -g @wormhole-foundation/ntt-cli
#   - Funded wallets on all 4 chains
#   - LOAR token deployed on all 4 chains
#   - Environment variables set (see .env.example)
#
# Usage:
#   ./scripts/deploy-ntt.sh [testnet|mainnet]
# ============================================================================

set -euo pipefail

NETWORK="${1:-testnet}"

echo "============================================"
echo " Deploying LOAR NTT — $NETWORK"
echo "============================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Validate environment
# ---------------------------------------------------------------------------

echo "Step 1: Validating environment..."

if [ "$NETWORK" = "testnet" ]; then
  BASE_CHAIN="BaseSepolia"
  ETH_CHAIN="Sepolia"
  SOL_CHAIN="Solana"  # uses devnet when network=testnet
  SUI_CHAIN="Sui"     # uses testnet

  LOAR_BASE="${LOAR_TOKEN_BASE_SEPOLIA:?Set LOAR_TOKEN_BASE_SEPOLIA}"
  LOAR_ETH="${LOAR_TOKEN_SEPOLIA:?Set LOAR_TOKEN_SEPOLIA}"
  LOAR_SOL="${LOAR_TOKEN_SOLANA_DEVNET:?Set LOAR_TOKEN_SOLANA_DEVNET}"
  LOAR_SUI="${LOAR_TOKEN_SUI_TESTNET:?Set LOAR_TOKEN_SUI_TESTNET}"
else
  BASE_CHAIN="Base"
  ETH_CHAIN="Ethereum"
  SOL_CHAIN="Solana"
  SUI_CHAIN="Sui"

  LOAR_BASE="${LOAR_TOKEN_BASE:?Set LOAR_TOKEN_BASE}"
  LOAR_ETH="${LOAR_TOKEN_ETHEREUM:?Set LOAR_TOKEN_ETHEREUM}"
  LOAR_SOL="${LOAR_TOKEN_SOLANA:?Set LOAR_TOKEN_SOLANA}"
  LOAR_SUI="${LOAR_TOKEN_SUI:?Set LOAR_TOKEN_SUI}"
fi

echo "  Base ($BASE_CHAIN):     $LOAR_BASE"
echo "  Ethereum ($ETH_CHAIN):  $LOAR_ETH"
echo "  Solana ($SOL_CHAIN):    $LOAR_SOL"
echo "  SUI ($SUI_CHAIN):       $LOAR_SUI"
echo ""

# ---------------------------------------------------------------------------
# 2. Initialize NTT project
# ---------------------------------------------------------------------------

echo "Step 2: Initializing NTT project..."
cd "$(dirname "$0")/.."

# Initialize if not already
if [ ! -f "deployment.json" ] || [ "$(cat deployment.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("chains",{})))')" = "0" ]; then
  ntt init --network "$NETWORK"
fi

# ---------------------------------------------------------------------------
# 3. Add Base as Hub (Locking mode)
# ---------------------------------------------------------------------------

echo ""
echo "Step 3: Adding Base as Hub (locking mode)..."
ntt add-chain "$BASE_CHAIN" \
  --token "$LOAR_BASE" \
  --mode locking \
  --latest

# Grant NTT Manager the minter role on LoarToken.sol
echo "  → After deploy: call LoarToken.setMinter(NTT_MANAGER_ADDRESS, true) on Base"

# ---------------------------------------------------------------------------
# 4. Add Ethereum as Spoke (Burning mode)
# ---------------------------------------------------------------------------

echo ""
echo "Step 4: Adding Ethereum as Spoke (burning mode)..."
ntt add-chain "$ETH_CHAIN" \
  --token "$LOAR_ETH" \
  --mode burning \
  --latest

# LoarTokenSpoke already has NTT Manager as minter from constructor

# ---------------------------------------------------------------------------
# 5. Add Solana as Spoke (Burning mode)
# ---------------------------------------------------------------------------

echo ""
echo "Step 5: Adding Solana as Spoke (burning mode)..."
ntt add-chain "$SOL_CHAIN" \
  --token "$LOAR_SOL" \
  --mode burning \
  --latest

# NTT will request mint authority transfer for SPL Token 2022

# ---------------------------------------------------------------------------
# 6. Add SUI as Spoke (Burning mode)
# ---------------------------------------------------------------------------

echo ""
echo "Step 6: Adding SUI as Spoke (burning mode)..."
ntt add-chain "$SUI_CHAIN" \
  --token "$LOAR_SUI" \
  --mode burning \
  --latest

# NTT will request TreasuryCap transfer

# ---------------------------------------------------------------------------
# 7. Deploy all NTT contracts
# ---------------------------------------------------------------------------

echo ""
echo "Step 7: Deploying NTT contracts on all chains..."
ntt deploy

# ---------------------------------------------------------------------------
# 8. Pull and sync config
# ---------------------------------------------------------------------------

echo ""
echo "Step 8: Syncing deployment config..."
ntt pull

# ---------------------------------------------------------------------------
# 9. Output summary
# ---------------------------------------------------------------------------

echo ""
echo "============================================"
echo " NTT Deployment Complete!"
echo "============================================"
echo ""
echo " deployment.json has been updated with all"
echo " NTT Manager and Transceiver addresses."
echo ""
echo " Post-deployment checklist:"
echo "   □ Base: call LoarToken.setMinter(NTT_MANAGER, true)"
echo "   □ Base: call LoarToken.setFeeExempt(NTT_MANAGER, true)"
echo "   □ Ethereum: LoarTokenSpoke constructor already set NTT as minter"
echo "   □ Solana: confirm mint authority transferred to NTT PDA"
echo "   □ SUI: confirm TreasuryCap transferred to NTT Manager"
echo "   □ Update apps/web/src/configs/addresses.ts with new addresses"
echo "   □ Update apps/bridge/config/ntt-config.ts with manager addresses"
echo "   □ Test bridge: Base → Solana → SUI → Ethereum → Base"
echo ""
echo " Rate limits: 100M LOAR per chain per 24h (configurable)"
echo " Transfer fee: 0.05% collected on source chain for every bridge"
echo ""
