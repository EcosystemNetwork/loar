# PRD: Migrate Indexer from Ponder/Neon to Firestore

**Status**: Draft · **Author**: generated 2026-04-20 · **Target start**: week of 2026-04-27

## Problem

The Ponder indexer holds all on-chain state in a Neon Postgres DB that has already hit its 512 MB free-tier cap once (forcing a Launch-plan upgrade). Storage grows unbounded because Ponder caches every raw RPC response alongside derived tables, and indexer DB size is proportional to chain activity — not useful rows. We also now run two indexer services (Sepolia + Base Sepolia) against the same Neon project, doubling the footprint.

LOAR otherwise uses Firestore for all app state. Keeping Ponder means owning a second database, second deploy target, second failure mode, and paying Neon indefinitely.

## Goal

Replace Ponder with a lean Node service that subscribes to on-chain events and writes only the fields we need to Firestore. Drop Neon entirely.

## Non-goals

- Replacing Pinata (unrelated — IPFS media stays).
- Replacing Firebase Admin / Firestore.
- Re-deriving historical data from before the deployed contracts' startBlock.
- Building a generic indexer framework.

## Scope of what Ponder currently does

| Surface                                 | Count / size                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event handlers (`ponder.on(...)`)       | 36                                                                                                                                                                                                       |
| Schema entities                         | ~27                                                                                                                                                                                                      |
| `ponder.schema.ts` LOC                  | 688                                                                                                                                                                                                      |
| `src/index.ts` LOC                      | 936                                                                                                                                                                                                      |
| Contracts tracked                       | 12 (UniverseManager, Universe, Governor, GovernanceToken, BondingCurve, PoolManager, PaymentRouter, CreditManager, SubscriptionManager, CanonMarketplace, AdPlacement, LicensingRegistry, CollabManager) |
| Factory-spawned contracts               | 4 dynamic (Universe, Governor, Token, BondingCurve per-universe)                                                                                                                                         |
| Frontend files consuming Ponder GraphQL | 6 (`useTokens`, `useUniverseBlockchain`, `useUniverseAddresses`, `useTokenSwap`, `routes/index.tsx`, `routes/docs.tsx`)                                                                                  |

## What we give up by dropping Ponder

1. **Automatic re-org handling.** Ponder rewinds and re-indexes on chain reorgs. Our replacement needs equivalent logic.
2. **GraphQL surface.** Frontend currently queries a hosted GraphQL endpoint. We move those reads to tRPC + Firestore.
3. **Checkpointing / resume.** Ponder tracks the last indexed block per contract and resumes cleanly after restart. We need this.
4. **Factory discovery.** Ponder tracks addresses spawned by factory events automatically. We replicate it manually.

## Architecture

```
                                  ┌─────────────────┐
  RPC (Alchemy + fallback) ──────▶│ event-listener  │──▶ Firestore collections
                                  │ (new service)   │
                                  │ per chain       │
                                  └─────────────────┘
                                          │
                                          ▼
                                  apps/server (tRPC) ──▶ apps/web
```

- New service: `apps/event-listener/` (one Railway service per chain, or one process with both chains).
- Node + viem + `firebase-admin`. No SQL, no Drizzle.
- Stays in the monorepo; shares `packages/abis` with everything else.

### Data model (Firestore)

Mirror entities 1:1 from `ponder.schema.ts` with minor flattening:

- `universes/{id}` — top-level universe records
- `tokens/{address}` — ERC20 token per universe
- `bondingCurves/{address}` — bonding curve state
- `bondingCurves/{address}/trades/{txHash_logIdx}` — trade subcollection
- `bondingCurves/{address}/snapshots/{block}` — price/supply snapshots
- `bondingCurves/{address}/refunds/{txHash}` — refund events
- `nodes/{universeAddress_nodeId}` — canon / content nodes
- `proposals/{universeAddress_proposalId}` — governance proposals
- `pools/{poolId}` / `swaps/{txHash_logIdx}` — Uniswap v4
- `licenses/{id}`, `collabs/{id}`, `adSlots/{id}`, `sponsorships/{id}` — revenue-contract events
- `indexerCheckpoints/{chain}` — `{ lastBlockIndexed, lastBlockFinalized, updatedAt }`

