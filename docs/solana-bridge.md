# $LOAR Cross-chain Bridge

Two backends, picked at runtime by env config:

| Backend                     | When                                                    | Trust                                               | Setup                                                                           |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Wormhole NTT**            | `WORMHOLE_NTT_MANAGER_*` set for both chains            | Trustless (guardian quorum)                         | Deploy NTT Manager + Wormhole Transceiver per chain + peer-register. Multi-day. |
| **Custodial lock-and-mint** | `SOL_BRIDGE_VAULT_ATA` + `EVM_BRIDGE_VAULT_ADDRESS` set | Server custodian holds mint authority on both sides | One-off vault setup; runs today.                                                |

The API in [routes/bridge.ts](../apps/server/src/routes/bridge.ts) is identical
for both — frontend doesn't branch. `POST /api/bridge/quote` returns
`backend: "wormhole_ntt" | "custodial"` so the UI can show a trust-model
banner.

## Custodial backend (current testnet path)

### Setup

1. **Provision bridge signers** (one-time):

   ```sh
   pnpm tsx apps/server/scripts/bridge-bootstrap.ts
   ```

   Prints two Circle DCW wallet ids + addresses (one per chain). Idempotent
   — re-running returns the same wallets.

2. **Transfer mint authority** to the printed addresses:
   - EVM: `cast send $LOAR_TOKEN_ADDRESS "transferOwnership(address)" <evmAddress>`
     (or whatever pattern your $LOAR contract uses for minter role).
   - Solana: `spl-token authorize $LOAR_MINT mint <solAddress> --url devnet`

3. **Vaults** — pick two addresses to receive locked tokens:
   - Solana: create a Token-2022 ATA — `SOL_BRIDGE_VAULT_ATA = <ATA>`.
   - EVM: an EOA or contract — `EVM_BRIDGE_VAULT_ADDRESS = 0x...`.

4. **Env vars** in `.env`:

   ```
   SOL_BRIDGE_VAULT_ATA=...
   EVM_BRIDGE_VAULT_ADDRESS=0x...
   LOAR_EVM_CHAIN_ID=11155111
   CIRCLE_BRIDGE_SIGNER_ID_EVM=<from step 1>
   CIRCLE_BRIDGE_SIGNER_ID_SOL=<from step 1>

   # Optional caps (defaults: 1M per tx, 5M per user/day)
   BRIDGE_MAX_PER_TX_LOAR=1000000
   BRIDGE_MAX_PER_USER_PER_DAY_LOAR=5000000
   ```

5. **Restart server**. `isCustodialBridgeConfigured()` returns true only
   when ALL of these vars are set, so a partial setup keeps the route at
   503 instead of failing mid-flight.

### Replay protection

Pass an opaque `idempotencyKey` (UUID, 8-128 chars) on every `/transfer`
request. The server hashes `(userId, idempotencyKey)` against the
`bridgeIntents` collection and returns the existing intent if it already
exists — same-request retries land on the same intent instead of double-
spending. UI must use a fresh key per logical transfer; reusing one across
different amounts will mis-replay the original.

### Flow (Solana → EVM)

```
user → POST /api/bridge/transfer { from: "Solana", to: "Sepolia", amount, recipient }
  ↓
server:
  1. transferChecked(userSplATA → SOL_BRIDGE_VAULT_ATA, amount) via Circle DCW Solana
  2. On confirm: $LOAR.mint(recipient, amount × 10^9) via Circle DCW EVM
  3. Both txs + intent record persisted in bridgeIntents/{id}
  ↓
returns { sourceTxRef, sequence: intentId, state: "completed" | "submitted" }
```

Reverse (EVM → Solana) is symmetric: `$LOAR.transfer(EVM_BRIDGE_VAULT, amount)`
on source, then `mintToChecked(recipientATA, amount ÷ 10^9)` on destination.

### Status polling

```
GET /api/bridge/status?from=Solana&txRef=bridge_1730412000_xy7
```

Backend recognizes the `bridge_` prefix and reads the intent doc directly
(no Wormhole RPC).

### Failure semantics

| State                 | Cause                             | Resolution                                 |
| --------------------- | --------------------------------- | ------------------------------------------ |
| `pending_source`      | Source tx hasn't landed yet       | Wait or retry                              |
| `pending_destination` | Source landed, destination failed | Operator runs `/api/bridge/retry/:id` (v2) |
| `completed`           | Both legs landed                  | —                                          |
| `failed`              | Source rejected entirely          | Refund (no funds left vault)               |

Stuck `pending_destination` intents are safe: the source funds are in the
vault, and the operator can manually invoke the destination mint via the
same Circle DCW key. v2 adds a retry endpoint + background worker.

### Trust assumptions you must accept (testnet only!)

- Server holds mint authority on both chains.
- If the server's Circle KMS keys are compromised, the bridge can be drained.
- Squads multisig handover before mainnet is non-negotiable —
  [solana-mainnet-runbook.md](./solana-mainnet-runbook.md) step 6.

## NTT backend (v2)

When the NTT manager contracts are deployed and `WORMHOLE_NTT_MANAGER_*` env
vars are set, the bridge automatically routes through Wormhole instead. The
SDK ships at `@wormhole-foundation/sdk` and the wiring lives in
[lib/wormhole-bridge.ts](../apps/server/src/lib/wormhole-bridge.ts). For the
contract side, fork
[wormhole-foundation/example-native-token-transfers](https://github.com/wormhole-foundation/example-native-token-transfers)
and follow the setup script.

Migration is zero-downtime: set the env vars + redeploy the server. The next
bridge request automatically picks the NTT path. The custodial vaults stay
around to drain any pre-migration in-flight intents.

## Decimal scaling

| Side   | Token              | Decimals |
| ------ | ------------------ | -------- |
| Solana | $LOAR (Token-2022) | 9        |
| EVM    | $LOAR (ERC20)      | 18       |

`bridge-custodial.ts` scales `× 10^9` when going Solana → EVM and `÷ 10^9`
in reverse. Amounts under 1 lamport (≈ 1e-9 LOAR) round to zero on the
reverse direction and the route emits an `amount too small` error — UI
should disable the submit button below the threshold.
