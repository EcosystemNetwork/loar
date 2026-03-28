# PRD: LOAR Mobile — Workstream 2: Portfolio, Wallet & Assets

**Product:** LOAR Mobile — Portfolio, Wallet & Assets
**Workstream:** 2 of 3
**Status:** Draft
**Date:** 2026-03-28
**Platform:** React Native (Expo) — shared tRPC/Firestore backend

---

## Goal

Give every LOAR creator and collector a single place on mobile to understand and manage their economic position: wallet balance, $LOAR credits, owned NFTs, royalty income, treasury stake, and quest rewards — all in one screen hierarchy that loads fast, works offline for read-only state, and surfaces actionable moments (low credits, royalty arrived, collab payout pending) via push notification.

---

## Problem

The LOAR web app handles portfolio state across at least six disconnected surfaces: a credits panel, a separate NFT gallery, a licensing tab, a treasury view nested inside universe settings, a quest page, and an analytics export. A creator on mobile cannot get a coherent answer to "how much have I made this month?" or "what do I own?" without navigating four different sections. Collectors have it worse: they land on a feed but have no clear path to the assets they actually hold.

The underlying data already exists across `credits.*`, `nft.*`, `licensing.*`, `universeTreasury.*`, `quests.*`, and `generation.*` — it is simply never aggregated. This workstream builds that aggregation layer and exposes it through a purpose-built mobile UI.

---

## Vision

Open Portfolio. See your net position in five seconds. A balance card at the top — wallet address, $LOAR credit balance, estimated fiat value of holdings. Scroll down through three tabs: Assets (NFTs you own), Earnings (royalties, payouts, treasury allocations), and Activity (every credit spend and earn event in chronological order). Tap any item and get the full record. Tap the wallet card and manage your linked wallet or top up credits.

Creators who ship universes should feel like they are running a small studio with a P&L. Collectors should feel like they have a gallery with provenance. Both should get a push when money moves.

---

## Users

| Persona | Primary need |
|---|---|
| **Solo creator** | See royalty income and credit burn in one view; know when to recharge |
| **Universe team member** | Check treasury balance and pending allocations without asking the owner |
| **Collector** | Browse owned episode and character NFTs with mint provenance and floor context |
| **Affiliate/quester** | Track quest progress and unclaimed rewards without opening the web app |

---

## Success Metrics

| Metric | Target at 60 days post-launch |
|---|---|
| Portfolio screen D1 retention | ≥ 55% of users who open the app return to Portfolio the next day |
| Time-to-balance | < 3 s from cold launch to credit balance visible on screen |
| Push opt-in rate | ≥ 65% of users who complete wallet link accept push notifications |
| Earnings surface rate | ≥ 40% of creators with royalty history view the Earnings tab within first week |
| Credit top-up conversion | ≥ 12% of users who see a low-credit nudge tap through to purchase |
| Crash-free sessions | ≥ 99.2% |

---

## Scope

### In scope

- Portfolio home screen with balance card + asset summary
- Assets tab: full owned-NFT list (characters + episodes) with detail views
- Earnings tab: royalty history, treasury allocation history, collab payout history, affiliate reward history
- Activity tab: unified credit ledger (spend + earn events) with filters
- Wallet management sheet: linked wallet address, disconnect/reconnect, WalletConnect/Reown integration for native mobile wallet linking
- Credit purchase flow: package selection → fiat (Stripe) or $LOAR payment → confirmation
- Quest tracker: progress rings, claim button, daily check-in
- Push notification infrastructure: credit low, royalty received, quest complete, collab status change, treasury allocation
- Offline read mode: last-fetched portfolio state shown from local cache when network is unavailable
- New backend: `portfolio.getSummary` aggregation endpoint, `licensing.getRoyaltyHistory` read endpoint, `notifications.register` / `notifications.getPreferences` / `notifications.updatePreferences` endpoints

### Out of scope

- Minting new NFTs from mobile (Workstream 3)
- Universe creation or management (Workstream 3)
- Content feed and discovery (Workstream 1)
- On-chain transactions beyond wallet link and credit purchase
- Secondary marketplace trading
- Fiat off-ramp / withdrawal
- Desktop-parity analytics export (CSV download deferred to web)

---

## Core UX

### Navigation entry point