Composite indexes needed for sort-by-time + filter-by-universe queries; write them in `firestore.indexes.json`.

### Event ingestion loop

Per chain, run two tasks:

1. **Backfill**: `eth_getLogs` in chunks (start at contract deployment block, walk forward until head-ish). Write to Firestore with batch writes (500 ops per batch). Update checkpoint after each chunk.
2. **Live**: Poll `eth_getLogs(fromBlock = checkpoint - finalityDepth, toBlock = 'latest')` every N seconds, or use WebSocket subscriptions if RPC supports them. Write idempotently (event id = `${chainId}:${txHash}:${logIndex}`) so replays are safe.

### Re-org handling (the hard part)

- Mark any event in blocks newer than `head - finalityDepth` as `unconfirmed: true`.
- On each poll, compare stored `blockHash` for blocks in the unconfirmed window to current chain. If mismatch, delete all events in that block (Firestore batch) and re-index.
- Only flip `unconfirmed: false` when the block is `finalityDepth` blocks deep (15 for Sepolia, matches current Ponder config).
- tRPC read queries filter `unconfirmed != true` by default; an explicit `includeUnconfirmed` flag for UIs that want optimistic reads.

### Factory tracking

- Keep a Firestore collection `factoryChildren/{chain}/{factoryAddress}/{childAddress}` updated by the top-level factory handler.
- On startup, load into memory as the set of addresses to subscribe to for per-universe events.

## Migration plan (5 weeks, realistic)

### Week 1 — Schema + scaffold

- Create `apps/event-listener/` with viem client, Firestore client, checkpoint loader.
- Port `ponder.schema.ts` types → TypeScript types + Firestore converters.
- Stand up empty service on Railway (no events handled yet).

### Week 2 — Factory + core events

- Handlers: `UniverseCreated`, `TokenCreated`, `BondingCurveCreated`. These populate `factoryChildren` which everything else depends on.
- Write parallel to Ponder's Firestore manifest so data doesn't diverge.

### Week 3 — Per-universe events + trades

- Universe, BondingCurve, GovernanceToken, Governor handlers (23 of the 36).
- Start writing real data. Do **not** read from these yet on frontend.

### Week 4 — Revenue contracts + reads cutover

- Remaining 10 revenue-contract handlers.
- Build tRPC endpoints that mirror what the 6 frontend files currently fetch from Ponder GraphQL.
- Swap `apps/web/src/utils/ponder-api.ts` → `trpc.indexer.*` one page at a time.
- Keep Ponder running as the backup source of truth.

### Week 5 — Re-org handling + cut Ponder

- Ship re-org detection + unconfirmed flag.
- Run both systems in parallel for ≥3 days, compare outputs via a diff script.
- Flip production reads to new system.
- Decommission Ponder services + Neon project.

## Risks & honest caveats

- **Re-org handling is the part most likely to ship buggy.** Budget extra time. Consider starting with `finalityDepth=30` (over-conservative) until confident.
- **Firestore reads cost per-document.** A page that renders 100 trades = 100 reads. Evaluate whether any current GraphQL query would blow up costs; cache hot queries in Redis.
- **Firestore write throughput**: 10k writes/sec soft limit, fine for us.
- **Loss of Ponder's community bugfixes.** We'd be maintaining indexer + re-org logic forever.
- **Doesn't help if the bottleneck is RPC cost**. Both approaches make the same RPC calls. If Alchemy bills grow, indexer choice doesn't change that; only adding a caching RPC proxy would.

## Rollback

Keep Neon project paused (not deleted) for 2 weeks post-cutover. If the new service misbehaves in production, flip `USE_PONDER_READS=true` env var on `loar` to route reads back through `utils/ponder-api.ts` and restart Ponder.

## Open questions (resolve before starting)

1. Do we want one event-listener process per chain (matches current Ponder deploy topology, two Railway services) or one process handling both chains (simpler, single point of failure)?
2. Are we comfortable dropping historical events we haven't needed yet (pre-contract-deployment blocks) to reduce Firestore ops?
3. Do we want to keep the GraphQL surface for external consumers (if any), or is tRPC-only acceptable?
