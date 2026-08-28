# Solana Parity Restoration — Migration Plan

> **Goal:** bring LOAR back to **true multi-chain parity** — EVM and Solana both
> first-class, chain selector in the UI, custodial $LOAR bridge active — by
> restoring the Solana stack that was built through commit `4cff84fb`
> (2026-05-25) and removed from `main` shortly after.
>
> This is the design spec that supersedes the "PLANNED / NOT YET ACTIVE" banners
> in [solana-overview.md](./solana-overview.md), [prd-solana-parity.md](./prd-solana-parity.md),
> [prd-solana-native-sdk-glue.md](./prd-solana-native-sdk-glue.md),
> [solana-bridge.md](./solana-bridge.md) and [solana-mainnet-runbook.md](./solana-mainnet-runbook.md).
> Those documents describe the _target_ architecture; this one is the _route back to it_.

---

## 1. What happened

|                         |                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot commit         | `4cff84fb` — tag `solana-base-snapshot`, branch `archive/solana-base-support`. **Pure ancestor of `main`.**                                                                                                                                                                                                |
| Removal                 | Solana code deleted from `main` after the snapshot by: `7e861707` (deprecate), **`760ac7e2` (removed all 15 Anchor programs + `apps/solana-indexer` + server libs)**, `034f72e5`, `7bd8e698`, `18c7e1b6` (docs archive). Those commits also _added_ ComfyUI / x402 / ARC — they cannot simply be reverted. |
| Drift since             | ~3 months, ~87 commits on `main` past the snapshot.                                                                                                                                                                                                                                                        |
| Pre-migration EVM state | branch **`eth-version`** (pushed to `origin`), frozen at `main` @ `2ea15639`. Rollback point.                                                                                                                                                                                                              |

### Restore method (decided)

**Surgical checkout from the snapshot commit, per path, then reconcile drift.**
Not `git revert` (bundled with unrelated additions), not a branch merge (87
commits of noise). For each Solana-only path — which no longer exists on `main`,
so restoration is conflict-free:

```
git checkout 4cff84fb -- <path>
```

Then a reconciliation pass on the _shared_ integration points that moved on
`main` (server `env.ts`, `index.ts` route registration, `packages/abis`, web
router, `pnpm-lock.yaml`, root `package.json`).

---

## 2. Inventory to restore (~155 files)

Grouped by phase. All paths as of snapshot `4cff84fb`.

### Self-contained Solana trees (Phase 1)

- `apps/programs/` — Anchor workspace, **15 programs**: `universe`, `episode`,
  `payment`, `rights`, `licensing`, `split_router`, `staking`, `credit_manager`,
  `subscription`, `remix_fees`, `bonding_curve`, `canon_market`, `fee_locker`,
  `premium_actions`, `collab_manager`. Plus `scripts/` (15 init scripts + mainnet
  dry-run + authority-transfer), `tests/` (16 mocha suites), `Anchor.toml`,
  `Cargo.toml`, `package.json`, `tsconfig.json`.
- `apps/solana-indexer/` — Helius webhook → Firestore. `src/{index,anchor-events,program-registry}.ts`,
  `scripts/{register-webhook,smoke-decoder}.ts`, `Dockerfile`, `fly.toml`, `railway.toml`.

### Server integration (Phase 2)

- `apps/server/src/lib/` — `anchor-ix.ts`, `attestation.ts`, `bubblegum.ts`,
  `circle-solana.ts`, `siws.ts`, `squads.ts`, `bridge-custodial.ts`,
  `wormhole-bridge.ts`, `wallet-bridge.ts`, `solana-*.ts` (×12 program SDKs),
  `native-*.ts` (×11 — base, registry, realms, streamflow, jupiter, tensor,
  magiceden, mpl-base + 4 mpl subtypes).
- `apps/server/src/routes/` — `solana.ts`, `solana-pay.ts`, `bridge.ts`,
  `squads.ts`, `siws-auth.ts`.
- `apps/server/src/services/` — `solana/{universe-init,episode-mint,canon-promote,cnft-decompress}.ts`,
  `rights-bridge.ts`.
