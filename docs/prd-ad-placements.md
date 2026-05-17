# PRD: Programmatic Ad Placements

> Status: Phase 1 restored (2026-05-16) — AdPlacement contract + routers + indexer + UI back on main; full-featured buildout in progress
> Priority: Revenue lane — required for the "universes monetize via brand sponsorships" thesis
> Owners: protocol (AdPlacement.sol), indexer (AdPlacement watcher), server (ads + adSeeds routers), web (/adplacements/\*)

---

## Problem

LOAR's monetization story has six revenue streams (subscriptions, canon licensing, NFT primary sales, NFT secondary royalties, $LOAR fees, ads). Five of the six are wired. Ads were the only one with a working programmatic-bid mechanism, and it was the only one removed on April 22, 2026 — leaving "ads" as a hand-wavey bullet on the GTM PRD with no backing system.

Brands and AI seed sponsors (the "Seed Dance" partner program) want to place creative inside universe episodes — billboards in scene backgrounds, product placements, sponsored character cameos, audio-mention spots. Today there is no auction, no escrow, no fee-routing, and no metric tracking. Restoring the system fixes the auction; **this PRD covers the integrations that take it from "auction works" to "brands will trust the platform with budgets."**

---

## Goal

Make a brand or AI seed sponsor able to:

1. **Discover** open ad slots across active universes via `/adplacements` (browse) and `/shop/$universeId` (universe-scoped).
2. **Bid** in $LOAR or ETH with escrowed funds via Circle DCW (server-signed) — no MetaMask popup, no wei-math by the brand.
3. **Win** the slot via either highest-bid auction (default) or owner-curated acceptance (universes can opt in to manual review).
4. **Deliver creative** — an upload pipeline that gates the creative against moderation rules (no infringing, no misclassified, no banned-category content).
5. **See attribution** — impression count, episode coverage, $LOAR spent per impression — in a brand-side dashboard.

Universes earn passive ad revenue, brands get high-quality AI-content placement, and platform takes 5% of bids and 0% of acceptances (current contract fees).

---

## Non-Goals

