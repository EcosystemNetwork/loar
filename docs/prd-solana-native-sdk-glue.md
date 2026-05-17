# PRD: Solana Native-SDK Glue Layer

**Status**: All 10 adapters runtime-ready — 2026-05-17
**Decision**: Don't port Solana-native primitives that already exist; integrate them as **thin TS adapters** behind the same interface shape as the rest of the parity stack.

**Implementation state**:

| Adapter                    | Public surface | Body wired?                                              | Dep installed                                                                                                          |
| -------------------------- | -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| native-base.ts             | ✅             | ✅                                                       | n/a                                                                                                                    |
| native-registry.ts         | ✅             | ✅                                                       | n/a                                                                                                                    |
| native-jupiter.ts          | ✅             | ✅ (pure HTTP)                                           | n/a (Jupiter is API-only)                                                                                              |
| native-tensor.ts           | ✅             | ✅ (pure HTTP, needs `TENSOR_API_KEY`)                   | n/a                                                                                                                    |
| native-magiceden.ts        | ✅             | ✅ (pure HTTP, needs `MAGIC_EDEN_API_KEY`)               | n/a                                                                                                                    |
| native-streamflow.ts       | ✅             | ✅ (`SolanaStreamClient.prepare*Instructions`)           | ✅ `@streamflow/stream`                                                                                                |
| native-realms.ts           | ✅             | ✅ (`withCreateRealm` / `withCastVote` + PDA helpers)    | ✅ `@solana/spl-governance` + `bn.js`                                                                                  |
| native-mpl-base.ts + 4 sub | ✅             | ✅ (Umi → web3.js → Circle DCW co-sign w/ asset Keypair) | ✅ `@metaplex-foundation/{mpl-core,umi,umi-bundle-defaults,umi-web3js-adapters}` + pnpm patch on `@noble/hashes@2.2.0` |

**All 10 adapters now runtime-ready.** Runtime probes confirm every real SDK method called by the adapters exists.

**mpl-core dep-tree fix (this session, 2026-05-17):** `@metaplex-foundation/mpl-core@1.10.0` imports `@noble/hashes/sha3` (no `.js`) but `@noble/hashes@2.x` only exposes `./sha3.js` in its `exports` map. Used `pnpm patch @noble/hashes@2.2.0` to inject extensionless aliases for the 16 missing `./<name>` → `./<name>.js` subpath entries. Patch committed at `patches/@noble__hashes@2.2.0.patch`, referenced from root `package.json`'s `pnpm.patchedDependencies`. Applies automatically on every `pnpm install`.

**Umi ↔ Circle DCW bridge** (`native-mpl-base.ts`): Umi expects keypair-style signing; Circle DCW is KMS sign-after-build. Pattern that works:

