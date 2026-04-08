#!/usr/bin/env bash
set -euo pipefail

echo "=== LOAR SUI Testnet Deployment ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ADDR_FILE="$PROJECT_DIR/deployed-addresses.json"

# ── Pre-flight checks ────────────────────────────────────────────────
if ! command -v sui &>/dev/null; then
  echo "ERROR: 'sui' CLI not found. Install from https://docs.sui.io/build/install"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: sudo apt install jq"
  exit 1
fi

# Show active env
echo "Active SUI environment:"
sui client active-env 2>/dev/null || true
sui client active-address 2>/dev/null || true
echo ""

# ── Build ─────────────────────────────────────────────────────────────
echo "Building Move package..."
cd "$PROJECT_DIR"
sui move build
echo "Build complete."
echo ""

# ── Publish ───────────────────────────────────────────────────────────
echo "Publishing to testnet (gas-budget 500000000)..."
RESULT=$(sui client publish --gas-budget 500000000 --json 2>/dev/null)

if [ -z "$RESULT" ]; then
  echo "ERROR: Publish returned empty output. Check your gas balance and active env."
  exit 1
fi

# Check for errors in the result
ERROR=$(echo "$RESULT" | jq -r '.errors // empty' 2>/dev/null)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
  echo "ERROR: Publish failed:"
  echo "$ERROR"
  exit 1
fi

# ── Parse results ─────────────────────────────────────────────────────
PACKAGE_ID=$(echo "$RESULT" | jq -r '.objectChanges[] | select(.type == "published") | .packageId')
TX_DIGEST=$(echo "$RESULT" | jq -r '.digest')

if [ -z "$PACKAGE_ID" ] || [ "$PACKAGE_ID" = "null" ]; then
  echo "ERROR: Could not parse package ID from publish output."
  echo "Raw output:"
  echo "$RESULT" | jq .
  exit 1
fi

echo ""
echo "Package ID: $PACKAGE_ID"
echo "Tx Digest:  $TX_DIGEST"
echo ""

# ── List created objects ──────────────────────────────────────────────
echo "Created objects:"
echo "$RESULT" | jq -r '.objectChanges[] | select(.type == "created") | "  \(.objectType): \(.objectId)"'
echo ""

echo "Shared objects (GlobalState, RouterConfig, etc.):"
echo "$RESULT" | jq -r '.objectChanges[] | select(.type == "created" and .owner.Shared != null) | "  \(.objectType)\n    ID: \(.objectId)"'
echo ""

# ── Save addresses ────────────────────────────────────────────────────
echo "$RESULT" | jq '{
  packageId: (.objectChanges[] | select(.type == "published") | .packageId),
  digest: .digest,
  sharedObjects: [
    .objectChanges[]
    | select(.type == "created" and .owner.Shared != null)
    | {type: .objectType, id: .objectId}
  ],
  ownedObjects: [
    .objectChanges[]
    | select(.type == "created" and .owner.AddressOwner != null)
    | {type: .objectType, id: .objectId, owner: .owner.AddressOwner}
  ],
  timestamp: (now | todate)
}' > "$ADDR_FILE"

echo "Addresses saved to $ADDR_FILE"
echo ""

# ── Next steps ────────────────────────────────────────────────────────
echo "=== Next Steps ==="
echo "1. Update apps/web/src/configs/addresses.ts with:"
echo "   SUI package ID: $PACKAGE_ID"
echo "2. Note shared object IDs for frontend transaction building"
echo "3. Fund treasury address if needed"
echo "4. Set creation fees via admin transactions:"
echo "   sui client call --package $PACKAGE_ID --module universe_manager --function set_creation_fee --args <global_state_id> <fee_amount> --gas-budget 10000000"
echo ""
echo "=== Deployment Complete ==="
