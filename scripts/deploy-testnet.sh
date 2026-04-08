#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# LOAR — Multi-Chain Testnet Deployment Orchestrator
# ============================================================================
#
# Deploys the full LOAR protocol to:
#   - Base Sepolia (EVM)
#   - Solana Devnet
#   - SUI Testnet
#
# Prerequisites:
#   - foundryup installed (forge, cast)
#   - anchor-cli installed
#   - sui-cli installed
#   - Wallets funded on all 3 chains
#   - .env file with PRIVATE_KEY set
#
# Usage:
#   ./scripts/deploy-testnet.sh [evm|solana|sui|all]
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
# Solana — Devnet
# ============================================================================
deploy_solana() {
    section "Solana — Devnet Deployment"

    cd "$ROOT_DIR/apps/contracts-sol"

    # Check anchor
    if ! command -v anchor &> /dev/null; then
        err "Anchor not installed. Run: cargo install --git https://github.com/coral-xyz/anchor anchor-cli"
        return 1
    fi

    # Check solana CLI
    if ! command -v solana &> /dev/null; then
        err "Solana CLI not installed. Run: sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""
        return 1
    fi

    # Check balance
    DEPLOYER=$(solana address 2>/dev/null || echo "unknown")
    log "Deployer: $DEPLOYER"

    BALANCE=$(solana balance 2>/dev/null || echo "0 SOL")
    log "Balance: $BALANCE"

    # Build
    log "Building Anchor programs..."
    anchor build 2>&1 | tee "$LOG_DIR/solana-build.log"

    # Deploy
    log "Deploying to devnet..."
    anchor deploy --provider.cluster devnet 2>&1 | tee "$LOG_DIR/solana-deploy.log"

    # Initialize
    log "Initializing programs..."
    npx ts-node scripts/init-programs.ts 2>&1 | tee "$LOG_DIR/solana-init.log"

    log "Solana deployment complete!"
    log "Addresses logged to $LOG_DIR/solana-*.log"

    echo ""
    log "ACTION NEEDED: Update apps/web/src/configs/addresses.ts with program IDs from Anchor.toml"
}

# ============================================================================
# SUI — Testnet
# ============================================================================
deploy_sui() {
    section "SUI — Testnet Deployment"

    cd "$ROOT_DIR/apps/contracts-sui"

    # Check sui CLI
    if ! command -v sui &> /dev/null; then
        err "SUI CLI not installed. Run: cargo install --locked --git https://github.com/MystenLabs/sui.git sui"
        return 1
    fi

    # Check balance
    DEPLOYER=$(sui client active-address 2>/dev/null || echo "unknown")
    log "Deployer: $DEPLOYER"

    # Run publish script
    log "Publishing Move package..."
    bash scripts/publish-and-init.sh 2>&1 | tee "$LOG_DIR/sui-publish.log"

    # Copy addresses file
    if [ -f "deployed-addresses.json" ]; then
        cp deployed-addresses.json "$LOG_DIR/sui-addresses.json"
        log "Addresses saved to $LOG_DIR/sui-addresses.json"
    fi

    log "SUI deployment complete!"

    echo ""
    log "ACTION NEEDED: Update apps/web/src/configs/addresses.ts with package ID"
}

# ============================================================================
# Post-deploy: Update frontend addresses
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
    echo "║  4. Test on each chain:                              ║"
    echo "║     - Connect wallet on Base Sepolia                 ║"
    echo "║     - Connect Phantom on Solana Devnet               ║"
    echo "║     - Connect SUI Wallet on SUI Testnet              ║"
    echo "║     - Create a universe on each chain                ║"
    echo "║     - Mint an entity on each chain                   ║"
    echo "║     - Purchase credits on each chain                 ║"
    echo "║                                                      ║"
    echo "║  5. Test bridge: /bridge page                        ║"
    echo "║                                                      ║"
    echo "╚══════════════════════════════════════════════════════╝"
}

# ============================================================================
# Main
# ============================================================================
TARGET="${1:-all}"

case "$TARGET" in
    evm)
        deploy_evm
        ;;
    solana)
        deploy_solana
        ;;
    sui)
        deploy_sui
        ;;
    all)
        deploy_evm
        deploy_solana
        deploy_sui
        post_deploy
        ;;
    *)
        echo "Usage: $0 [evm|solana|sui|all]"
        exit 1
        ;;
esac
