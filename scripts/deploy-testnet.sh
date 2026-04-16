#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# LOAR — Base Sepolia Testnet Deployment
# ============================================================================
#
# Deploys the full LOAR protocol to Base Sepolia (EVM).
#
# Prerequisites:
#   - foundryup installed (forge, cast)
#   - Wallet funded on Base Sepolia
#   - .env file with PRIVATE_KEY set
#
# Usage:
#   ./scripts/deploy-testnet.sh
#
# ============================================================================

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_DIR="$ROOT_DIR/deploys/$TIMESTAMP"
mkdir -p "$LOG_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }
section() { echo -e "\n${CYAN}════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}════════════════════════════════════════${NC}\n"; }

# Load env
if [ -f "$ROOT_DIR/.env" ]; then
    set -a; source "$ROOT_DIR/.env"; set +a
    log "Loaded .env"
else
    err "No .env file found. Copy .env.example and fill in values."
    exit 1
fi

# ============================================================================
# EVM — Base Sepolia
# ============================================================================
deploy_evm() {
    section "EVM — Base Sepolia Deployment"

    cd "$ROOT_DIR/apps/contracts"

    # Check forge
    if ! command -v forge &> /dev/null; then
        err "Foundry not installed. Run: curl -L https://foundry.paradigm.xyz | bash && foundryup"
        return 1
    fi

    # Check balance
    if [ -n "${PRIVATE_KEY:-}" ]; then
        DEPLOYER=$(cast wallet address --private-key "0x$PRIVATE_KEY" 2>/dev/null || echo "unknown")
        log "Deployer: $DEPLOYER"

        BALANCE=$(cast balance "$DEPLOYER" --rpc-url "${RPC_84532:-https://sepolia.base.org}" 2>/dev/null || echo "0")
        log "Balance: $BALANCE wei"
    else
        err "PRIVATE_KEY not set in .env"
        return 1
    fi

    # Build
    log "Building contracts..."
    forge build 2>&1 | tee "$LOG_DIR/evm-build.log"

    # Deploy core protocol
    log "Deploying core protocol (UniverseManager, TokenDeployer, Hook, Lockers)..."
    forge script script/DeployProtocol.s.sol \
        --rpc-url "${RPC_84532:-https://sepolia.base.org}" \
        --broadcast \
        --verify \
        -vvv 2>&1 | tee "$LOG_DIR/evm-deploy-protocol.log"

    log "Core protocol deployed. Check logs for addresses."

    # Deploy revenue infrastructure
    log "Deploying revenue contracts..."
    forge script script/DeployRevenue.s.sol \
        --rpc-url "${RPC_84532:-https://sepolia.base.org}" \
        --broadcast \
        --verify \
        -vvv 2>&1 | tee "$LOG_DIR/evm-deploy-revenue.log"

    log "EVM deployment complete!"
    log "Addresses logged to $LOG_DIR/evm-deploy-*.log"

    # Regenerate ABIs for frontend
    log "Regenerating wagmi hooks..."
    cd "$ROOT_DIR"
    npx wagmi generate 2>/dev/null || warn "wagmi generate failed — run manually after updating addresses"

    echo ""
    log "ACTION NEEDED: Update apps/web/src/configs/addresses.ts with deployed addresses"
}

# ============================================================================
# Post-deploy checklist
# ============================================================================
post_deploy() {
    section "Post-Deploy Checklist"

    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  All deployment logs saved to: $LOG_DIR             ║"
    echo "╠══════════════════════════════════════════════════════╣"
    echo "║                                                      ║"
    echo "║  TODO:                                               ║"
    echo "║  1. Update apps/web/src/configs/addresses.ts         ║"
    echo "║     with all deployed contract addresses             ║"
    echo "║                                                      ║"
    echo "║  2. Run: cd apps/contracts && forge build            ║"
    echo "║     Then: npx wagmi generate                         ║"
    echo "║                                                      ║"
    echo "║  3. Run: cd apps/web && pnpm build                   ║"
    echo "║     Verify no TypeScript errors                      ║"
    echo "║                                                      ║"
    echo "║  4. Test on Base Sepolia:                            ║"
    echo "║     - Connect wallet                                 ║"
    echo "║     - Create a universe                              ║"
    echo "║     - Mint an entity                                 ║"
    echo "║     - Purchase credits                               ║"
    echo "║                                                      ║"
    echo "╚══════════════════════════════════════════════════════╝"
}

# ============================================================================
# Main
# ============================================================================
deploy_evm
post_deploy