Portfolio lives on the bottom tab bar at position 3 (between Feed and Create). The tab icon is a wallet glyph. The badge count on the tab shows unclaimed quest rewards + unread earnings events until the user opens the tab.

### Portfolio home

The screen has three zones stacked vertically:

**Zone 1 — Balance card (sticky header, ~180pt tall)**

Full-width card with frosted-glass treatment over a gradient derived from the user's primary universe color (or a default purple/black). Shows:
- Truncated wallet address with copy affordance and an external-link to Sepolia Etherscan
- $LOAR credit balance (large numeral) with a "Top Up" ghost button
- "Est. value" line in USD — sum of credit balance converted at current $LOAR price + floor-price estimate of held NFTs if available
- A thin progress bar beneath the balance showing credits remaining before next generation run goes over budget. When below 20% it turns amber; below 10% it turns red and the bar pulses.

Tapping the card opens the Wallet Management sheet.

**Zone 2 — Summary strip**

Three pill-shaped stat chips in a horizontal scroll:
- NFTs owned (total count)
- Royalties this month (USD or $LOAR, user toggles)
- Active quests (count with check-mark icon when all complete)

Each chip is tappable and jumps to the relevant tab/section.

**Zone 3 — Tabbed content**

Three tabs: Assets / Earnings / Activity. Default opens to Assets. Tab bar is sticky below Zone 2.

### Assets tab

Top sub-section: **Characters** — horizontal card carousel. Each card shows the character NFT image (from IPFS/Walrus manifest), name, universe name, and a "floor" chip if Ponder indexer has seen recent sales. "See all" navigates to a full-screen character gallery.

Bottom sub-section: **Episodes** — vertical list. Each row: episode thumbnail, title, universe name, collab tag if it was a collab episode, mint date. Tapping opens the Episode Detail sheet.

Empty state: illustration + "You don't own any NFTs yet. Explore universes to collect episodes." with a link to the Feed tab.

**Character Detail sheet (modal)**
- Full-width header image
- Name, universe, token ID, contract address
- Mint date and minting wallet
- Appearance history (list of episodes this character appeared in, sourced from `nft.recordAppearance` history)
- "View on Etherscan" link

**Episode Detail sheet (modal)**
- Thumbnail or video preview (if cached from Workstream 1 player)
- Title, universe, collab tag
- Token ID, contract address, mint date
- Owner (always the current user in this context)
- "View on Etherscan" and "View in Feed" links

### Earnings tab

Earnings is a chronological timeline view with section headers by month. Each event is one of four types, visually distinguished by a left-border accent color:

| Type | Color | Source endpoint |
|---|---|---|
| Royalty received | Green | `licensing.getRoyaltyHistory` (new) |
| Treasury allocation | Teal | `universeTreasury.getPoolHistory` |
| Collab payout | Blue | `collabs.getEpisodes` payout fields |
| Affiliate reward | Purple | `quests.affiliateLeaderboard` + new `quests.getRewardHistory` |

Each row: icon, description, amount in $LOAR, fiat equivalent, date, status chip (Pending / Confirmed / Claimed).

At the top of the tab, a 30-day earnings summary card shows: total earned this month, breakdown by type as a mini horizontal bar chart, and a "vs last month" delta chip.

Empty state: "No earnings yet. Publish content and set licensing terms to start earning." with a link to the Create tab.

### Activity tab

Full credit ledger. Every `credits.getHistory` record displayed chronologically. Events: generation spend, credit purchase, quest reward, grant, refund.

Filter bar (horizontal chips, multi-select): All / Spend / Earn / Quests / Purchases

Each row: operation icon, description, amount (red for spend, green for earn), running balance on the right.

A "Load more" button at the bottom (explicit pagination to keep memory flat on low-end devices).

Export nudge: "Need the full export? Open loartech.xyz/portfolio" — defers CSV export to web.

### Wallet Management sheet

Bottom sheet, draggable. Three sections:

**Connected wallet**
- Address, network badge ("Sepolia"), disconnect button with confirmation dialog
- "Copy address" and "View on Etherscan" affordances

**Link another wallet**
- "Connect via WalletConnect" button — opens Reown AppKit modal
- This links a second wallet for receiving royalties; it does not replace the auth wallet

**Session**
- "Sign out" button — clears JWT + local cache

### Credit purchase flow

