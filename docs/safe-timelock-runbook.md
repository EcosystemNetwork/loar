# Safe + Timelock Deployment Runbook

Covers GOV-01 in `docs/audit-fix-tracker.md`: move ownership of all UUPS + Beacons + Ownable contracts from the deployer EOA to a `Safe → TimelockController` chain.

> **Testnet target**: 2-of-3 Safe on Ethereum Sepolia (the only live network).
> **Mainnet target**: Re-sign as 3-of-5 Safe on Ethereum Mainnet (chain 1) before contract handoff there.
>
> Base and Solana are planned future chains; when they go live, re-run this runbook against their networks.

---

## 0. Prerequisites

- Foundry installed (`forge --version` works). On this box it lives at `~/.config/.foundry/bin/forge`.
- Deployer EOA (`0x116C28e6DCABCa363f83217C712d79DCE168d90e`) funded on target chain.
- `PRIVATE_KEY` in `.env` (may need `0x` prefix for forge's `envUint`).
- `SAFE_ADDRESS` known (see step 1).
- Network-matching Etherscan API key in `.env` (`VERIFICATION_KEY_11155111` for Sepolia / `VERIFICATION_KEY_1` for Mainnet).

---

## 1. Create the Safe (manual, web flow)

1. Go to <https://app.safe.global/new-safe/create>.
2. Connect a signer wallet, pick network (Ethereum Sepolia for testnet pass).
3. Owners:
   - Signer A: `0x…`
   - Signer B: `0x…`
   - Signer C: `0x…`
4. Threshold: **2 of 3**.
5. Deploy. Copy the new Safe address.
6. Save to `.env`:
   ```
   SAFE_ADDRESS=0x…
   ```

---

## 2. Deploy the TimelockController

```bash
export PATH=$HOME/.config/.foundry/bin:$PATH
cd apps/contracts
set -a; source ../../.env; set +a
PRIVATE_KEY="0x${PRIVATE_KEY#0x}" \
SAFE_ADDRESS=$SAFE_ADDRESS \
forge script script/DeployTimelock.s.sol \
  --rpc-url $RPC_11155111 --skip "test/**" \
  --broadcast --verify \
  --etherscan-api-key $VERIFICATION_KEY_11155111
```

Roles after deploy (verify on Etherscan):

- `PROPOSER_ROLE` → Safe only
- `EXECUTOR_ROLE` → Safe only
- `DEFAULT_ADMIN_ROLE` → nobody (renounced in constructor)

Delay: 48h (override via `TIMELOCK_DELAY=<seconds>` env var).

Save the output:

```
TIMELOCK_ADDRESS=0x…
```

---

## 3. Dry-run the ownership transfer

`TransferToMultisig.s.sol` supports `DRY_RUN=true`. Run it first to confirm every contract it intends to touch and surface any not-yet-owned addresses.

```bash
DRY_RUN=true \
TIMELOCK_ADDRESS=$TIMELOCK_ADDRESS \
PRIVATE_KEY="0x${PRIVATE_KEY#0x}" \
forge script script/TransferToMultisig.s.sol \
  --rpc-url $RPC_11155111 --skip "test/**"
```

Review the printed list. If any expected contract is missing, update the script or `deployments/sepolia.json` before broadcasting.

---

## 4. Broadcast the transfer

```bash
DRY_RUN=false \
TIMELOCK_ADDRESS=$TIMELOCK_ADDRESS \
PRIVATE_KEY="0x${PRIVATE_KEY#0x}" \
forge script script/TransferToMultisig.s.sol \
  --rpc-url $RPC_11155111 --skip "test/**" \
  --broadcast
```

---

## 5. Verify

```bash
forge script script/VerifyMultisigTransfer.s.sol \
  --rpc-url $RPC_11155111 --skip "test/**"
```

Expected: `owner()` returns `TIMELOCK_ADDRESS` for every Ownable/OwnableUpgradeable contract in `deployments/sepolia.json`.

---

## 6. Update environment + docs

- `.env`: confirm `SAFE_ADDRESS` + `TIMELOCK_ADDRESS` set.
- `deployments/sepolia.json`: add `"SafeMultisig"` + `"TimelockController"` entries.
- `docs/audit-fix-tracker.md`: flip GOV-01 status from `[op]` → `[x]`.
- Update `CURVE-02, LOCKER-01, VESTING-01, ESCROW-03` notes — they're considered materially safer after the handoff.

---

## 7. Post-handoff operational changes

- All `onlyOwner` mutations now route: propose via Safe → 48h delay → execute via Safe.
- Emergency pauses (`setTradingHalted`, etc.) still require the Safe + timelock — plan ahead of incidents.
- For mainnet, **redo the entire runbook** with a 3-of-5 Safe. Do not reuse a testnet Safe.

---

## Rollback

There is **no rollback** after step 4. The timelock's `DEFAULT_ADMIN_ROLE` is burned in the constructor; the deployer EOA can no longer reclaim ownership. Only proceed when step 3 dry-run matches expectations.
