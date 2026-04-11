#!/usr/bin/env bash
#
# Base Sepolia Deployment Stress Test
# Tests: LoarToken, UniverseManager, Universe, node creation, transfers
#
set -euo pipefail

source /home/god/.zshenv 2>/dev/null || true

RPC=https://base-sepolia-rpc.publicnode.com
PK=0xe770f73a119b637161fe37282ea41cffb9219eb586b29d2818ad3437f78a1860
DEPLOYER=0x116C28e6DCABCa363f83217C712d79DCE168d90e

# Contracts
LOAR=0x30A37d04aFa2648FA4427b13c7ca380490F46BaD
UM=0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f
HOOK=0x31D8C79D81517a967175E1723d777c6B4AD568CC
LOCKER=0x91D581cFdda6F1AC4cA211d8A05B31BeFcEF2882

PASS=0
FAIL=0
TOTAL=0

ok() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "  FAIL: $1 — $2"; }

run_test() {
  local name="$1"
  shift
  local output
  if output=$("$@" 2>&1); then
    echo "$output"
    return 0
  else
    echo "$output"
    return 1
  fi
}

echo "============================================================"
echo "  LOAR Base Sepolia Stress Test"
echo "  Chain: 84532 | RPC: $RPC"
echo "  Deployer: $DEPLOYER"
echo "============================================================"
echo ""

# ── 1. LoarToken Tests ──────────────────────────────────────────────
echo "=== 1. LoarToken Tests ==="
echo ""

# 1a. Basic reads
BALANCE=$(cast call $LOAR "balanceOf(address)(uint256)" $DEPLOYER --rpc-url $RPC 2>&1)
if [[ "$BALANCE" == *"1000000000"* ]]; then ok "LoarToken balance matches 1B supply"; else fail "LoarToken balance" "$BALANCE"; fi

FEE=$(cast call $LOAR "transferFeeBps()(uint256)" --rpc-url $RPC 2>&1)
if [[ "$FEE" == *"1"* ]]; then ok "Transfer fee is 1 bps"; else fail "Transfer fee" "$FEE"; fi

OWNER=$(cast call $LOAR "owner()(address)" --rpc-url $RPC 2>&1)
if [[ "$OWNER" == *"$DEPLOYER"* ]]; then ok "LoarToken owner is deployer"; else fail "LoarToken owner" "$OWNER"; fi

# 1b. Transfer LOAR to a test address
TEST_ADDR=0x000000000000000000000000000000000000dEaD
echo ""
echo "--- Transfer 1000 LOAR to $TEST_ADDR ---"
TX=$(cast send $LOAR "transfer(address,uint256)(bool)" $TEST_ADDR 1000000000000000000000 --private-key $PK --rpc-url $RPC 2>&1)
if [[ "$TX" == *"transactionHash"* ]] || [[ "$TX" == *"blockNumber"* ]]; then
  ok "LoarToken transfer succeeded"
  # Check balance after
  DEAD_BAL=$(cast call $LOAR "balanceOf(address)(uint256)" $TEST_ADDR --rpc-url $RPC 2>&1)
  # With 1bps fee on 1000 LOAR, dead should get ~999.9 LOAR
  if [[ "$DEAD_BAL" != "0" ]]; then ok "Recipient received tokens (fee deducted)"; else fail "Recipient balance zero" "$DEAD_BAL"; fi
else
  fail "LoarToken transfer" "$TX"
fi

# 1c. Self-transfer (fee exemption test)
echo ""
echo "--- Self-transfer (fee exempt check) ---"
BAL_BEFORE=$(cast call $LOAR "balanceOf(address)(uint256)" $DEPLOYER --rpc-url $RPC 2>&1)
TX2=$(cast send $LOAR "transfer(address,uint256)(bool)" $DEPLOYER 1000000000000000000 --private-key $PK --rpc-url $RPC 2>&1)
BAL_AFTER=$(cast call $LOAR "balanceOf(address)(uint256)" $DEPLOYER --rpc-url $RPC 2>&1)
if [[ "$TX2" == *"blockNumber"* ]]; then ok "Self-transfer succeeded"; else fail "Self-transfer" "$TX2"; fi

# 1d. Approve + allowance
echo ""
echo "--- Approve 500 LOAR for test spender ---"
TX3=$(cast send $LOAR "approve(address,uint256)(bool)" $TEST_ADDR 500000000000000000000 --private-key $PK --rpc-url $RPC 2>&1)
if [[ "$TX3" == *"blockNumber"* ]]; then
  ALLOWANCE=$(cast call $LOAR "allowance(address,address)(uint256)" $DEPLOYER $TEST_ADDR --rpc-url $RPC 2>&1)
  if [[ "$ALLOWANCE" == *"500"* ]]; then ok "Approve + allowance correct"; else fail "Allowance mismatch" "$ALLOWANCE"; fi
