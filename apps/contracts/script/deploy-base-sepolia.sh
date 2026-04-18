#!/usr/bin/env bash
#
# Deploy LOAR protocol to Base Sepolia (chainId 84532).
#
# Prerequisites:
#   - Foundry installed (forge, cast)
#   - .env with PRIVATE_KEY set (deployer must have Base Sepolia ETH)
#   - Base Sepolia RPC configured in foundry.toml [rpc_endpoints]
#
# Base Sepolia infrastructure addresses (Uniswap v4):
#   PoolManager:     0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
#   PositionManager: 0x1B1C77B606d13b09C84d1c7394B96b147bC03147
#   Permit2:         0x000000000022D473030F116dDEE9F6B43aC78BA3
#   WETH:            0x4200000000000000000000000000000000000006
#
# Usage:
#   cd apps/contracts
#   bash script/deploy-base-sepolia.sh
#
set -euo pipefail

echo "=== Deploying LOAR Protocol to Base Sepolia ==="
echo ""

# Base Sepolia addresses
export POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
export POSITION_MANAGER=0x1B1C77B606d13b09C84d1c7394B96b147bC03147
export PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
export WETH=0x4200000000000000000000000000000000000006

# Load .env for PRIVATE_KEY
if [ -f "../../.env" ]; then
  set -a; source ../../.env; set +a
elif [ -f ".env" ]; then
  set -a; source .env; set +a
fi

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "ERROR: PRIVATE_KEY not set. Add it to .env or export it."
  exit 1
fi

echo "Chain:           Base Sepolia (84532)"
echo "PoolManager:     $POOL_MANAGER"
echo "PositionManager: $POSITION_MANAGER"
echo "Permit2:         $PERMIT2"
echo "WETH:            $WETH"
echo ""

forge script script/DeployProtocol.s.sol \
  --rpc-url base-sepolia \
  --broadcast \
  --verify \
  -vvv

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy deployed addresses to deployments/base-sepolia.json"
echo "  2. Update packages/abis/src/addresses.ts with Base Sepolia addresses"
echo "  3. Run: pnpm sync:addresses && pnpm generate"
echo "  4. Set PONDER_CHAIN=base-sepolia to index Base Sepolia"
