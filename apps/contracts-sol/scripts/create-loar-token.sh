#!/bin/bash
# ============================================================================
# Create $LOAR Token on Solana using SPL Token 2022 with Transfer Fee Extension
#
# Prerequisites:
#   - solana-cli installed
#   - spl-token CLI installed (with Token-2022 support)
#   - Wallet funded on target cluster
#
# Usage:
#   ./scripts/create-loar-token.sh [devnet|mainnet-beta]
# ============================================================================

set -euo pipefail

CLUSTER="${1:-devnet}"
echo "Creating \$LOAR token on Solana ($CLUSTER)..."

# Switch to target cluster
solana config set --url "$CLUSTER"

# Transfer fee: 5 basis points (0.05%)
# Max fee: 5,000,000,000,000 (5000 LOAR per transfer cap)
TRANSFER_FEE_BPS=5
MAX_FEE=5000000000000
DECIMALS=9

echo ""
echo "Token parameters:"
echo "  Decimals:        $DECIMALS"
echo "  Transfer fee:    ${TRANSFER_FEE_BPS} bps (0.05%)"
echo "  Max fee/tx:      $MAX_FEE (5000 LOAR)"
echo ""

# Create the Token-2022 mint with transfer fee extension
echo "Step 1: Creating Token-2022 mint with transfer fee extension..."
MINT_OUTPUT=$(spl-token create-token \
  --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --transfer-fee "$TRANSFER_FEE_BPS" "$MAX_FEE" \
  --decimals "$DECIMALS" \
  2>&1)

MINT_ADDRESS=$(echo "$MINT_OUTPUT" | grep "Creating token" | awk '{print $3}')
echo "  Mint address: $MINT_ADDRESS"

# Create associated token accounts for distribution
echo ""
echo "Step 2: Creating token accounts..."

TREASURY=$(solana address)  # default wallet = treasury for now
echo "  Treasury: $TREASURY"

# Create ATA for treasury
spl-token create-account "$MINT_ADDRESS" \
  --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

echo ""
echo "Step 3: Minting initial supply (1,000,000,000 LOAR)..."
spl-token mint "$MINT_ADDRESS" 1000000000 \
  --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

echo ""
echo "============================================"
echo " \$LOAR Token Created Successfully!"
echo "============================================"
echo ""
echo " Mint address:    $MINT_ADDRESS"
echo " Cluster:         $CLUSTER"
echo " Decimals:        $DECIMALS"
echo " Transfer fee:    0.05% (5 bps)"
echo " Total supply:    1,000,000,000 LOAR"
echo ""
echo " Next steps:"
echo "   1. Update SOLANA_ADDRESSES in apps/web/src/configs/addresses.ts"
echo "   2. Run 'anchor deploy' to deploy the loar-token program"
echo "   3. Call 'initialize' on the loar-token program with this mint"
echo "   4. Set the mint authority to the loar-token program's config PDA"
echo ""
echo " View on explorer:"
echo "   https://explorer.solana.com/address/$MINT_ADDRESS?cluster=$CLUSTER"