- `apps/server/scripts/` — `bridge-bootstrap.ts`, `bridge-reconcile.ts`,
  `bridge-roundtrip-e2e.ts`, `migrate-solana-creator-uids.ts`, `solana/{create-loar-mint,check-loar-mint,create-merkle-tree}.ts`.
- `apps/server/src/__tests__/wallet-bridge.test.ts`.
- Reconcile: `apps/server/src/index.ts` (register 5 route groups), `apps/server/src/lib/env.ts` (Solana env schema).

### Shared packages (Phase 3)

- `packages/abis/src/solana-addresses.ts` (restore).
- Reconcile: `packages/abis/src/addresses.ts`, `packages/abis/src/chain.ts` (multi-chain shape).
- `apps/indexer/` (Ponder, EVM) — **unchanged**, stays EVM-only.

### Web (Phase 4)

- `apps/web/src/components/` — `SolanaPayButton.tsx`, `SolanaMintDialog.tsx`.
- `apps/web/src/hooks/useCircleSolanaAddress.ts`.
- `apps/web/src/routes/` — `solana.tsx`, `bridge.tsx`.
- New: `@solana/wallet-adapter-*` deps, `useChain()` data-layer switch, chain
  selector. Reconcile against current TanStack Router + tRPC client.
- `PayAndMintButton.tsx` — was deleted by a _later, unrelated_ refactor; re-derive
  from snapshot only if the wiki entity page still wants the pay-and-mint flow.

### Mobile (Phase 5)

- `apps/mobile/src/lib/solana-auth.ts` — Android MWA SIWS. Dev-client build
  required ([apps/mobile/SOLANA.md](../apps/mobile/SOLANA.md)).

### CI + ops + docs (Phase 6)

- `.github/workflows/anchor-tests.yml` (spins `solana-test-validator`).
- `apps/solana-indexer` deploy configs (fly/railway) + `bridge-reconcile.yml`.
- Flip the STATUS banners in the five Solana docs from "PLANNED" to "ACTIVE".
- Regenerate `docs/solana-parity-matrix.md` from [prd-solana-parity.md](./prd-solana-parity.md) §3.

---

## 3. Drift risks (snapshot → current `main`)

| Area               | Risk                                                                                                                                                                                                                                                                                                          | Mitigation                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root deps          | `@noble/hashes` patch for `mpl-core` was dropped (`pnpm.patchedDependencies: {}`, `patches/` gone). Anchor/umi/spl-governance/streamflow/wormhole deps removed.                                                                                                                                               | Phase 1 restores `patches/@noble__hashes@2.2.0.patch` + re-pins deps from snapshot `package.json` / `pnpm-lock.yaml`, then `pnpm install` and resolve conflicts against current lockfile.                                                                                                   |
| pnpm workspace     | `apps/programs`, `apps/solana-indexer` no longer in `pnpm-workspace.yaml`.                                                                                                                                                                                                                                    | Phase 1 re-adds both globs.                                                                                                                                                                                                                                                                 |
| Server `env.ts`    | 3 months of new env vars; Solana block removed. Validator fails boot if partial.                                                                                                                                                                                                                              | Phase 2 merges the Solana zod block back; keep it optional so EVM-only deploys still boot.                                                                                                                                                                                                  |
| Server `index.ts`  | Route registration is dynamic `await import('./routes/x')`. 5 Solana groups missing.                                                                                                                                                                                                                          | Phase 2 adds them behind `isSolanaConfigured()` guards.                                                                                                                                                                                                                                     |
| `packages/abis`    | `addresses.ts` / `chain.ts` refactored on `main`; `solana-addresses.ts` deleted.                                                                                                                                                                                                                              | Phase 3 reconciles; keep EVM export shape stable for the ~130 consumer files.                                                                                                                                                                                                               |
| Circle SDK         | `circle-solana.ts` may call a bumped Circle DCW API.                                                                                                                                                                                                                                                          | Phase 2 runtime-probe against current `@circle-fin/*` version, patch call sites.                                                                                                                                                                                                            |
| tRPC routers       | `routers/{content,generation,marketplace,storage,universes}/index.ts` were restructured. Solana surfaces branch at data layer.                                                                                                                                                                                | Phase 4 wires `useChain()` at query hooks, not per-route forks (per PRD W6).                                                                                                                                                                                                                |
| Anchor 0.31.1      | Snapshot already targets 0.31.1 = installed `anchor-cli`. Low risk.                                                                                                                                                                                                                                           | Phase 1 `anchor build` confirms.                                                                                                                                                                                                                                                            |
| Devnet program IDs | The 15 deployed devnet program IDs in `Anchor.toml` are still valid (accounts persist). Bubblegum tree + $LOAR devnet mint likewise.                                                                                                                                                                          | Phase 7 re-verifies on-chain before re-registering the Helius webhook.                                                                                                                                                                                                                      |
| Deploy keypairs    | `apps/programs/target/` is gitignored, so `target/deploy/*-keypair.json` (which **are** the program upgrade authority) were never in the repo. `anchor build` mints throwaway keypairs → `anchor keys list` mismatches `declare_id!`. **The `declare_id!` values in each `lib.rs` are intact and canonical.** | Phase 7: obtain the real deploy keypairs from whoever ran the devnet prototype (or `solana program set-upgrade-authority` to a fresh key + `anchor keys sync` if lost), then redeploy. Until then `anchor build` works but `anchor deploy`/`anchor test` against the live devnet IDs won't. |

