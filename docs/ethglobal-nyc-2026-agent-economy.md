# LOAR × ENS · Arc · Google Cloud — ETHGlobal NYC 2026

One thesis, three sponsors: **the autonomous agent economy.** LOAR's AI agents get
a **name** (ENS), the ability to **pay each other** (Arc/USDC via x402), and
**discoverability + reputation** (Google BigQuery over ERC-8004). `x402` +
`ERC-8004` are the shared rails. Companion to the Uniswap submission
([ethglobal-nyc-2026-uniswap.md](./ethglobal-nyc-2026-uniswap.md)).

| Sponsor                | Track(s)                                                 | What we built                                                                                     |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **ENS** ($20k)         | AI-Agent Integration · Creative · Integrate · Continuity | Resolution + ENSIP-25/26 agent cards + **CCIP-Read offchain subname fleet** (`*.agents.loar.eth`) |
| **Arc** ($15k)         | Agentic Economy · Continuity                             | **USDC agent-to-agent payments** + **x402** pay-per-call settled on Arc                           |
| **Google Cloud** ($5k) | On-Chain Agent Economy                                   | **BigQuery over ERC-8004** registries (mainnet) + reputation ranking + x402-agent flagging        |

---

## ENS — agent identity

| Piece                                               | File                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Resolution + ENSIP-25/26 agent cards                | [lib/ens.ts](../apps/server/src/lib/ens.ts)                                            |
| Offchain agent subname registry                     | [lib/ens-agent-registry.ts](../apps/server/src/lib/ens-agent-registry.ts)              |
| Resolver helpers + **CCIP-Read gateway** (EIP-3668) | [routes/ens.ts](../apps/server/src/routes/ens.ts)                                      |
| CCIP-Read resolver contract (ENSIP-10)              | [contracts/.../LoarAgentResolver.sol](../apps/contracts/src/ens/LoarAgentResolver.sol) |
| tRPC `ens.*`                                        | [routers/ens/ens.routes.ts](../apps/server/src/routers/ens/ens.routes.ts)              |
| MCP tools                                           | `loar_ens_resolve`, `loar_ens_agent_card`, `loar_ens_claim_agent_subname`              |

- **Real ENS code, not Rainbowkit.** Forward/reverse (forward-verified) + text
  records + ENSIP-26 agent endpoints, live against mainnet.
- **Agent fleets via CCIP-Read.** `LoarAgentResolver.sol` is the resolver for
  `agents.loar.eth`; any subname defers to our gateway
  (`GET /api/ens/ccip/{sender}/{data}.json`), which serves the agent's address +
  ENSIP-26 records from Firestore and **signs** the answer
  (`keccak256(0x1900 ‖ resolver ‖ expires ‖ keccak(request) ‖ keccak(result))`),
  verified on-chain. A whole agent fleet gets gasless, verifiable ENS names.
- **No hard-coded values** — every name resolves from the registry / live ENS.
- **Verified live:** `apps/server/scripts/test-ens-live.ts` (5/5 — resolves
  `vitalik.eth` ↔ address against mainnet).

**One-time wiring (ops):** deploy `LoarAgentResolver` with the gateway URL +
the platform signer address; set it as the resolver for `agents.loar.eth`.

## Arc — agent payments (USDC + x402)

| Piece                            | File                                                                        |
| -------------------------------- | --------------------------------------------------------------------------- |
| Arc chain + USDC transfer/verify | [lib/arc.ts](../apps/server/src/lib/arc.ts)                                 |
| x402 facilitator (402 + settle)  | [lib/x402.ts](../apps/server/src/lib/x402.ts)                               |
| x402-gated demo endpoint         | [routes/x402.ts](../apps/server/src/routes/x402.ts) — `POST /api/x402/echo` |
| tRPC `arc.*`                     | [routers/arc/arc.routes.ts](../apps/server/src/routers/arc/arc.routes.ts)   |
| MCP tools                        | `loar_arc_pay`, `loar_arc_balance`                                          |

- **Agent-to-agent USDC** on Arc (chain `5042002`, native USDC at `0x3600…0000`),
  signed by the platform key for the paying agent — LOAR's custodial model.
- **x402 (HTTP 402) pay-per-call:** an agent hits a paid resource → `402` +
  `accepts` (price, payTo, asset) → pays USDC on Arc → retries with `X-PAYMENT`
  (tx hash) → we verify the transfer on-chain and grant access once per tx
  (replay-protected). This is "AI agents paying for API calls per-use."
- **Tested:** x402 encode/handshake unit tests (3/3,
  [`__tests__/x402.test.ts`](../apps/server/src/__tests__/x402.test.ts)).

## Google Cloud — ERC-8004 reputation via BigQuery

| Piece                              | File                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| BigQuery client + ERC-8004 queries | [lib/bigquery-erc8004.ts](../apps/server/src/lib/bigquery-erc8004.ts)                                             |
| tRPC `agentRegistry.*`             | [routers/agentRegistry/agentRegistry.routes.ts](../apps/server/src/routers/agentRegistry/agentRegistry.routes.ts) |
| Frontend dashboard                 | [web/.../agents.discover.tsx](../apps/web/src/routes/agents.discover.tsx) (`/agents/discover`)                    |
| MCP tools                          | `loar_agent_rank`, `loar_agent_reputation`                                                                        |

- **BigQuery is the core**, as required: queries `bigquery-public-data.crypto_ethereum.logs`
  filtered to the **EF ERC-8004** registries (Identity `0x8004A818…`, Reputation
  `0x8004B663…`) to rank agents by on-chain feedback.
- **Frontend** at `/agents/discover` pairs the BigQuery backend with a lightweight
  UI (ENS resolver + leaderboard + **x402-agent flagging**).
- Auth reuses the existing GCP service account (no new dependency — uses
  `google-auth-library` + the BigQuery REST API).

---

## Configuration

All gated on env — unset = clean "not configured" responses, app unaffected.
See [.env.example](../.env.example) for the full annotated list. Quick map:

```
ENS:    (RPC_URL_MAINNET optional)  ENS_AGENT_PARENT  PUBLIC_BASE_URL
Arc:    ARC_RPC_URL  X402_PAY_TO  X402_PRICE_USDC   (signing via PRIVATE_KEY/KMS)
GCloud: GCP_PROJECT_ID  GCP_SERVICE_ACCOUNT_JSON  ERC8004_*_REGISTRY
```

## Status

- ✅ All server code typechecks (`tsc -b`); MCP + web typecheck.
- ✅ ENS resolution verified live (mainnet). x402 logic unit-tested.
- ⏳ Live on-chain demos need creds + funds (ops): an Arc-funded wallet (USDC
  faucet) for payments; a GCP project with BigQuery for the leaderboard; the
  `LoarAgentResolver` deploy + `agents.loar.eth` resolver set for CCIP subnames.
- ⏳ Per-sponsor: demo video + booth presentation (ENS, Sunday AM).