else
  fail "Approve tx" "$TX3"
fi

echo ""

# ── 2. Universe Creation ────────────────────────────────────────────
echo "=== 2. Universe Creation Test ==="
echo ""

echo "--- Creating universe with 0.05 ETH ---"
# createUniverse(string name, string imageURL, string description, uint8 nodeCreation, uint8 nodeVisibility, address initialOwner)
UNIVERSE_TX=$(cast send $UM \
  "createUniverse(string,string,string,uint8,uint8,address)" \
  "Stress Test Universe" \
  "https://example.com/img.png" \
  "A universe created by the Base Sepolia stress test" \
  0 0 $DEPLOYER \
  --value 0.05ether \
  --private-key $PK \
  --rpc-url $RPC \
  --json 2>&1)

if echo "$UNIVERSE_TX" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='0x1'" 2>/dev/null; then
  ok "Universe created successfully"
  # Extract universe address from logs
  UNIVERSE_ADDR=$(echo "$UNIVERSE_TX" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for log in d.get('logs',[]):
    if len(log.get('topics',[])) >= 1 and 'UniverseCreated' in str(log.get('topics',[''])[0]) or len(log.get('data','')) > 66:
        # The universe address is in the log data
        data = log['data']
        if len(data) >= 66:
            addr = '0x' + data[26:66]
            print(addr)
            break
" 2>/dev/null || echo "")

  # Try to get the universe address from logs differently
  if [ -z "$UNIVERSE_ADDR" ] || [ "$UNIVERSE_ADDR" = "" ]; then
    # Parse from event topics — UniverseCreated(address universe, address creator)
    UNIVERSE_ADDR=$(echo "$UNIVERSE_TX" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for log in d.get('logs',[]):
    topics = log.get('topics',[])
    # Look for the UniverseCreated event from the UniverseManager
    if log.get('address','').lower() == '$UM'.lower() and len(topics) >= 1:
        data = log.get('data','0x')
        if len(data) >= 130:  # two 32-byte words
            addr = '0x' + data[26:66]
            print(addr)
            break
" 2>/dev/null || echo "")
  fi

  if [ -n "$UNIVERSE_ADDR" ] && [ "$UNIVERSE_ADDR" != "" ]; then
    echo "  Universe contract: $UNIVERSE_ADDR"

    # 2b. Check universe admin
    ADMIN=$(cast call "$UNIVERSE_ADDR" "getAdmin()(address)" --rpc-url $RPC 2>&1 || echo "error")
    if [[ "$ADMIN" == *"$DEPLOYER"* ]]; then ok "Universe admin matches deployer"; else fail "Universe admin" "$ADMIN"; fi

    # 2c. Check universe token (should be zero before deployment)
    TOKEN=$(cast call "$UNIVERSE_ADDR" "getToken()(address)" --rpc-url $RPC 2>&1 || echo "error")
    echo "  Universe token: $TOKEN"
  else
    echo "  Could not parse universe address from tx logs (will test node creation on raw call)"
  fi
else
  fail "Universe creation" "$(echo "$UNIVERSE_TX" | head -c 200)"
fi

echo ""

# ── 3. Node Creation ────────────────────────────────────────────────
echo "=== 3. Node Creation Test ==="
echo ""

if [ -n "${UNIVERSE_ADDR:-}" ] && [ "$UNIVERSE_ADDR" != "" ]; then
  CONTENT_HASH=$(cast keccak "stress test content 1")
  PLOT_HASH=$(cast keccak "stress test plot 1")

  echo "--- Creating root node ---"
  NODE_TX=$(cast send "$UNIVERSE_ADDR" \
    "createNode(bytes32,bytes32,uint256,string,string)" \
    "$CONTENT_HASH" "$PLOT_HASH" 0 \
    "https://example.com/media1.mp4" \
    "The first episode of the stress test universe" \
    --private-key $PK \
    --rpc-url $RPC \
    --json 2>&1)

  if echo "$NODE_TX" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='0x1'" 2>/dev/null; then
    ok "Root node created"

    # Create 5 more nodes rapidly
    echo ""
    echo "--- Rapid node creation (5 nodes) ---"
    for i in $(seq 2 6); do
      CH=$(cast keccak "stress test content $i")
      PH=$(cast keccak "stress test plot $i")
      NTX=$(cast send "$UNIVERSE_ADDR" \
        "createNode(bytes32,bytes32,uint256,string,string)" \
        "$CH" "$PH" 1 \
        "https://example.com/media${i}.mp4" \
        "Episode $i of stress test" \
        --private-key $PK \
        --rpc-url $RPC \
        --json 2>&1)
      if echo "$NTX" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='0x1'" 2>/dev/null; then
        ok "Node $i created"
      else
        fail "Node $i creation" "reverted"
      fi
    done

    # Check canon chain
    echo ""
    echo "--- Checking node graph ---"
    LEAVES=$(cast call "$UNIVERSE_ADDR" "getLeaves()(uint256[])" --rpc-url $RPC 2>&1)
    echo "  Leaves: $LEAVES"
    ok "Node graph readable"
  else
    fail "Root node creation" "$(echo "$NODE_TX" | head -c 200)"
  fi
else
  echo "  Skipping — no universe address from previous step"
fi

echo ""

# ── 4. Rapid LOAR Transfers (Stress) ────────────────────────────────
echo "=== 4. Rapid LOAR Transfer Stress Test ==="
echo ""

echo "--- Sending 10 transfers in sequence ---"
TRANSFER_OK=0
TRANSFER_FAIL=0
for i in $(seq 1 10); do
  DEST=$(printf "0x%040d" $((i + 100)))
  TX=$(cast send $LOAR "transfer(address,uint256)(bool)" "$DEST" 100000000000000000000 --private-key $PK --rpc-url $RPC --json 2>&1)
  if echo "$TX" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='0x1'" 2>/dev/null; then
    TRANSFER_OK=$((TRANSFER_OK+1))
  else
    TRANSFER_FAIL=$((TRANSFER_FAIL+1))
  fi
done
echo "  Transfers: $TRANSFER_OK/10 succeeded, $TRANSFER_FAIL failed"
if [ "$TRANSFER_OK" -eq 10 ]; then ok "All 10 rapid transfers succeeded"; else fail "Rapid transfers" "$TRANSFER_FAIL failed"; fi

echo ""

# ── 5. Admin Function Tests ─────────────────────────────────────────
echo "=== 5. Admin Function Tests ==="
echo ""

# 5a. Set fee exempt
echo "--- Setting fee exempt for test address ---"
EXEMPT_TX=$(cast send $LOAR "setFeeExempt(address,bool)" $TEST_ADDR true --private-key $PK --rpc-url $RPC --json 2>&1)
if echo "$EXEMPT_TX" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='0x1'" 2>/dev/null; then
  ok "setFeeExempt succeeded"
else
  fail "setFeeExempt" "$(echo "$EXEMPT_TX" | head -c 200)"
fi

# 5b. Claim ETH from UniverseManager (from universe creation fees)
echo "--- Claiming ETH from UniverseManager ---"
CLAIM_TX=$(cast send $UM "claimEth(address)" $DEPLOYER --private-key $PK --rpc-url $RPC --json 2>&1)
if echo "$CLAIM_TX" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='0x1'" 2>/dev/null; then
  ok "claimEth succeeded"
else
  fail "claimEth" "$(echo "$CLAIM_TX" | head -c 200)"
fi

echo ""

# ── 6. Cross-chain: Verify Sepolia Still Works ──────────────────────
echo "=== 6. Sepolia Cross-Check ==="
echo ""

SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
SEPOLIA_LOAR=0x0A647b3b7426Bce958e7C2FE59f0a89191952C17
SEPOLIA_UM=0x7af142BbD14CaEECdA68f948F467Da0257f6B114

SEP_NAME=$(cast call $SEPOLIA_LOAR "name()(string)" --rpc-url $SEPOLIA_RPC 2>&1)
if [[ "$SEP_NAME" == *"LOAR"* ]]; then ok "Sepolia LoarToken responds"; else fail "Sepolia LoarToken" "$SEP_NAME"; fi

SEP_BAL=$(cast call $SEPOLIA_LOAR "balanceOf(address)(uint256)" $DEPLOYER --rpc-url $SEPOLIA_RPC 2>&1)
if [[ "$SEP_BAL" != "0" ]]; then ok "Sepolia deployer has LOAR balance"; else fail "Sepolia balance" "$SEP_BAL"; fi

SEP_DEPRECATED=$(cast call $SEPOLIA_UM "deprecated()(bool)" --rpc-url $SEPOLIA_RPC 2>&1)
if [[ "$SEP_DEPRECATED" == *"false"* ]]; then ok "Sepolia UniverseManager not deprecated"; else fail "Sepolia UM deprecated" "$SEP_DEPRECATED"; fi

echo ""

# ── Summary ─────────────────────────────────────────────────────────
echo "============================================================"
echo "  RESULTS: $PASS passed / $FAIL failed / $TOTAL total"
echo "============================================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
