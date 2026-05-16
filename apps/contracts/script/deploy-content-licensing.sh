#!/usr/bin/env bash
#
# Deploy ContentLicensing.sol to one or both testnets.
#
# What it does:
#   - Sepolia (11155111):       deploys ContentLicensing + SplitRouter (SplitRouter is missing on Sepolia)
#   - Base Sepolia (84532):     deploys ContentLicensing only (SplitRouter already at 0x8370...)
#
# Prerequisites:
#   - Foundry installed: curl -L https://foundry.paradigm.xyz | bash && foundryup
#   - .env at repo root with: PRIVATE_KEY (funded on both chains), RPC_11155111, RPC_84532
#   - Optional: MARKETPLACE_OPERATOR (the wallet that will submit setRightsWithCreatorSig from the server).
#               If unset, you must call RightsRegistry.setOperator(operator, true) manually post-deploy.
#
# Usage:
#   cd apps/contracts
#   bash script/deploy-content-licensing.sh sepolia       # Sepolia only
#   bash script/deploy-content-licensing.sh base          # Base Sepolia only
#   bash script/deploy-content-licensing.sh both          # Both chains (default)
#
set -euo pipefail

TARGET="${1:-both}"

# Load .env
if [ -f "../../.env" ]; then
  set -a; source ../../.env; set +a
elif [ -f ".env" ]; then
  set -a; source .env; set +a
fi

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "ERROR: PRIVATE_KEY not set in .env"
  exit 1
fi
if ! command -v forge >/dev/null 2>&1; then
  echo "ERROR: forge not in PATH. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
fi

deploy_sepolia() {
  echo ""
  echo "=== Sepolia (11155111) ==="
  PAYMENT_ROUTER=0x0fF81B57D5B47AC5bF2A84EeA69cCf4Aa6eb0C7C \
  RIGHTS_REGISTRY=0x82b4Fe50cE07a64CbF5f97E9d70F2cEb8af63EA3 \
    forge script script/DeployContentLicensing.s.sol \
      --rpc-url sepolia \
      --broadcast \
      -vvv
}

deploy_base_sepolia() {
  echo ""
  echo "=== Base Sepolia (84532) ==="
  PAYMENT_ROUTER=0x3a6C6Bc90F34839a4792c107d9597a92fBCCA984 \
  RIGHTS_REGISTRY=0x3EF8d96cf4336E46cc7091A2325B19f53b65b109 \
  SPLIT_ROUTER=0x8370F54A01Fc035f89293272C597bCE3B1289FC4 \
    forge script script/DeployContentLicensing.s.sol \
      --rpc-url base-sepolia \
      --broadcast \
      -vvv
}

case "$TARGET" in
  sepolia)
    deploy_sepolia
    ;;
  base|base-sepolia)
    deploy_base_sepolia
    ;;
  both)
    deploy_sepolia
    deploy_base_sepolia
    ;;
  *)
    echo "Usage: $0 [sepolia|base|both]"
    exit 1
    ;;
esac

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Next steps:"
echo "  1. Note the ContentLicensing + (Sepolia) SplitRouter addresses from the output above."
echo "  2. Add to .env:"
echo "       CONTENT_LICENSING_ADDRESS_SEPOLIA=<sepolia-cl>"
echo "       CONTENT_LICENSING_ADDRESS_BASE_SEPOLIA=<base-sepolia-cl>"
echo "       OPERATOR_PRIVATE_KEY=<server-operator-wallet> (or reuse PRIVATE_KEY)"
echo "  3. If MARKETPLACE_OPERATOR wasn't set during deploy, authorize the operator:"
echo "       cast send <RIGHTS_REGISTRY> 'setOperator(address,bool)' <OPERATOR> true \\"
echo "         --private-key \$PRIVATE_KEY --rpc-url sepolia"
echo "       (repeat for base-sepolia)"
echo "  4. Update packages/abis/src/addresses.ts with the new ContentLicensing entry."
echo "  5. Run: pnpm tsx scripts/rebuild-deployments.ts --apply  (if you use that flow)"
echo "  6. Restart apps/server so the on-chain marketplace flow picks up the env vars."