- Real-time-bidding (RTB) wire-up (a real-time auction protocol is post-mainnet)
- Click-through tracking (we measure impressions only; CTR requires hosted landing pages we don't run)
- Programmatic creative generation (sponsor brings their own creative; AI-generated ad creative is a separate "Ad Seeds" product)
- Cross-chain ad bidding (EVM only for v1)

---

## Current State (post-restore, 2026-05-16)

| Surface                                                     | Status                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/contracts/src/revenue/AdPlacement.sol`                | Restored, UUPS proxy. Has slot create, bid, accept, refund, impression-record, fee routing |
| `apps/server/src/routers/ads/ads.routes.ts`                 | Restored — createSlot, placeBid, acceptBid, recordImpression, getters                      |
| `apps/server/src/routers/ads/adSeeds.routes.ts`             | Restored — Ad Seeds (sponsor pre-funded creative pool), CRUD + placement workflow          |
| `apps/web/src/routes/adplacements/`                         | Restored — listing, new, $slotId, seeds/index, seeds/new, seeds/$seedId                    |
| `apps/web/src/routes/shop/$universeId.tsx`                  | "Ads" tab restored; AdSlotCard component back                                              |
| `apps/web/src/components/RevenuePanel.tsx`                  | "Ads" tab restored; AdsTabPanel function back                                              |
| `apps/event-listener/src/handlers/ad-placement.ts`          | Restored                                                                                   |
| `apps/indexer/` (ponder.config + schema + index)            | Restored — adSlot, sponsorship tables + AdPlacement event handlers                         |
| `packages/abis/src/generated.ts`                            | `adPlacementAbi` injected from feature/ads (next `wagmi generate` overwrites cleanly)      |
| Deploy + pause + multisig scripts                           | Restored — AD_PLACEMENT_ADDRESS / AD_PLACEMENT_PROXY threaded through                      |
| Firestore collections (`adSlots`, `adBids`, `sponsorships`) | Never deleted — data is intact                                                             |

---

## Phase 2 — Buildout Items

### A1. Circle DCW transaction routing (P0)

All on-chain calls (`createSlot`, `placeBid`, `acceptBid`, `recordImpression`) currently rely on direct viem write paths. Migrate to the `POST /api/tx/write` (EVM) Circle DCW signing flow:

- `useAdPlacement` hook → wrap with `useCircleWrite`
- Bid placement UI should show "Confirming…" + a server-side tx hash; no wallet pop-up.
- Add a `paymentMethod: 'LOAR' | 'ETH'` toggle on the bid form — both currencies are already supported by the contract; the UI never exposed the LOAR path.

**Files**: `apps/web/src/routes/adplacements/new.tsx`, `$slotId.tsx`. Look for `writeContract` calls.

### A2. Content moderation gates on creative upload (P0)

The current upload flow accepts arbitrary content URLs. Brand creative is high-stakes — a slot won by infringing creative damages every universe in which it appears. Add:

1. On `ads.submitCreative` (new endpoint): require `contentHash` (Pinata-pinned) + `rightsDeclaration` (creator owns or has licensed the creative).
2. Call `assertContentOperable(contentHash)` before activating sponsorship.
3. Surface a `creativeStatus: 'pending' | 'approved' | 'rejected'` field; universe owners can flag-and-pause active sponsorships via the new `ads.flagCreative` mutation.
4. Admin queue at `/admin/ads-moderation` for platform team to review flagged creative.

### A3. Brand dashboard (P1)

Brand-side view at `/brand/dashboard` (new route):

- Active sponsorships table — slot, universe, episodes remaining, $LOAR/ETH spent, impressions.
- Total budget vs spent (against any `AdSeed` with a remaining balance).
- Per-universe performance: impressions delivered, average bid won, top episode by reach.
- CSV export of all bids and impressions for accounting.

Pure data play — reuses existing indexer tables (`adSlot`, `sponsorship`) + Firestore `adBids`.

### A4. Sponsor-side budget escrow (Ad Seeds completion, P1)

The `adSeeds` router is restored but stops at the "sponsor pre-funds X $LOAR, gets matched to creators" workflow without enforcement. Add:

- On `adSeeds.create`: pull $LOAR into a dedicated `AdSeedEscrow` contract (new — small wrapper around `Escrow.sol`'s pattern).
- On `adSeeds.approvePlacement`: release portion of escrow to the universe owner.
- On `adSeeds.rejectPlacement` (or seed expiry): refund the unused balance to the sponsor.

This converts Ad Seeds from a coordination layer into an actual escrowed program.

### A5. Impression-batching for cost efficiency (P1)

`AdPlacement.recordImpression()` is per-call. For active sponsorships across many episodes this is gas-prohibitive. Add a batched variant:

- `AdPlacement.recordImpressionsBatch(slotId[], impressions[])` — admin or universe-owner only
- Server cron: every 1h, batch the previous hour's impression counts per slot and send a single tx
- Off-chain Firestore counter is the source of truth for fast UI; on-chain count converges hourly

Optional contract upgrade — current contract may already support this; verify and ship UI before reaching for an upgrade.

### A6. Solana parity (P2 — tracked separately)

Native Solana ad placements are slated for the Solana Parity PRD post-mainnet. Defer.

---

## Success Criteria

- A brand can create an account, fund an Ad Seed with $LOAR, browse open slots, bid, win, upload creative (moderated), and see impressions tick up in their dashboard — within 30 minutes of first sign-in.
- 100% of paid creative passes the moderation gate before it goes live on a universe.
- Universe owners can pause and re-bid any sponsorship that goes off-brand within 5 minutes.
- Platform ad revenue surfaces in the `/admin/revenue` dashboard with break-down per universe.
- Zero on-chain transactions exposed to brands via wallet popups (all server-signed via Circle DCW).

---

## Open Questions

1. Do we let `/adplacements` show slots from private universes? (Default: no; only public-launch universes accept ads.)
2. Should the platform take a % of the underlying Ad Seed escrow at funding time, at placement time, or at both? (Current contract: only at bid time. Defer to revenue committee.)
3. What happens to an active sponsorship if a universe goes into the moderation `hidden` or `removed` state? (Default: server-side pause + brand-side notification + auto-refund of remaining episodes after 72h.)
