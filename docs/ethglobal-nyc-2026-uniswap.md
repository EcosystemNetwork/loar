# LOAR × Uniswap — ETHGlobal NYC 2026 Submission

**Tracks:** Uniswap Foundation — Track 1 (Best Uniswap API Integration, $7k) + Track 2
(Best Uniswap Stack Contribution, $3k — Continuity Track).

LOAR is a decentralized AI-studio platform. This submission adds a **hosted Uniswap
Trading API** integration that powers swap-to-buy-credits and agent-to-agent swaps,
all settled non-custodially-to-the-user through Circle Developer-Controlled Wallets
(server-signed, KMS-custodied — users never touch keys or gas).

It complements LOAR's **existing on-chain Uniswap v4 stack** (custom hooks + LP
locker + bonding-curve graduation into v4 pools) — that's the Track 2 contribution.

---

## What was built (Track 1 — Trading API)

| Layer             | File                                                                                                      | What it does                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API client        | [apps/server/src/lib/uniswap-trading-api.ts](../apps/server/src/lib/uniswap-trading-api.ts)               | Typed wrapper over the Trading API: `/check_approval`, `/quote`, `/swap`. `x-api-key` auth. Orchestrates approval → quote → Permit2 sign → swap calldata → execute.                           |
| Circle settlement | [apps/server/src/lib/circle-wallets.ts](../apps/server/src/lib/circle-wallets.ts)                         | `executeTransaction` signs the returned calldata via Circle KMS; new `signTypedData` (Permit2 EIP-712) + `getOrCreateWalletForChain` (per-chain wallet so the tx lands on the right network). |
| tRPC router       | [apps/server/src/routers/uniswap/uniswap.routes.ts](../apps/server/src/routers/uniswap/uniswap.routes.ts) | `uniswap.status / quote / swap / swapToLoar`. Registered in the root router as `uniswap.*`.                                                                                                   |
| AI agent tools    | [apps/mcp/src/tools.ts](../apps/mcp/src/tools.ts)                                                         | `loar_uniswap_quote`, `loar_uniswap_swap`, `loar_uniswap_swap_to_loar` — any MCP agent can price + execute swaps. This is the "coordination between agents or systems" criterion.             |
| Web UI            | [apps/web/src/routes/swap.tsx](../apps/web/src/routes/swap.tsx)                                           | `/swap` page — live debounced quotes, route + gas + Permit2 display, one-tap execute, explorer link. Reachable from the header (My Stuff → Swap).                                             |

### Flow

```
user / AI agent
   │  uniswap.quote / uniswap.swap   (or loar_uniswap_* MCP tool)
   ▼
LOAR server ──POST /quote, /swap (x-api-key)──▶ Uniswap Trading API
   │                                                │ returns {to, data, value}
   │  Permit2 EIP-712 (ERC20 in) ──signTypedData──▶ Circle KMS
   ▼
Circle DCW  ──createContractExecutionTransaction──▶ Universal Router (on-chain)
   │
   ▼  txHash
```

Native-ETH inputs (e.g. `ETH → $LOAR`) skip approval + Permit2 entirely — the
simplest path and the headline demo.

### Why it fits LOAR

`swapToLoar` is the **swap-to-buy-credits on-ramp**: convert any token → `$LOAR`
(the platform's credit/discount currency), which then funds `credits.purchaseWithLoar`.
Agents earning or spending across the studio can self-serve liquidity without a human.

---

## Track 2 — existing Uniswap v4 stack contribution

LOAR already ships (pre-hackathon, qualifying for the Continuity Track):

- **Custom v4 hooks** — [`LoarHook`](../apps/contracts/src/hooks/LoarHook.sol) /
  `LoarHookStaticFee` (`beforeSwap`/`afterSwap`, protocol-fee skim into `LoarFeeLocker`).
- **v4 LP locker** — [`LoarLpLockerMultiple`](../apps/contracts/src/lp-lockers/LoarLpLockerMultiple.sol)
  (permanent multi-range positions via `IPositionManager`, fee streaming to recipients).
- **v4 swap router** — [`LoarSwapRouter`](../apps/contracts/src/LoarSwapRouter.sol)
  (`IUnlockCallback`, settle/take).
- **Bonding curve → v4 graduation** — [`BondingCurve`](../apps/contracts/src/BondingCurve.sol)
  migrates raised ETH + unsold supply into a v4 pool at the graduation threshold.

---

## Configuration

```bash
# root .env (gitignored)
UNISWAP_API_KEY=...                 # Uniswap Developer Platform → API Keys
# UNISWAP_TRADING_API_BASE=https://trade-api.gateway.uniswap.org/v1   # optional override
```

When unset, `uniswap.*` and the MCP tools return a clean "not configured" error;
the rest of the app is unaffected.

## Demo chain

**Ethereum Sepolia (11155111)** — verified routable by the Trading API
(`ETH→UNI`, `ETH→USDC`, `ETH→$LOAR`). Mainnet (1) and Base (8453) also supported.
Base Sepolia is **not** routable (no Trading API liquidity).

## Recording submission transaction IDs

The prize requires real on-chain tx IDs. To capture:

1. Set `UNISWAP_API_KEY` in `.env`; start the server + web app.
2. Ensure the demo user's **Sepolia** Circle wallet is funded with test ETH
   (`getOrCreateWalletForChain` provisions it on first swap; fund that address).
3. Go to `/swap`, swap e.g. `0.001 ETH → $LOAR`, execute.
4. The success toast + "View transaction" link give the
   `https://sepolia.etherscan.io/tx/<hash>` — collect these hashes for the
   submission form. The same hashes are returned by `uniswap.swap` (`txHash`)
   and by the `loar_uniswap_swap` MCP tool for the agent demo.

## Submission checklist

- [x] Trading API integrated with a valid API key (`x-api-key`)
- [x] Trade execution + routing + (Permit2) liquidity coordination
- [x] Agent-based system (MCP tools) leveraging the API
- [x] Open-source code + this README
- [ ] Transaction IDs (testnet) — capture via the steps above
- [ ] Demo video (≤ 3 min)
- [ ] Uniswap Developer Feedback Form