---

## 4. Phases

Additive throughout — EVM stack untouched until Phase 4 UI wiring, and even then
behind a chain switch. `eth-version` is the rollback point for the whole effort.

### Phase 1 — Restore self-contained Solana trees _(this session)_

1. `git checkout 4cff84fb -- apps/programs apps/solana-indexer`
2. Re-add both to `pnpm-workspace.yaml`.
3. Restore `patches/@noble__hashes@2.2.0.patch` + `pnpm.patchedDependencies` entry.
4. Restore the Solana/Anchor/Metaplex/Wormhole/Streamflow/spl-governance dep
   ranges into the relevant `package.json`s (root + `apps/solana-indexer`).
5. `pnpm install` — resolve lockfile conflicts.
6. `apps/solana-indexer`: `pnpm -F @loar/solana-indexer typecheck`.
7. `apps/programs`: `anchor build` (or `cargo build-sbf` per program). Fix any
   Rust edition / Anchor 0.31 breakage.
8. **Exit:** both trees in the workspace; indexer typechecks; `anchor build`
   produces 15 `.so` + IDLs. No server/web wiring yet. Commit.

### Phase 2 — Server integration

- Restore all `apps/server/src/lib/{solana-*,native-*,squads,attestation,anchor-ix,bubblegum,circle-solana,siws,bridge-custodial,wormhole-bridge,wallet-bridge}.ts`, `routes/{solana,solana-pay,bridge,squads,siws-auth}.ts`, `services/solana/*`, `services/rights-bridge.ts`, and server `scripts/`.
- Merge Solana zod block into `lib/env.ts` (optional-gated).
- Register the 5 route groups in `index.ts` behind config guards.
- Runtime-probe Circle DCW + Umi/web3.js adapters against current dep versions.
- Restore `wallet-bridge.test.ts`; `pnpm -F @loar/server typecheck && test`.
- **Exit:** server boots with `isSolanaConfigured()` true against devnet env; SIWS verify + `/api/solana/config` + `/api/bridge/health` respond.

### Phase 3 — Shared ABIs / addresses

- Restore `packages/abis/src/solana-addresses.ts`; reconcile `addresses.ts` + `chain.ts` to the multi-chain shape without breaking EVM consumers.
- **Exit:** `pnpm -F @loar/abis build`; downstream typecheck green in web + server.

### Phase 4 — Web (chain-aware UI)