Triggered from the "Top Up" button or the low-credit nudge notification.

1. **Package selection screen** — calls `credits.getPackages`. Displays package cards: credit amount, price in USD, price in $LOAR, "Best value" badge on recommended tier. Two payment method tabs: Fiat and $LOAR.
2. **Payment confirmation sheet**
   - Fiat path: calls `credits.purchaseWithFiat` → Stripe payment sheet
   - $LOAR path: calls `credits.purchaseWithLoar` → confirmation dialog showing token amount + gas estimate
3. **Success screen** — animated balance increment, "Credits added" confirmation, "Back to Portfolio" CTA.

### Quest tracker

Full-screen sheet with:
- Daily check-in card at top — current streak, check-in button (calls `quests.dailyCheckin`), shows disabled/checked state if already done today
- Quest list from `quests.list` — each quest has a progress ring and a "Claim" button that calls `quests.claimReward` when `completed && !claimed`
- Affiliate section at bottom: affiliate code display + copy button, referral count, leaderboard rank

### Push notifications

Users are prompted to enable push after completing wallet link (not at first launch).

Notification types and tap-through destinations:

| Notification | Destination |
|---|---|
| "Your credit balance is low (X remaining)" | Credit purchase flow |
| "Royalty received: +X $LOAR from [universe]" | Earnings tab, scrolled to event |
| "Quest complete: [quest name]. Claim your reward." | Quest tracker |
| "Collab status changed: [collab] is now Active" | Collab detail |
| "Treasury allocation: +X $LOAR from [universe] pool" | Earnings tab |

---

## Functional Requirements

### Portfolio home

