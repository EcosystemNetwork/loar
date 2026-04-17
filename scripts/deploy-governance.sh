#!/usr/bin/env bash
# ============================================================================
# GOV-01: Deploy Gnosis Safe + TimelockController Governance
# ============================================================================
#
# This script validates required environment variables, then runs the Foundry
# DeployGovernance.s.sol script to:
#   1. Deploy an OpenZeppelin TimelockController (48h delay)
#   2. Transfer ownership of all UUPS proxy contracts to the timelock
#
# PREREQUISITE: Deploy a Gnosis Safe multisig FIRST at https://safe.global
#   - Choose Base mainnet (chain 8453)
#   - Configure signers and threshold (e.g. 3-of-5)
#   - Copy the deployed Safe address into SAFE_ADDRESS in .env
#
# Usage:
#   ./scripts/deploy-governance.sh                  # Broadcast to Base mainnet
#   ./scripts/deploy-governance.sh --dry-run        # Simulate without broadcasting
#   RPC_URL=http://localhost:8545 ./scripts/deploy-governance.sh  # Custom RPC
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/apps/contracts"

# Load .env from project root if present
if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
    echo "[OK] Loaded .env from $ROOT_DIR/.env"
fi

# ── Parse flags ─────────────────────────────────────────────────────────────

DRY_RUN=false
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        *) echo "Unknown flag: $arg"; exit 1 ;;
    esac
done

# ── Validate required env vars ──────────────────────────────────────────────

REQUIRED_VARS=(
    "PRIVATE_KEY"
    "SAFE_ADDRESS"
)

# Core UUPS proxy env vars (GOV-01 scope)
UUPS_VARS=(
    "PAYMENT_ROUTER_PROXY"
    "CANON_MARKETPLACE_PROXY"
    "CREDIT_MANAGER_PROXY"
    "SUBSCRIPTION_MANAGER_PROXY"
    "LICENSING_REGISTRY_PROXY"
    "COLLAB_MANAGER_PROXY"
    "AD_PLACEMENT_PROXY"
    "ANALYTICS_REGISTRY_PROXY"
    "RIGHTS_REGISTRY_PROXY"
    "ESCROW_PROXY"
    "LAUNCHPAD_STAKING_PROXY"
)

echo ""
echo "=== GOV-01: Governance Deployment ==="
echo ""

# Check required vars
MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        echo "[FAIL] Missing required: $var"
        MISSING=$((MISSING + 1))
    else
        # Mask sensitive values
        if [[ "$var" == "PRIVATE_KEY" ]]; then
            echo "[OK]   $var = ****"
        else
            echo "[OK]   $var = ${!var}"
        fi
    fi
done

if [[ $MISSING -gt 0 ]]; then
    echo ""
    echo "ERROR: $MISSING required env var(s) missing. Set them in .env and retry."
    exit 1
fi

# Check UUPS proxy vars (warn but don't fail - script skips unset ones)
echo ""
echo "--- UUPS Proxy Addresses ---"
SET_COUNT=0
UNSET_COUNT=0
for var in "${UUPS_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        echo "[WARN] $var not set (will be skipped)"
        UNSET_COUNT=$((UNSET_COUNT + 1))
    else
        echo "[OK]   $var = ${!var}"
        SET_COUNT=$((SET_COUNT + 1))
    fi
done

echo ""
echo "UUPS contracts to transfer: $SET_COUNT / ${#UUPS_VARS[@]}"
if [[ $UNSET_COUNT -gt 0 ]]; then
    echo "WARNING: $UNSET_COUNT proxy address(es) not set and will be skipped."
    echo "         Set them in .env to include them in the ownership transfer."
fi

if [[ $SET_COUNT -eq 0 ]]; then
    echo ""
    echo "ERROR: No UUPS proxy addresses set. Nothing to transfer."
    echo "       Set at least one proxy address in .env."
    exit 1
fi

# ── Run Foundry script ─────────────────────────────────────────────────────

echo ""
echo "========================================="

RPC="${RPC_URL:-base}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo "  MODE: DRY RUN (simulation only)"
    echo "  RPC:  $RPC"
    echo "========================================="
    echo ""

    cd "$CONTRACTS_DIR"
    forge script script/DeployGovernance.s.sol \
        --rpc-url "$RPC" \
        -vvv
else
    echo "  MODE: LIVE BROADCAST"
    echo "  RPC:  $RPC"
    echo "========================================="
    echo ""

    read -rp "This will deploy contracts and transfer ownership on-chain. Continue? [y/N] " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Aborted."
        exit 0
    fi

    cd "$CONTRACTS_DIR"
    forge script script/DeployGovernance.s.sol \
        --rpc-url "$RPC" \
        --broadcast \
        --verify \
        -vvv
fi

# ── Post-deployment verification checklist ──────────────────────────────────

echo ""
echo "========================================="
echo "  POST-DEPLOYMENT VERIFICATION CHECKLIST"
echo "========================================="
echo ""
echo "  1. [ ] Copy TIMELOCK_ADDRESS from output above into .env"
echo ""
echo "  2. [ ] Verify TimelockController on BaseScan:"
echo "         - PROPOSER_ROLE granted to Safe address only"
echo "         - EXECUTOR_ROLE granted to Safe address only"
echo "         - DEFAULT_ADMIN_ROLE held by nobody (renounced)"
echo "         - Minimum delay = 172800 seconds (48 hours)"
echo ""
echo "  3. [ ] Verify each transferred contract on BaseScan:"
echo "         - Call owner() — should return the timelock address"
echo "         - Deployer wallet should NOT be the owner"
echo ""
echo "  4. [ ] Test governance flow with the Safe:"
echo "         - Propose a no-op transaction via Safe -> Timelock"
echo "         - Wait 48 hours (or use testnet with shorter delay)"
echo "         - Execute the transaction from the Safe"
echo ""
echo "  5. [ ] Update monitoring/alerts:"
echo "         - Add timelock address to your monitoring dashboard"
echo "         - Set up alerts for TimelockController events:"
echo "           CallScheduled, CallExecuted, Cancelled"
echo ""
echo "  6. [ ] Update frontend config:"
echo "         - Set VITE_TIMELOCK_ADDRESS in .env"
echo "         - Verify admin functions route through governance"
echo ""
echo "  7. [ ] Document in team runbook:"
echo "         - Safe address and signer list"
echo "         - Timelock address"
echo "         - How to propose upgrades via the Safe"
echo ""
echo "========================================="
echo "  Done. Governance is live."
echo "========================================="
