# EVM Mainnet Cutover — Sepolia → Ethereum Mainnet

> Single-purpose runbook for taking the **Ethereum-only** LOAR deployment
> (Sepolia 11155111 + mainnet 1; Base and Solana removed from chain selection
> 2026-06-12) from testnet to mainnet. Pairs with the canonical
> [launch-readiness.md](./launch-readiness.md) and
> [safe-timelock-runbook.md](./safe-timelock-runbook.md) — this page does **not**
> duplicate the Safe/Timelock mechanics, it sequences the whole cutover.

Last updated: 2026-06-13.

---

## 0. Current posture (what's already done)

The app is wired for **two chains, Ethereum only**:

| Layer                                                                  | Sepolia (11155111)          | Mainnet (1)             |
| ---------------------------------------------------------------------- | --------------------------- | ----------------------- |
| Web chain picker / wagmi                                               | live                        | live                    |
| SIWE auth allowlist                                                    | ✅                          | ✅                      |
| Circle DCW wallets (`ETH-SEPOLIA` / `ETH`)                             | ✅                          | ✅                      |
| Uniswap swaps + tx verification                                        | ✅                          | ✅                      |
| Server chain clients (credits, nft, listings, governance, treasury, …) | ✅                          | ✅                      |
| **LOAR contract addresses**                                            | ✅ deployed + verified live | ❌ not deployed         |
| **Indexer / event-listener**                                           | ✅ live                     | 🟡 scaffolded (drop-in) |

"Scaffolded (drop-in)" = the `mainnet` network is already coded into the indexer
and event-listener; it activates the moment `PONDER_CHAIN=mainnet` /
`LISTENER_CHAIN=mainnet` **and** a `deployments/mainnet.json` exists. No code
change is needed at cutover — only data + env.

Prod KMS signing is live: `@aws-sdk/client-kms` is installed, so `getSigner()`
works in production when `KMS_KEY_ID` is set.

---

## 1. Cutover sequence (ordered)

Each step is gated on the previous one. Steps marked **⛔ funded/irreversible**
require the operator's keys and real ETH — do not automate blindly.

### Step 1 — Pre-deploy gates (do NOT deploy until all true)

- [ ] EVM external audit **Pass 1 + 2** complete, criticals fixed (`EVM-AUDIT-1/2`)
- [ ] Legal sign-off: ToS/Privacy counsel review, DMCA agent registered, `$LOAR`
      ticker decision (`LEGAL-01/02/03`) — see [launch-readiness.md](./launch-readiness.md)
- [ ] Deployer EOA funded with mainnet ETH for gas
- [ ] `FOUNDRY_PROFILE=test forge build` passes (default profile trips the Solc
      0.8.30 "Tag too large" IR bug — see `apps/contracts/foundry.toml`)

### Step 2 — Deploy contracts ⛔

Run from `apps/contracts/` against a mainnet RPC. Scripts already exist:

```
FOUNDRY_PROFILE=test forge script script/DeployAll.s.sol \
  --rpc-url $RPC_1 --broadcast --verify --etherscan-api-key $VERIFICATION_KEY_1
```

`DeployAll.s.sol` deploys the full stack (UniverseManager, LoarToken,
PaymentRouter, CreditManager, RightsRegistry, CanonMarketplace, etc.). Capture
every deployed address + the deploy block.

### Step 3 — Write `deployments/mainnet.json`

Mirror `deployments/sepolia.json` exactly, with mainnet addresses + `chainId: 1`

- the real `startBlock` (deploy block from Step 2). This single file unblocks the
  indexer + event-listener mainnet networks (already scaffolded).

### Step 4 — Wire frontend + server addresses

- [ ] Add a `1: { … }` block to [apps/web/src/configs/addresses.ts](../apps/web/src/configs/addresses.ts)
      (`EVM_ADDRESSES`), same shape as the `11155111` block.
- [ ] Run `pnpm sync:addresses` if the generator is wired, else hand-edit
      `packages/abis` address maps to add the `1` key.
- [ ] Set server contract-address envs for mainnet (`LOAR_TOKEN_ADDRESS`,
      `UNIVERSE_MANAGER`, `TREASURY_ADDRESS`, …) for the prod replica.

### Step 5 — Flip indexer + event-listener (drop-in, no code change)

- [ ] Indexer host: `PONDER_CHAIN=mainnet`, `PONDER_RPC_URL_2=<mainnet RPC>`
- [ ] Event-listener host: `LISTENER_CHAIN=mainnet`, `LISTENER_RPC_URL=<mainnet RPC>`
- [ ] **Verify** the Uniswap v4 PoolManager mainnet address baked into
      `ponder.config.ts` / `chain-config.ts`
      (`0x000000000004444c5dc75cB358380D2e3dE08A90`) against on-chain bytecode
      before going live — it is the canonical v4 address but confirm.

### Step 6 — Governance handoff ⛔

