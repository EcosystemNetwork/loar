# Gas Abstraction

LOAR users never sign or pay gas from the browser. All EVM contract writes
are server-signed via Circle's Developer-Controlled Wallets (KMS). For
ERC-4337 smart-account flows we additionally proxy a paymaster RPC.

## Server-Signed Writes (Primary Path)

The web client routes every write through `POST /api/tx/write` and gets back
a transaction hash. The server signs and broadcasts using the user's
Circle-custodied wallet — no private key ever touches the client, and the
user never sees a gas prompt.

```
User action (mint / vote / createUniverse)
    │
    ▼
useWriteContract / useSendTransaction  (apps/web/src/hooks/useCircleWrite.ts)
    │  POST /api/tx/write { address, abi, functionName, args, value }
    ▼
Server                                  (apps/server/src/routes/tx.ts)
    │  Circle Developer-Controlled Wallet → KMS sign → broadcast
    ▼
Chain                                   { txHash }
```

Gas is paid from the wallet's own balance. The platform pre-funds creator
wallets through the faucet path for onboarding actions.

## ERC-4337 Paymaster Proxy (Optional)

For smart-account / UserOperation flows, the server exposes a paymaster
proxy at `POST /api/paymaster/sponsor`. Provider is pluggable so we are not
locked into one vendor — resolved in order:

1. `PIMLICO_API_KEY` → Pimlico v2 RPC
2. `BICONOMY_API_KEY` → Biconomy v2 RPC
3. (none) → 503 `NOT_CONFIGURED`

Per-user daily cap defaults to 50 sponsored ops, enforced through the shared
rate limiter (Redis-backed). Configure with:

| Variable                      | Purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `PIMLICO_API_KEY`             | Pimlico paymaster API key                         |
| `BICONOMY_API_KEY`            | Biconomy paymaster API key                        |
| `PAYMASTER_DAILY_LIMIT`       | Max sponsored ops per wallet per day (default 50) |
| `PAYMASTER_DEFAULT_CHAIN_ID`  | Chain id when request omits one (default 84532)   |
| `PAYMASTER_SPONSORED_ACTIONS` | Optional comma-separated function-name allowlist  |

See [apps/server/src/routes/paymaster.ts](../apps/server/src/routes/paymaster.ts).

## Safety Rails

- Allowed chain ids are pinned to Sepolia (11155111) + Base Sepolia (84532).
  Calls on other chains are rejected so a caller cannot drain the paymaster
  balance against unrelated networks.
- Auth required — only signed-in users get sponsored gas.
- Quota is anchored to the authenticated session uid, with a secondary
  per-sender bucket so a compromised session cannot funnel all of its quota
  into a single smart account.
- Optional `PAYMASTER_SPONSORED_ACTIONS` allowlist rejects function names
  outside the configured set — useful in prod to block arbitrary calls.