1. Make a Umi context with `noopSigner` as the identity (skips Umi's signing path).
2. Use `generateSigner(umi)` for new assets/collections — gives a fresh keypair whose Umi signer wraps it.
3. Build the TransactionBuilder via `create()` / `transfer()` / `createCollection()`.
4. Call `.getInstructions()`, map each via `toWeb3JsInstruction`.
5. Forward to `executeSolanaTransaction` with `additionalSigners: [Keypair.fromSecretKey(...)]` for the asset/collection keypair — Circle DCW signs as fee payer, the asset keypair co-signs as the account-creation authority.

Typecheck clean under `apps/server/tsconfig.json` (verified post-rewrite).

---

## 1. Goal

Wire 5 Solana-native protocols into LOAR's server so chain-aware features (governance, vesting, swaps, secondary marketplace, NFT layer) work without reimplementing primitives that have battle-tested equivalents. Each integration ships as a single `apps/server/src/lib/native-*.ts` adapter that mirrors the same shape as the existing port SDKs (`isXConfigured()`, typed write paths, typed read helpers).

### Non-goals

- Forking or re-implementing any of these protocols on Solana.
- Custom on-chain wrappers — these protocols compose via CPI from any caller.
- Mainnet wiring; all v1 work targets devnet alongside the rest of the parity stack.

---

## 2. The 5 integrations

| #   | Protocol                    | LOAR use case                                                    | Replaces EVM                               |
| --- | --------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| 1   | **Realms / SPL Governance** | Per-universe DAOs (vote on canon, treasury, parameter changes)   | UniverseGovernor.sol                       |
| 2   | **Streamflow**              | TokenVesting + LP locks (creator/team vesting schedules)         | TokenVesting.sol, LoarLpLockerMultiple.sol |
| 3   | **Jupiter API**             | SOL↔$LOAR + any-token routing for credit purchases, payouts      | LoarSwapRouter.sol                         |
| 4   | **Tensor / Magic Eden SDK** | Secondary cNFT marketplace (episode/character resale)            | SlopMarket.sol                             |
| 5   | **Metaplex Core**           | NFT layer (CharacterNFT, EntityNFT, IdentityNFT, StructuralDeed) | 5 NFT contracts                            |

Each gets its own adapter file. Listed here in implementation order.

---

## 3. Adapter pattern

Every adapter follows the same shape so callers don't need to learn 5 different APIs:

```ts
// apps/server/src/lib/native-realms.ts (etc.)

export function isRealmsConfigured(): boolean {
  return !!(isCircleSolanaConfigured() && process.env.REALMS_PROGRAM_ID);
}

export async function castVote(args: { ... }): Promise<{ txId; signature; state }>;
export async function readProposal(id: ...): Promise<DecodedProposal | null>;
```

Three guarantees:

1. **Config gate** (`isXConfigured()`) — false when env missing, so callers can branch
2. **Auto-resolution** of on-chain state when possible (treasury, mint, threshold) — caller passes user identity + minimum semantic args
3. **Circle DCW signing** via `executeSolanaTransaction` — same trust model as the rest of the stack

---

## 4. Integration sequencing

Recommended order (~6-10 weeks total at 1 adapter/week):

### W1-W2: Realms — `native-realms.ts`

Per-universe DAOs on Solana. Each universe's bonding-curve token becomes the governance token; the universe's creator wallet bootstraps the realm; subsequent governance changes flow through proposals.

**Surface to wrap:**

- `createRealmForUniverse(universe, governanceToken)` — admin/server-side, one-time per universe
- `castVote({ voterUserId, proposalAddress, voteWeight, direction })`
- `readProposal(proposalAddress)`
- `readVoterRecord(realm, voter)`

**Key design decisions:**

- LOAR's canon vote (`canon_market`) is **separate** from Realms — canon votes are content-decision, not treasury/governance. Don't conflate.
- Realms supports up to 4 governance config presets per realm — map to LOAR's universe tier configs.
- Voter weight = current SPL token balance via Realms' native voter-weight plugin. No custom Voter Weight Addin needed for v1.

**Dependencies:**

- `@solana/spl-governance` npm package
- Realms program ID per cluster (well-known constant, hardcode in env)
- Existing `apps/server/src/lib/anchor-ix.ts` `executeSolanaTransaction` flow

**v2 deferrals:**

- Quadratic voting / NFT voter weight (needs custom Addin)
- Cross-realm meta-DAO (LOAR-wide governance over universe-specific realms)

### W3: Streamflow — `native-streamflow.ts`

Linear/cliff vesting schedules for team tokens + bonding-curve LP locks.

**Surface to wrap:**

- `createVestingStream({ payerUserId, recipient, mint, totalAmount, cliffSecs, durationSecs })`
- `cancelStream(streamId)` — payer-only, returns remainder
- `withdrawVested({ recipientUserId, streamId })` — recipient pulls accrued
- `readStream(streamId)` — returns DecodedStream with claimable balance

**Key design decisions:**

- Streamflow handles SPL + Token-2022 natively, no per-mint dep
- LP locks: same primitive as vesting, with the LP token as the locked mint
- Fee model: Streamflow takes 0.25% on stream creation — bake into our fee accounting upstream so creators see the correct net

**Dependencies:**

- `@streamflow/stream` SDK
- Streamflow program ID per cluster

**v2 deferrals:**

- Streamflow's "splits" feature for multi-recipient distributions (overlap with our `split_router` — keep them separate, let users pick)

### W4: Jupiter — `native-jupiter.ts`

Server-side swap routing for any-token → SOL/$LOAR/USDC payouts and credit purchases.

**Surface to wrap:**

- `getQuote({ inputMint, outputMint, amount, slippageBps })` — pure HTTP, no auth
- `executeSwap({ swapperUserId, quoteResponse })` — Circle DCW signs the Jupiter-built tx
- `readJupiterRoute(quote)` — for UI receipt display

**Key design decisions:**

- Jupiter API v6 returns a fully-built versioned tx; we just relay it through Circle DCW
- Fee model: Jupiter takes 0 fee directly; market makers price slippage into the route. Set `slippageBps = 50` (0.5%) default for app flows, expose for higher-tolerance flows
- Token-2022 support is mature; no special handling needed

**Dependencies:**

- HTTP client to `quote-api.jup.ag/v6/*` + `quote-api.jup.ag/v6/swap`
- No on-chain program ID — Jupiter is fully off-chain orchestration

**v2 deferrals:**

- Limit orders + DCA (Jupiter ships these, but app UX needs design first)
- Jupiter perpetuals (out of scope for IP studio)

### W5: Tensor / Magic Eden — `native-tensor.ts` + `native-magiceden.ts`

Secondary marketplace for episode + character cNFTs. Both SDKs ship; pick one as primary + treat the other as fallback liquidity source.

**Surface to wrap:**

- `listCnft({ sellerUserId, assetId, priceLamports })` — list a Bubblegum cNFT for sale
- `buyCnft({ buyerUserId, listingId })` — settles the sale, transfers ownership
- `cancelListing(listingId)` — seller-only
- `readListing(listingId)` / `readListingsByOwner(owner)`

**Key design decisions:**

- Recommend **Tensor as primary** — better cNFT support, more LOAR-relevant volume on devnet
- Both honor Metaplex Core royalty plugins natively → enforces LOAR's creator royalty on every secondary sale automatically (vs EVM where SlopMarket had to read+enforce ERC2981 manually)
- Listing fee: Tensor 1.5%, ME 2% — surface in UI

**Dependencies:**

- `@tensor-foundation/marketplace` SDK
- (Optional) `@magic-eden/sdk` for fallback liquidity

**v2 deferrals:**

- Collection offers / bulk listings
- AMM-style cNFT liquidity (Tensor Mint Anywhere) — needs separate pricing model

### W6-W9: Metaplex Core × 4 NFT types

Four sub-adapters since each NFT type has its own metadata schema and royalty model. All four are thin wrappers around `mpl-core` SDK with LOAR-specific metadata.

**Wrap one per week:**

#### W6: Character NFT — `native-mpl-character.ts`

Mirror of `CharacterNFT.sol`. Each character is an Asset under a universe Collection, with Royalty + Attributes plugins.

- `mintCharacter({ creatorUserId, universe, name, imageUri, traits[] })` → Asset address
- `transferCharacter({ ownerUserId, asset, newOwner })`
- `readCharacter(asset)` → DecodedCharacter (name, traits, owner, universe)

#### W7: Entity NFT — `native-mpl-entity.ts`

Mirror of `EntityNFT.sol`. Generic entities (places, things, factions, etc — the worldbuilding-studio types). Same shape as Character but the Attributes plugin carries `entity_kind` (person/place/thing/...).

- `mintEntity({ creatorUserId, universe, kind, name, metadata })`
- `readEntity(asset)`

#### W8: Identity NFT — `native-mpl-identity.ts`

Mirror of `IdentityNFT.sol`. Soulbound creator profile NFT — uses Metaplex Core's `FreezeDelegate` plugin to make it non-transferable.

- `mintIdentity({ creatorUserId, profileUri, displayName })` — one per user, idempotent via PDA-style derivation
- `updateIdentity({ ownerUserId, asset, profileUri })`

#### W9: Structural Deed — `native-mpl-structural.ts`

Mirror of `StructuralDeed.sol`. Hierarchy-of-content NFT (timeline/reality/dimension/plane/realm/domain per `project_ontology.md`). Uses Attributes + Edition plugins.

- `mintStructural({ creatorUserId, universe, structuralKind, parentAsset, name })`
- `readStructural(asset)` + lineage walker

**Cross-NFT decisions:**

- All 4 use **Metaplex Core** (not Bubblegum cNFTs) — we want Asset-level royalty enforcement and Attribute plugins
- Bubblegum cNFTs are still used for **episode mints only** (high-volume, royalty optional)
- Royalty plugin: 5% default to original creator, configurable per universe (mirrors `RemixFees` ratios for consistency)
- All 4 share `apps/server/src/lib/native-mpl-base.ts` for collection management + creator setup

---

## 5. Implementation effort

| Adapter                          | LOC est.  | Lead time | Critical-path?                       |
| -------------------------------- | --------- | --------- | ------------------------------------ |
| native-realms                    | ~400      | 1.5w      | Yes (governance is missing-piece)    |
| native-streamflow                | ~250      | 1w        | No (vesting can wait)                |
| native-jupiter                   | ~200      | 0.5w      | Yes (credit purchases need it)       |
| native-tensor + native-magiceden | ~500 each | 1.5w      | No (secondary market is v2 launch)   |
| native-mpl-\* (× 4)              | ~300 each | 1w each   | Yes (Character + Entity are core IP) |

**Total estimate**: 6-10 weeks at 1 adapter/week. Realms + Jupiter + native-mpl-character are the load-bearing ones for shipping a functional universe lifecycle on Solana.

---

## 6. Shared infrastructure

Three additions land alongside the first adapter:

### 6a. `apps/server/src/lib/native-base.ts`

Common helpers:

- `resolveUserSolanaWallet(userId)` — same pattern as the port SDKs already use (`getUserSolanaWallet` → `{ walletId, address }`)
- `sendNativeTx({ userId, instructions, computeUnitLimit })` — thin wrapper around `executeSolanaTransaction` so callers don't repeat boilerplate
- Common error types

### 6b. `apps/server/src/lib/native-registry.ts`

Single source of truth for native-protocol program IDs per cluster (Realms, Streamflow, Tensor, ME, Jupiter is API-only). Same shape as `apps/solana-indexer/src/program-registry.ts` — env override → well-known default.

### 6c. Indexer registration for relevant events

Realms emits proposal events, Metaplex Core emits AssetCreated, Tensor emits Listed/Sold — register each program ID in the indexer's `program-registry.ts` (alongside the existing 14 LOAR programs) so the standard Helius webhook flow surfaces these into Firestore. No new indexer code, just registry entries.

---

## 7. Audit & security posture

**Native protocols are NOT in scope for our audit budget.** Realms, Streamflow, Tensor, Jupiter, and Metaplex Core all have their own audit history (multiple firms each, deployed at scale). Our adapters just compose them.

The risk surface our adapters introduce:

- Account-resolution bugs (passing the wrong PDA / wrong mint) — same surface as the port SDKs, mitigated by auto-resolution from on-chain state
- Slippage handling (Jupiter routes can quote stale) — set `slippageBps` defensively, expose to caller
- Royalty-enforcement assumption (Tensor + Metaplex Core enforce — fine on those, but raw token transfers don't) — surface clearly in UI

---

## 8. Success criteria

This PRD is complete when:

1. All 5 adapters live in `apps/server/src/lib/native-*.ts`, each ≤500 LOC, typechecks clean
2. Each adapter has 3-5 representative `apps/server/src/__tests__/native-*.test.ts` cases (unit-level, no on-chain validator)
3. Native protocol program IDs registered in `apps/solana-indexer/src/program-registry.ts` so their events index into Firestore
4. `.env.example` documents all required env vars
5. Each adapter has an end-to-end happy-path script in `apps/server/scripts/` that runs against devnet (manual verification, not CI — the validator-bound suite is too heavy)

---

## 9. Out of scope (this PRD)

- Off-chain components beyond the adapters (UI for governance, vesting dashboards — those land separately once the adapters exist)
- Audit engagement for our adapters specifically (covered under the existing Solana-side audit pass in the parity PRD)
- Cross-chain governance (Realms is Solana-only; EVM has UniverseGovernor; users vote separately per chain)
- Migrating existing on-chain LOAR programs to use these natives (only new flows use them; ports stay as-is)