Follow [safe-timelock-runbook.md](./safe-timelock-runbook.md):

- [ ] Deploy Gnosis Safe (3/5) + `TimelockController(48h)` (`GOV-01`)
- [ ] `DeployTimelockFactory.s.sol` (wires TimelockFactory into
      UniverseTokenDeployerV3 — `TIMELOCK-01`)
- [ ] `TransferToMultisig.s.sol` with `DRY_RUN=true` first, then broadcast — moves
      every contract's admin off the deployer EOA
- [ ] `VerifyMultisigTransfer.s.sol` to confirm zero residual EOA ownership
- [ ] `setCommunityRecipient` on `$LOAR` → treasury/DAO wallet (`TOKEN-04`)

### Step 7 — Prod app config (see §3) + smoke

- [ ] Prod env hardening (NODE_ENV, TRUST_PROXY, CORS, secrets) per §3
- [ ] `DMCA_PUTBACK_ENABLED=true` on exactly one replica (`DMCA-01`)
- [ ] Run the smoke harness (`pnpm smoke`) against mainnet
- [ ] `git tag -a v0.1.0 && git push --tags` (`RELEASE-TAG`)

---

## 2. Live readiness snapshot (2026-06-13)

From `apps/server/src/services/mainnet-readiness/blockers.ts` (`snapshotReadiness()`),
evaluated against the current `.env`. **22 blockers tracked.**

**Auto-checkable (env-detectable):**
| ID | Status | Title |
|----|--------|-------|
| INFRA-02 | ✅ READY | SIWE JWT secret + KMS (`@aws-sdk/client-kms` now installed) |
| GOV-01 | ⬜ blocked | Gnosis Safe (3/5) + Timelock |
| TOKEN-04 | ⬜ blocked | Community treasury recipient |
| DMCA-01 | ⬜ blocked | DMCA putback flag |
| SOL-\* (4) | ⬜ blocked | Solana multisig / bridge / Helius — see note below |

**Manual / external (no auto-check):** EVM audit Pass 1+2, Solana audit,
Code4rena/Sherlock bounty (`audit_firm`, months); LEGAL-01..03 + likeness policy
(`legal`, weeks); GOV-01 / TIMELOCK-01 / TOKEN-04 / RELEASE-TAG (`ops`).

### ⚠️ Eth-only simplification

**~8 of the 22 blockers are Solana-specific** (`SOL-MULTISIG-01`, `SOL-OPS-13/14/15`,
`SOL-RUNBOOK-01`, `SOL-BRIDGE-ENV`, `HELIUS-WEBHOOK`, `SOL-AUDIT-01`, `SOL-NTT-01`).
Since Solana is a **planned future chain** (its code was removed from the active
build and archived to branch `archive/solana-base-support`), **an EVM-only
mainnet launch can drop these from the critical path.** With Solana shelved for
v1, prune them from `blockers.ts` + `launch-readiness.md` so the readiness %
reflects reality. That leaves the true EVM gate as: \*\*2 external (audit Pass 1+2)

- 4 legal + 4 operational.\*\*

---

## 3. Prod config hardening (app layer — in our control)

Current `.env` is a **dev** profile. Before prod, the prod replica needs:

| Var                              | Dev (now)           | Prod requirement                                                                   |
| -------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `NODE_ENV`                       | development         | **production** (tightens SIWE domain/chain validation)                             |
| `TRUST_PROXY`                    | unset               | **true** behind Railway/Fly/Vercel LB (else rate-limit keys collapse to the LB IP) |
| `CORS_ORIGIN`                    | localhost           | the real prod domain(s)                                                            |
| `SIWE_ALLOWED_DOMAINS`           | default             | prod domain (localhost rejected in prod)                                           |
| `KMS_KEY_ID` / `KMS_REGION`      | unset (PRIVATE_KEY) | **set** — KMS signing, no raw key on host                                          |
| `RPC_URL_MAINNET` / `VITE_RPC_1` | unset               | dedicated mainnet RPC (Alchemy/Infura)                                             |
| `REDIS_URL`                      | set                 | required (rate limit, queue, breakers)                                             |
| `DMCA_PUTBACK_ENABLED`           | unset               | true on one replica                                                                |

Build/verify status (2026-06-13): web `vite build` ✅, mcp `tsc -b` ✅,
event-listener esbuild ✅, all 5 packages typecheck ✅, server test suite 232 pass.

---

## 4. What this doc does NOT cover (by reference)

- Safe/Timelock mechanics → [safe-timelock-runbook.md](./safe-timelock-runbook.md)
- Full blocker list + owners + effort → [launch-readiness.md](./launch-readiness.md)
- Audit firm outreach → [external-audit-engagement.md](./external-audit-engagement.md)
- Scale targets (10k) → [scale-readiness-10k.md](./scale-readiness-10k.md)
- General deploy infra → [deployment.md](./deployment.md)