- FR-P-01: Balance card MUST display credit balance within 3 seconds of screen mount, using cached value while fresh data loads (stale-while-revalidate).
- FR-P-02: Credit balance progress bar MUST recompute whenever `generation.estimateCost` baseline changes (user's last job cost stored locally).
- FR-P-03: "Est. value" field MUST be clearly labeled as an estimate and MUST gracefully degrade to "N/A" if price feed is unavailable; it MUST NOT block the balance card render.
- FR-P-04: The three summary chips MUST be individually tappable and navigate to their respective destinations.
- FR-P-05: The balance card MUST NOT expose any private key material; it is read-only display of address and balance.

### Assets tab

- FR-A-01: `nft.getMyNFTs` MUST be called on tab mount with the authenticated user's wallet address.
- FR-A-02: Character NFTs and episode NFTs MUST be displayed in separate sub-sections.
- FR-A-03: NFT images MUST load from the storage manifest (Walrus/IPFS URL) with a shimmer placeholder and a fallback to a generated placeholder on load failure.
- FR-A-04: Tapping any NFT MUST open a detail sheet without navigating away from the Assets tab.
- FR-A-05: Character detail MUST surface appearance history from `nft.recordAppearance` records associated with that token.

### Earnings tab

- FR-E-01: All four earnings event types MUST be fetched and merged into a single sorted timeline on the client.
- FR-E-02: The 30-day summary card MUST compute totals from the merged timeline; it MUST NOT require a separate aggregation endpoint.
- FR-E-03: Amounts MUST be displayed in $LOAR by default, with an opt-in toggle to show fiat equivalent using the same price feed as the balance card.
- FR-E-04: "Pending" status events MUST display a tooltip explaining what "pending" means for that event type.
- FR-E-05: `licensing.getRoyaltyHistory` is a new endpoint. The screen MUST degrade gracefully — showing all other earnings types — if this endpoint returns an error.

### Activity tab

- FR-AC-01: `credits.getHistory` MUST be paginated; the initial fetch MUST request the most recent 50 records.
- FR-AC-02: Filters MUST be applied client-side on the already-fetched page to avoid extra round-trips for simple use cases.
- FR-AC-03: When the user reaches the bottom of the list, a "Load more" button MUST trigger the next page fetch.
- FR-AC-04: Running balance column MUST be computed from the returned ledger data; it MUST NOT be a separate API call.

### Wallet management

- FR-W-01: The disconnect action MUST call SIWE sign-out and clear the local JWT and all cached portfolio data before navigating to the auth screen.
- FR-W-02: WalletConnect/Reown integration MUST use Reown AppKit React Native SDK. It MUST NOT attempt to use the web CDP Embedded Wallet SDK on native.
- FR-W-03: The linked secondary wallet address MUST be persisted in Firestore via `profiles.upsert` so the server can route royalties correctly.
- FR-W-04: Network badge MUST reflect the actual connected chain (Sepolia in all pre-mainnet builds) and MUST turn red if the wallet is on the wrong network.

### Credit purchase

- FR-C-01: Package list MUST call `credits.getPackages` on screen mount and MUST NOT hard-code package amounts or prices.
- FR-C-02: Fiat purchase MUST use the Stripe Expo SDK payment sheet. The client calls `credits.purchaseWithFiat` to create a PaymentIntent and receives a `clientSecret`; the Stripe sheet handles card entry natively.
- FR-C-03: $LOAR purchase confirmation MUST display token amount and a gas estimate before the user confirms. If the user's wallet has insufficient $LOAR, the button MUST be disabled with a tooltip.
- FR-C-04: After a successful purchase, `credits.getBalance` MUST be re-fetched and the balance card MUST update within 2 seconds.
- FR-C-05: Purchase errors (network failure, Stripe decline, insufficient tokens) MUST surface a human-readable error message with a retry affordance.

### Quest tracker

- FR-Q-01: `quests.list` MUST be called on sheet open; completion state MUST be shown from the returned progress data.
- FR-Q-02: `quests.dailyCheckin` MUST be guarded by `quests.getCheckinStatus` — if already checked in today, the button is replaced with a "Done for today" state.
- FR-Q-03: `quests.claimReward` MUST optimistically update the quest row to "Claimed" and revert on error.
- FR-Q-04: Affiliate code MUST be copyable with a single tap; a toast "Copied to clipboard" MUST confirm the action.

### Push notifications

- FR-N-01: Push token registration MUST call the new `notifications.register` endpoint with the Expo push token after the user grants permission.
- FR-N-02: Notification preferences MUST be fetched via `notifications.getPreferences` and editable via `notifications.updatePreferences` from a settings sub-screen.
- FR-N-03: Tapping a notification while the app is backgrounded MUST deep-link to the correct in-app destination.
- FR-N-04: The server MUST send low-credit notifications when balance drops below a configurable threshold (default: 100 credits). The threshold check runs as a side-effect of `credits.spend`.
- FR-N-05: Royalty notifications MUST be sent server-side when `licensing.recordRoyalty` is called.

### Offline / cache

- FR-O-01: The last successful portfolio state MUST be stored in AsyncStorage and rendered immediately on next launch before network data arrives.
- FR-O-02: When the device is offline, an unobtrusive banner MUST appear: "Offline — showing cached data." Action buttons that require network MUST be disabled with tooltip.
- FR-O-03: Cache MUST be invalidated and cleared on sign-out.

---

## Technical Approach

### Client stack

```
apps/mobile/
  src/
    screens/portfolio/
    screens/assets/
    screens/earnings/
    screens/activity/
    screens/wallet/
    screens/credits/
    screens/quests/
    components/portfolio/
    hooks/
    lib/
      trpc.ts
      wallet.ts
      notifications.ts
      cache.ts
      price-feed.ts
```

**State management:** TanStack Query v5. `staleTime: 60_000`, `gcTime: 300_000`. On app foreground (`AppState` change), refetch active queries.

**tRPC client:** `@trpc/react-query` with a custom `fetch` adapter. Auth header injection via Bearer JWT from Expo SecureStore.

**Wallet:** Reown AppKit React Native (`@reown/appkit-react-native`). CDP Embedded Wallet is NOT used on native. SIWE auth session established on first launch; JWT stored in SecureStore.

**Navigation:** Expo Router (file-based). Bottom tabs defined in `app/(tabs)/_layout.tsx`. Portfolio tab at `app/(tabs)/portfolio/`.

**Push notifications:** Expo Notifications SDK. On permission grant, `Notifications.getExpoPushTokenAsync()` is called and the token is sent to `notifications.register`.

**Stripe:** `@stripe/stripe-react-native` payment sheet. Client never handles raw card data.

**Price feed:** Polling hook fetches `$LOAR/USD` from a configurable public endpoint every 5 minutes. Used only for display.

### Backend reuse (no changes required)

- `credits.getBalance`, `credits.getHistory`, `credits.getPackages`, `credits.purchaseWithFiat`, `credits.purchaseWithLoar`
- `nft.getMyNFTs`, `nft.getCharactersByUniverse`, `nft.getEpisodesByUniverse`, `nft.getEpisode`
- `subscriptions.mySubscriptions`, `subscriptions.getTiers`
- `universeTreasury.getPoolBalance`, `universeTreasury.getPoolHistory`
- `universeTeam.getMyUniverses`
- `collabs.myCollabs`, `collabs.getEpisodes`
- `quests.list`, `quests.trackProgress`, `quests.claimReward`, `quests.dailyCheckin`, `quests.getCheckinStatus`, `quests.getAffiliateCode`, `quests.affiliateLeaderboard`
- `profiles.me`, `profiles.upsert`
- `generation.estimateCost`

### New backend work

**1. `portfolio.getSummary`**

New tRPC router at `apps/server/src/routers/portfolio/portfolio.routes.ts`. Aggregates in parallel: credits balance, NFT count, 30-day royalty total, active quest count. Returns a single object. Cached 30 seconds per user.

```typescript
type PortfolioSummary = {
  credits: number;
  nftCount: number;
  royalties30d: { loar: number; usd: number | null };
  activeQuestCount: number;
  walletAddress: string;
};
```

**2. `licensing.getRoyaltyHistory`**

New procedure in `apps/server/src/routers/licensing/licensing.routes.ts`. Reads royalty records filtered by `recipientUid`. Supports limit + cursor pagination.

```typescript
type RoyaltyEvent = {
  id: string;
  universeAddress: string;
  universeName: string;
  episodeId: string;
  amount: number;
  amountUsd: number | null;
  status: 'pending' | 'confirmed';
  createdAt: string;
};
```

**3. `quests.getRewardHistory`**

New procedure in `apps/server/src/routers/quests/quests.routes.ts`. Returns all claimed quest rewards and affiliate payouts for the user.

**4. Notifications infrastructure**

New router at `apps/server/src/routers/notifications/notifications.routes.ts`:

```typescript
notifications.register({ expoPushToken: string, platform: 'ios' | 'android' })
notifications.getPreferences()
notifications.updatePreferences({ preferences: NotificationPreferences })
```

Push tokens stored in Firestore under `users/{uid}/pushTokens`. Notification dispatch service at `apps/server/src/services/push-notifications.ts` wraps Expo Push Notifications API. All sends are fire-and-forget.

### Data model changes

**Firestore additions (non-breaking):**

| Collection | New fields |
|---|---|
| `users/{uid}` | `pushTokens: string[]`, `secondaryWalletAddress: string \| null` |
| `users/{uid}/notificationPreferences` | subcollection doc with per-type booleans |
| `questRewards` | New collection: `{ uid, questId, questName, amount, claimedAt }` |

---

## Screens List

| Screen | Route | Primary endpoints |
|---|---|---|
| Portfolio Home | `/(tabs)/portfolio/index` | `portfolio.getSummary` |
| Assets — Characters | `/(tabs)/portfolio/assets/characters` | `nft.getMyNFTs` |
| Assets — Episodes | `/(tabs)/portfolio/assets/episodes` | `nft.getMyNFTs` |
| Character Detail | `/(tabs)/portfolio/assets/character/[tokenId]` | `nft.getEpisode` |
| Episode Detail | `/(tabs)/portfolio/assets/episode/[tokenId]` | `nft.getEpisode` |
| Earnings Timeline | `/(tabs)/portfolio/earnings` | `licensing.getRoyaltyHistory`, `universeTreasury.getPoolHistory`, `collabs.getEpisodes`, `quests.getRewardHistory` |
| Activity Ledger | `/(tabs)/portfolio/activity` | `credits.getHistory` |
| Wallet Management | `/(tabs)/portfolio/wallet` (sheet) | `profiles.me`, `profiles.upsert` |
| Credit Packages | `/(tabs)/portfolio/credits/packages` | `credits.getPackages` |
| Credit Purchase — Fiat | `/(tabs)/portfolio/credits/fiat` | `credits.purchaseWithFiat` |
| Credit Purchase — $LOAR | `/(tabs)/portfolio/credits/loar` | `credits.purchaseWithLoar` |
| Credit Purchase — Success | `/(tabs)/portfolio/credits/success` | `credits.getBalance` (re-fetch) |
| Quest Tracker | `/(tabs)/portfolio/quests` | `quests.list`, `quests.dailyCheckin`, `quests.claimReward` |
| Notification Settings | `/(tabs)/portfolio/settings/notifications` | `notifications.getPreferences`, `notifications.updatePreferences` |

---

## Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `apps/server` tRPC router | Exists | New procedures added non-breaking |
| `packages/abis` | Exists | NFT token IDs resolved through Ponder indexer |
| `apps/indexer` (Ponder) | Exists | Floor price data via GraphQL |
| Reown AppKit React Native | External | `@reown/appkit-react-native` |
| Expo Notifications | External | Requires APNs cert (iOS) + FCM key (Android) in EAS secrets |
| Expo SecureStore | External | Replaces `localStorage` on native |
| `@stripe/stripe-react-native` | External | Publishable key from `.env` |
| Expo Router | External | SDK 52+ |
| TanStack Query v5 | External | Same as web |
| EAS Build + EAS Submit | External | New `eas.json` in `apps/mobile/` |

---

## Milestones

### M1 — Foundation (Weeks 1–2)
- Expo project scaffolded with Expo Router, TanStack Query, tRPC client
- Auth flow: SIWE JWT stored in SecureStore; session restore on cold launch
- Portfolio Home renders with live balance and NFT count
- Balance card, summary strip, Assets tab with character + episode lists
- `portfolio.getSummary` backend endpoint live

**Acceptance:** Logged-in user sees credit balance and NFT count within 3 seconds on a real device.

### M2 — Earnings + Activity (Weeks 3–4)
- `licensing.getRoyaltyHistory` backend procedure live
- `quests.getRewardHistory` backend procedure live
- Earnings tab: all four event types merged and rendered
- Activity tab: paginated credit ledger with filters
- Quest Tracker sheet: list, progress rings, claim, daily check-in, affiliate code

**Acceptance:** A creator with existing royalty and credit history can see all events correctly categorized.

### M3 — Wallet + Credits (Weeks 5–6)
- Wallet Management sheet with display, copy, Etherscan link
- Reown AppKit integration: WalletConnect flow for secondary wallet link
- Credit purchase flow: Stripe fiat path end-to-end
- $LOAR purchase flow (confirmation dialog)
- NFT detail sheets with appearance history

**Acceptance:** A user can top up credits with a test Stripe card and see the balance increment within 2 seconds.

### M4 — Push + Polish (Weeks 7–8)
- Notifications infrastructure: `notifications.register`, `getPreferences`, `updatePreferences` live
- Push opt-in prompt after wallet link
- All five notification types wired and verified on physical device
- Offline mode: AsyncStorage cache + offline banner + disabled action states
- Price feed integration: est. value on balance card, $LOAR ↔ fiat toggle

**Acceptance:** End-to-end: spend credits below threshold → receive push → tap → land on credit purchase flow.

### M5 — Launch readiness (Weeks 9–10)
- EAS Build config; TestFlight + Play Store internal track distribution
- Sentry Expo crash reporting integrated
- Analytics events for key funnel steps
- Final QA pass: all 14 screens on iOS 16+ and Android 13+
- `apps/mobile/` added to Turbo pipeline

**Acceptance:** Zero P0/P1 bugs; 99.2%+ crash-free session rate in internal beta.

---

## Definition of Done

A feature in this workstream is done when:

1. All functional requirements for the feature are met and verified on a real device (not just simulator).
2. No `any` types in the feature's files; tRPC procedures are fully typed end-to-end.
3. Every screen that calls a network endpoint has a non-empty error state with a retry affordance.
4. Every data-dependent screen has a shimmer/skeleton placeholder that renders before data arrives.
5. Screens read from cache when offline and do not crash or show empty state incorrectly.
6. At minimum one integration test per new backend procedure asserting correct Firestore reads and response shape.
7. Existing web endpoints called from new procedures pass their existing test suites without modification.
8. Every modified server procedure has been run through `gitnexus_impact` before editing; no HIGH/CRITICAL warnings left unaddressed.
9. Push notifications verified on physical iOS and Android.
10. Tappable elements have `accessibilityLabel` set; text contrast meets WCAG AA on both light and dark backgrounds.