- Add `@solana/wallet-adapter-{base,react,react-ui,wallets}` + `@solana/web3.js`.
- Restore `SolanaPayButton`, `SolanaMintDialog`, `useCircleSolanaAddress`, routes `/solana`, `/bridge`.
- Build `apps/web/src/lib/chain.ts` — `useChain()` + selector; branch data hooks, not routes.
- Thin `apps/web/src/lib/governance.ts` normalization layer (OZ Governor ↔ Realms) per PRD risk row.
- **Exit:** chain selector switches universe lifecycle reads/writes between EVM and Solana devnet; Solana Pay QR + bridge UI functional.

### Phase 5 — Mobile

- Restore `apps/mobile/src/lib/solana-auth.ts`; document dev-client build in release notes.
- **Exit:** Android dev client completes SIWS; iOS shows the universal-link fallback CTA.

### Phase 6 — CI + ops + docs

- Restore `.github/workflows/anchor-tests.yml`; add `apps/programs` + `apps/solana-indexer` to the workspace CI matrix.
- Restore indexer deploy configs + `bridge-reconcile.yml`.
- Flip the five Solana docs to ACTIVE; regenerate the parity matrix.
- **Exit:** CI runs `anchor test` on PRs touching `apps/programs/`; green.

### Phase 7 — Devnet redeploy + parity hardening

- Re-verify the 15 devnet program IDs + Bubblegum tree + $LOAR devnet mint on-chain; redeploy any that drifted (`anchor upgrade`).
- Re-register the Helius webhook to the restored indexer URL.
- Run `apps/programs/scripts/mainnet-runbook-dryrun.ts` (devnet) + `bridge-roundtrip-e2e.ts`.
- Then hand off to the [prd-solana-parity.md](./prd-solana-parity.md) S0–S5 phases (audit engagement, Wormhole NTT, Squads handover, mainnet-beta) — **out of scope for this restoration; that PRD owns it.**
- **Exit:** full universe lifecycle (create → bond → launch → canon → trade → govern → bridge) green on Solana devnet through the restored UI.

---

## 5. Out of scope

- Replacing EVM with Solana / migrating canonical IP off EVM (never a goal — EVM stays canonical for rights).
- Mainnet-beta deploy, external Anchor audit, Wormhole NTT — owned by [prd-solana-parity.md](./prd-solana-parity.md) phases S0–S5.
- Net-new product features on either chain.

## 6. Status log

| Date       | Phase | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-27 | 0     | `eth-version` branch cut + pushed. Plan written. Phase 1 started.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-27 | 1     | ✅ `apps/programs` + `apps/solana-indexer` restored from `4cff84fb` and re-added to the pnpm workspace. `pnpm install` clean. `apps/solana-indexer` typechecks. `anchor build` green — 15 `.so` + 15 IDLs + 15 type files (Anchor 0.31.1, warnings only: deprecated `realloc`, `cfg(anchor-debug)`). Root `build` script re-excludes `@loar/programs`. Deploy-keypair reconciliation deferred to Phase 7 (see drift table).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-27 | 2     | ✅ Server integration. Restored 44 `apps/server/src/**` Solana files (12 program SDKs, 11 native adapters, siws/squads/attestation/bubblegum/circle-solana/bridge-custodial/wormhole-bridge/anchor-ix/wallet-bridge, 5 routes, 4 `services/solana/*`, rights-bridge, wallet-bridge.test.ts) + 7 `scripts/**`. Added 19 server deps. Reconciled shared files: `siwe.ts` (re-added `IssueSessionOpts` + `ns`/`evm`/`sol` claims, backward-compatible), `universes.handlers.ts` (`createUniverse` Solana branch — `chainNamespace`/`solanaCluster`, no `.toLowerCase()` on base58), `env.ts` (Solana zod block, all optional + prod gate), `index.ts` (mounted `/auth/solana`, `/api/solana`, `/api/solana-pay`, `/api/squads`, `/api/bridge` + `auditBridgeConfig()`). Restored `packages/abis/src/{chain,solana-addresses}.ts` + rebuilt. **server typecheck PASS · wallet-bridge.test 10/10 · full suite 236 pass / 42 skip** (3 unrelated suites need the Firestore emulator). Runtime import smoke: all Solana libs load. |
