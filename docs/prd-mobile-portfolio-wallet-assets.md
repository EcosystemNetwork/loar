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

| Persona                  | Primary need                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| **Solo creator**         | See royalty income and credit burn in one view; know when to recharge          |
| **Universe team member** | Check treasury balance and pending allocations without asking the owner        |
| **Collector**            | Browse owned episode and character NFTs with mint provenance and floor context |
| **Affiliate/quester**    | Track quest progress and unclaimed rewards without opening the web app         |

---

## Success Metrics

| Metric                        | Target at 60 days post-launch                                                  |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Portfolio screen D1 retention | ≥ 55% of users who open the app return to Portfolio the next day               |
| Time-to-balance               | < 3 s from cold launch to credit balance visible on screen                     |
| Push opt-in rate              | ≥ 65% of users who complete wallet link accept push notifications              |
| Earnings surface rate         | ≥ 40% of creators with royalty history view the Earnings tab within first week |
| Credit top-up conversion      | ≥ 12% of users who see a low-credit nudge tap through to purchase              |
| Crash-free sessions           | ≥ 99.2%                                                                        |

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

| Type                | Color  | Source endpoint                                               |
| ------------------- | ------ | ------------------------------------------------------------- |
| Royalty received    | Green  | `licensing.getRoyaltyHistory` (new)                           |
| Treasury allocation | Teal   | `universeTreasury.getPoolHistory`                             |
| Collab payout       | Blue   | `collabs.getEpisodes` payout fields                           |
| Affiliate reward    | Purple | `quests.affiliateLeaderboard` + new `quests.getRewardHistory` |

Each row: icon, description, amount in $LOAR, fiat equivalent, date, status chip (Pending / Confirmed / Claimed).

At the top of the tab, a 30-day earnings summary card shows: total earned this month, breakdown by type as a mini horizontal bar chart, and a "vs last month" delta chip.

Empty state: "No earnings yet. Publish content and set licensing terms to start earning." with a link to the Create tab.

### Activity tab

Full credit ledger. Every `credits.getHistory` record displayed chronologically. Events: generation spend, credit purchase, quest reward, grant, refund.

Filter bar (horizontal chips, multi-select): All / Spend / Earn / Quests / Purchases

Each row: operation icon, description, amount (red for spend, green for earn), running balance on the right.

A "Load more" button at the bottom (explicit pagination to keep memory flat on low-end devices).

Export nudge: "Need the full export? Open loar.fun/portfolio" — defers CSV export to web.

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

| Notification                                         | Destination                     |
| ---------------------------------------------------- | ------------------------------- |
| "Your credit balance is low (X remaining)"           | Credit purchase flow            |
| "Royalty received: +X $LOAR from [universe]"         | Earnings tab, scrolled to event |
| "Quest complete: [quest name]. Claim your reward."   | Quest tracker                   |
| "Collab status changed: [collab] is now Active"      | Collab detail                   |
| "Treasury allocation: +X $LOAR from [universe] pool" | Earnings tab                    |

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
notifications.register({ expoPushToken: string, platform: 'ios' | 'android' });
notifications.getPreferences();
notifications.updatePreferences({ preferences: NotificationPreferences });
```

Push tokens stored in Firestore under `users/{uid}/pushTokens`. Notification dispatch service at `apps/server/src/services/push-notifications.ts` wraps Expo Push Notifications API. All sends are fire-and-forget.

### Data model changes

**Firestore additions (non-breaking):**

| Collection                            | New fields                                                       |
| ------------------------------------- | ---------------------------------------------------------------- |
| `users/{uid}`                         | `pushTokens: string[]`, `secondaryWalletAddress: string \| null` |
| `users/{uid}/notificationPreferences` | subcollection doc with per-type booleans                         |
| `questRewards`                        | New collection: `{ uid, questId, questName, amount, claimedAt }` |

---

## Screens List

| Screen                    | Route                                          | Primary endpoints                                                                                                  |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Portfolio Home            | `/(tabs)/portfolio/index`                      | `portfolio.getSummary`                                                                                             |
| Assets — Characters       | `/(tabs)/portfolio/assets/characters`          | `nft.getMyNFTs`                                                                                                    |
| Assets — Episodes         | `/(tabs)/portfolio/assets/episodes`            | `nft.getMyNFTs`                                                                                                    |
| Character Detail          | `/(tabs)/portfolio/assets/character/[tokenId]` | `nft.getEpisode`                                                                                                   |
| Episode Detail            | `/(tabs)/portfolio/assets/episode/[tokenId]`   | `nft.getEpisode`                                                                                                   |
| Earnings Timeline         | `/(tabs)/portfolio/earnings`                   | `licensing.getRoyaltyHistory`, `universeTreasury.getPoolHistory`, `collabs.getEpisodes`, `quests.getRewardHistory` |
| Activity Ledger           | `/(tabs)/portfolio/activity`                   | `credits.getHistory`                                                                                               |
| Wallet Management         | `/(tabs)/portfolio/wallet` (sheet)             | `profiles.me`, `profiles.upsert`                                                                                   |
| Credit Packages           | `/(tabs)/portfolio/credits/packages`           | `credits.getPackages`                                                                                              |
| Credit Purchase — Fiat    | `/(tabs)/portfolio/credits/fiat`               | `credits.purchaseWithFiat`                                                                                         |
| Credit Purchase — $LOAR   | `/(tabs)/portfolio/credits/loar`               | `credits.purchaseWithLoar`                                                                                         |
| Credit Purchase — Success | `/(tabs)/portfolio/credits/success`            | `credits.getBalance` (re-fetch)                                                                                    |
| Quest Tracker             | `/(tabs)/portfolio/quests`                     | `quests.list`, `quests.dailyCheckin`, `quests.claimReward`                                                         |
| Notification Settings     | `/(tabs)/portfolio/settings/notifications`     | `notifications.getPreferences`, `notifications.updatePreferences`                                                  |

---

## Dependencies

| Dependency                    | Status   | Notes                                                       |
| ----------------------------- | -------- | ----------------------------------------------------------- |
| `apps/server` tRPC router     | Exists   | New procedures added non-breaking                           |
| `packages/abis`               | Exists   | NFT token IDs resolved through Ponder indexer               |
| `apps/indexer` (Ponder)       | Exists   | Floor price data via GraphQL                                |
| Reown AppKit React Native     | External | `@reown/appkit-react-native`                                |
| Expo Notifications            | External | Requires APNs cert (iOS) + FCM key (Android) in EAS secrets |
| Expo SecureStore              | External | Replaces `localStorage` on native                           |
| `@stripe/stripe-react-native` | External | Publishable key from `.env`                                 |
| Expo Router                   | External | SDK 52+                                                     |
| TanStack Query v5             | External | Same as web                                                 |
| EAS Build + EAS Submit        | External | New `eas.json` in `apps/mobile/`                            |

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

---

## Production Requirements

### 1. Performance Contracts

#### Hard SLAs

| Operation                                                    | Target                                | Notes                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Cold launch → Portfolio Home (cached data rendered)          | ≤ 1,200 ms                            | Balance card visible with last-cached credits value; skeleton replaced by real data                    |
| Cold launch → Balance card with LIVE data                    | ≤ 2,800 ms                            | `portfolio.getSummary` p50 response + React hydration                                                  |
| `portfolio.getSummary` p50                                   | ≤ 400 ms                              | Fan-out with parallel sub-calls, all on warm Firestore connections                                     |
| `portfolio.getSummary` p95                                   | ≤ 1,200 ms                            | Acceptable upper bound before partial-data fallback triggers                                           |
| `portfolio.getSummary` p99                                   | ≤ 2,500 ms                            | Individual slow sub-call still resolves; timeout kicks in before this                                  |
| Earnings tab mount (4 parallel fetches merged)               | ≤ 1,800 ms                            | All four sub-calls dispatched simultaneously; UI renders as each resolves                              |
| NFT image load p95 (IPFS/Walrus CDN)                         | ≤ 2,000 ms                            | Requires client-side CDN URL rewriting through a caching proxy; see strategy below                     |
| Credit purchase: "Top Up" tap → Stripe payment sheet visible | ≤ 1,500 ms                            | Includes `credits.purchaseWithFiat` round-trip + Stripe SDK initialization                             |
| Push notification delivery p50                               | ≤ 3 s from server trigger             | Expo Push API + APNs/FCM relay                                                                         |
| Push notification delivery p95                               | ≤ 15 s from server trigger            | Network and platform variance; above 60 s is a delivery failure                                        |
| Quest tracker open                                           | ≤ 800 ms                              | `quests.list` + render; data often cached                                                              |
| Balance card update after credit purchase                    | ≤ 2,000 ms from purchase confirmation | Re-fetch `credits.getBalance` after webhook confirms; client polls at 500 ms intervals, max 3 attempts |
| Offline cold launch → cached portfolio visible               | ≤ 800 ms                              | AsyncStorage read only; no network call                                                                |

#### Balance Card Credit Counter Animation

- **Trigger:** Balance card receives a fresh value higher than the currently displayed value (post-purchase or post-quest-claim).
- **Easing curve:** `Easing.out(Easing.cubic)` — fast start, gentle deceleration. Matches the physical intuition of credits "settling."
- **Duration:** 600 ms for increments up to 500 credits; scale linearly up to 1,200 ms for increments above 5,000 credits. Cap at 1,200 ms regardless of increment size.
- **Frame rate:** Target 60 fps on all supported devices. Use `useAnimatedProps` from Reanimated v3 to drive the counter on the UI thread — do not animate on the JS thread.
- **Reduced motion:** If `useReducedMotion()` returns true, skip the animation and set the displayed value to the final value in the next render frame. No intermediate values shown.

#### `portfolio.getSummary` Fan-Out Parallelism Strategy

`portfolio.getSummary` is the most critical endpoint in the workstream. It must never block the entire portfolio home on a slow sub-system. The implementation is:

```typescript
// apps/server/src/routers/portfolio/portfolio.handlers.ts

const SUBCALL_TIMEOUT_MS = 1500;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<{ data: T; timedOut: boolean }> {
  let timedOut = false;
  const result = await Promise.race([
    promise.then((data) => ({ data, timedOut: false })),
    new Promise<{ data: T; timedOut: true }>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve({ data: fallback, timedOut: true });
      }, timeoutMs)
    ),
  ]);
  return result;
}

export async function getPortfolioSummary(
  uid: string,
  walletAddress: string
): Promise<PortfolioSummaryResponse> {
  const [credits, nftCount, royalties, quests] = await Promise.all([
    withTimeout(getCreditsBalance(uid), SUBCALL_TIMEOUT_MS, null),
    withTimeout(getNFTCount(walletAddress), SUBCALL_TIMEOUT_MS, null),
    withTimeout(getRoyalties30d(uid), SUBCALL_TIMEOUT_MS, null),
    withTimeout(getActiveQuestCount(uid), SUBCALL_TIMEOUT_MS, null),
  ]);

  return {
    credits: credits.data,
    nftCount: nftCount.data,
    royalties30d: royalties.data,
    activeQuestCount: quests.data,
    walletAddress,
    partial: credits.timedOut || nftCount.timedOut || royalties.timedOut || quests.timedOut,
    timedOutFields: [
      credits.timedOut && 'credits',
      nftCount.timedOut && 'nftCount',
      royalties.timedOut && 'royalties30d',
      quests.timedOut && 'activeQuestCount',
    ].filter(Boolean) as string[],
  };
}
```

**Response shape when a sub-call times out:** The endpoint returns HTTP 200 with `partial: true` and `timedOutFields: ["royalties30d"]` (for example). The client inspects `partial` and renders a "some data unavailable" chip on affected sections. It does NOT return an error status — the client must never see a hard failure for a timeout on one sub-call. The full `PortfolioSummaryResponse` type:

```typescript
type PortfolioSummaryResponse = {
  credits: number | null; // null if sub-call timed out
  nftCount: number | null;
  royalties30d: { loar: number; usd: number | null } | null;
  activeQuestCount: number | null;
  walletAddress: string;
  partial: boolean; // true if ANY sub-call timed out
  timedOutFields: string[]; // which specific fields are missing
};
```

#### NFT Image Caching Strategy

Raw IPFS CIDs and Walrus blob IDs must never be fetched directly from the app in a hot path. The strategy:

1. The app resolves NFT image URLs through `nft.getMyNFTs` which returns pre-signed gateway URLs (Pinata gateway for IPFS, Walrus aggregator for Walrus blobs).
2. These gateway URLs are written into the NFT record in Firestore by the Ponder indexer on mint event.
3. On the client, React Native's `Image` component has a built-in disk cache. Additionally, use `expo-image` (not the built-in `Image`) which provides a LRU disk cache of configurable size (set to 100 MB).
4. `expo-image` caches images by URL. Since gateway URLs are stable (CIDs are immutable), cached images never expire — set `cachePolicy="disk"` on all NFT image components.
5. First load at p95: ≤ 2,000 ms. Subsequent loads (disk cache hit): ≤ 80 ms.

---

### 2. Security Requirements

#### JWT Expiry — Silent Re-Auth

SIWE JWTs have a configurable expiry (default: 24 hours, minimum: 1 hour). When `portfolio.getSummary` returns a 401:

1. The tRPC client intercepts the 401 in the `onError` link before it reaches the query's `error` state.
2. The client reads the JWT from SecureStore and decodes the `exp` claim (without verifying the signature — it trusts the stored value).
3. If `exp - now < 30 minutes` (i.e., the token is less than 30 minutes old or expired very recently), the client initiates a silent re-auth:
   a. The stored wallet address is retrieved from SecureStore.
   b. A new SIWE message is constructed with the current timestamp and a fresh nonce.
   c. The CDP Embedded Wallet signs the message silently (CDP supports silent signing for active sessions — no user interaction required).
   d. The new JWT is sent to the server via `auth.siweLogin` and stored back in SecureStore.
   e. The original failed request is retried with the new JWT.
4. If the token is more than 30 minutes old, the silent re-auth is NOT attempted. The user is redirected to the auth screen with a toast: "Your session expired. Please sign in again."
5. This entire flow must complete within 2 seconds to be imperceptible to the user.

The tRPC client link that implements this lives in `apps/mobile/src/lib/trpc.ts`:

```typescript
const silentReAuthLink = new TRPCLink(({ next, op }) => {
  return observable((observer) => {
    const unsubscribe = next(op).subscribe({
      next: observer.next,
      error: async (err) => {
        if (err?.data?.httpStatus === 401) {
          const jwt = await SecureStore.getItemAsync('jwt');
          if (jwt && isTokenFreshlyExpired(jwt)) {
            try {
              const newJwt = await performSilentReAuth();
              await SecureStore.setItemAsync('jwt', newJwt);
              // Retry original op
              next(op).subscribe(observer);
            } catch {
              observer.error(err); // Fall through to logout
            }
          } else {
            observer.error(err);
          }
        } else {
          observer.error(err);
        }
      },
      complete: observer.complete,
    });
    return unsubscribe;
  });
});
```

#### Expo SecureStore vs. AsyncStorage — What Lives Where

| Data                                                 | Storage location                                             | Rationale                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| JWT (SIWE session token)                             | `Expo SecureStore`                                           | Encrypted at rest using platform keychain (iOS Keychain / Android Keystore). Never in AsyncStorage.                                              |
| Wallet address (primary)                             | `Expo SecureStore`                                           | Required for silent re-auth; treated as sensitive identity anchor                                                                                |
| Expo push token                                      | `Expo SecureStore`                                           | Not a secret, but stored securely to prevent accidental exposure in logs or crash reports                                                        |
| Portfolio cache (`portfolio.getSummary` last result) | `AsyncStorage`                                               | Non-sensitive display cache; acceptable in unencrypted storage                                                                                   |
| NFT list cache                                       | `AsyncStorage`                                               | Non-sensitive                                                                                                                                    |
| TanStack Query persisted cache (non-auth)            | `AsyncStorage` via `@tanstack/query-async-storage-persister` | Standard TanStack Query offline persistence                                                                                                      |
| Private keys                                         | NEVER stored on device                                       | CDP Embedded Wallet manages key material in the CDP cloud enclave. This app NEVER has access to private keys and MUST NOT request or store them. |

#### Credit Purchase Security — Stripe Webhook Verification

The fiat purchase flow has an inherent race condition: the Stripe PaymentIntent is confirmed in the Stripe SDK on the client, but the server must not grant credits until it independently confirms payment via webhook. The full flow:

1. Client calls `credits.purchaseWithFiat({ packageId })`.
2. Server creates a Stripe PaymentIntent, stores `{ uid, packageId, paymentIntentId, status: 'pending' }` in Firestore collection `pendingPurchases/{paymentIntentId}`.
3. Server returns `{ clientSecret, paymentIntentId }` to client.
4. Client presents the Stripe payment sheet. The sheet handles card entry and 3DS natively.
5. On Stripe confirmation, the Stripe webhook `payment_intent.succeeded` fires to the server endpoint `POST /webhooks/stripe`.
6. Server verifies the webhook signature using `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`.
7. Server looks up `pendingPurchases/{paymentIntentId}`, verifies it matches the expected uid and packageId.
8. Server calls `credits.grant(uid, package.credits)` and updates `pendingPurchases/{paymentIntentId}.status` to `'completed'`.
9. Client polls `credits.getBalance` at 500 ms intervals after the Stripe sheet closes (max 6 attempts over 3 seconds).

**Race condition risk:** The client may call `credits.getBalance` before the webhook fires. Mitigation: the polling loop detects that the balance has not increased and continues polling. If balance does not increase after 6 polls (3 seconds), the client shows: "Payment confirmed — credits will appear shortly" and re-fetches after 10 seconds. The `pendingPurchases` record acts as the idempotency key — even if the webhook fires twice, the grant is only executed once (`status: 'completed'` check prevents double-grant).

**Double-purchase protection:** `pendingPurchases/{paymentIntentId}` is written atomically before returning the clientSecret. If the server crashes after creating the PaymentIntent but before responding to the client, the PaymentIntent exists in Stripe and will trigger the webhook on confirmation — the grant will still be processed correctly.

#### $LOAR Purchase — On-Chain Transaction Verification

The `credits.purchaseWithLoar` flow:

1. Client submits the on-chain transaction (ERC-20 transfer to the treasury address) via the CDP wallet.
2. Client receives the transaction hash `txHash` from the wallet SDK.
3. Client calls `credits.purchaseWithLoar({ packageId, txHash })`.
4. Server verifies the transaction on Sepolia:
   ```typescript
   const receipt = await sepoliaRpc.getTransactionReceipt({ hash: txHash });
   // Must be successful
   if (receipt.status !== 'success') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Transaction failed' });
   // Must have at least 2 confirmations
   const currentBlock = await sepoliaRpc.getBlockNumber();
   if (currentBlock - receipt.blockNumber < 2) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Awaiting confirmations' });
   // Must be a transfer to the correct treasury address
   const log = receipt.logs.find(l => l.address === LOAR_TOKEN_ADDRESS);
   // Decode the Transfer event and verify: from = user wallet, to = TREASURY_ADDRESS, value = expected amount
   const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
   if (decoded.args.to.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) throw ...;
   if (decoded.args.from.toLowerCase() !== ctx.user.address.toLowerCase()) throw ...;
   if (decoded.args.value < expectedMinimumValue) throw ...;
   ```
5. The `txHash` is stored in a `processedTransactions` Firestore collection to prevent replay attacks. If the same `txHash` is submitted twice, the second call returns an idempotency error.
6. Credits are granted only after all verifications pass.

#### Push Token Security

Push tokens stored in Firestore under `users/{uid}/pushTokens: string[]`. Security constraints:

- Push tokens are NEVER returned by any tRPC endpoint. No procedure in `notifications.*` exposes stored push tokens to any client.
- The `push-notifications.ts` service is the only code path that reads push tokens from Firestore and calls the Expo Push API. This service is only callable from server-side code — it is not exposed as a tRPC procedure.
- A compromised Firestore read credential could allow reading push tokens. Mitigation: Firestore security rules restrict `users/{uid}/pushTokens` reads to the server (Firebase Admin SDK only) — not to any authenticated client, not even the owning user.
- Push tokens are not secrets (they do not authenticate the device), but limiting their exposure limits the blast radius of a credential compromise.

#### Secondary Wallet Link — Challenge-Response Signature Flow

Linking a secondary wallet via WalletConnect requires a cryptographic proof that the user controls the new wallet address — an address paste alone is insufficient.

1. Client calls `profiles.generateWalletLinkNonce()`.
2. Server generates a cryptographically random 32-byte nonce, stores it in Firestore as `walletLinkNonces/{uid}` with a 5-minute TTL.
3. Server returns the nonce as a hex string.
4. Client constructs a SIWE-style message: `"LOAR: Link wallet to account {uid}\nNonce: {nonce}\nIssued: {iso8601}"`
5. Client uses Reown AppKit to request a personal_sign from the newly connected wallet.
6. Client calls `profiles.upsert({ secondaryWalletAddress: address, linkNonce: nonce, linkSignature: signature })`.
7. Server:
   a. Looks up `walletLinkNonces/{uid}` — verifies the nonce matches and has not expired.
   b. Reconstructs the expected message.
   c. Calls `verifyMessage({ message, signature, address })` (viem) — if the recovered address does not match the submitted `secondaryWalletAddress`, throw `UNAUTHORIZED`.
   d. Deletes the nonce from Firestore (single-use).
   e. Persists `secondaryWalletAddress` to `users/{uid}`.

#### NFT Ownership Integrity

The NFT list in the portfolio is populated from Firestore records written by the Ponder indexer on `CharacterNFT.Transfer` and `EpisodeNFT.Transfer` events. The server trusts the indexer records exclusively:

- `nft.getMyNFTs` queries Firestore for records where `ownerAddress == ctx.user.address`. The `ownerAddress` field is only written by the Ponder indexer service — it is never writable by the tRPC client.
- The tRPC router has no procedure that accepts a client-asserted NFT ownership claim. Clients cannot manipulate ownership records.
- The Ponder indexer updates ownership atomically on every Transfer event. Until the indexer processes the block (typically within 2–5 seconds of block inclusion on Sepolia), ownership records reflect pre-transfer state. This lag is acceptable and documented.

#### Rate Limiting on Purchase Endpoints

`credits.purchaseWithFiat` and `credits.purchaseWithLoar` are both rate-limited per user:

- **Burst:** 3 calls per minute per UID.
- **Sustained:** 10 calls per hour per UID.

On limit exceeded, the server returns HTTP 429 with `retryAfter` seconds. The client disables the "Buy" button and displays a countdown timer showing when the next purchase can be attempted.

Implementation: via the shared `rateLimit` utility (see Section 9).

---

### 3. Error Taxonomy and Handling Strategy

#### Complete Error Table

| Error                                                                                     | Examples                                                                                           | Client behavior                                                                                                                                                                                                                                                                                                           | User message                                                                                                                                            | Retry?                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio.getSummary` partial failure                                                    | Royalties sub-call times out after 1,500 ms                                                        | Render all available data; show an amber "some data unavailable" chip on the affected section (e.g., earnings strip chip shows "—"); `timedOutFields` array indicates which section is affected                                                                                                                           | "Some data couldn't load. Tap to refresh."                                                                                                              | Auto-retry in background at 30-second intervals, max 3 times. Manual pull-to-refresh always available.                                                                                                                                                                                                                                                                                       |
| `portfolio.getSummary` total failure                                                      | All sub-calls time out, or server returns 500                                                      | Render full cached state from AsyncStorage with an "Offline or service error" banner at top                                                                                                                                                                                                                               | "Couldn't load your portfolio. Showing saved data."                                                                                                     | Manual retry via banner CTA and pull-to-refresh. Auto-retry after 60 s.                                                                                                                                                                                                                                                                                                                      |
| Credit purchase — Stripe card declined                                                    | Stripe returns `card_declined`, `insufficient_funds`, `do_not_honor`                               | Dismiss Stripe sheet; navigate back to package selection; show inline error banner on the payment method section                                                                                                                                                                                                          | "Your card was declined. Please try a different payment method."                                                                                        | User-initiated only. Do not auto-retry. Show a "Try another card" CTA.                                                                                                                                                                                                                                                                                                                       |
| Credit purchase — Stripe 3DS failure                                                      | 3DS authentication timed out or user cancelled                                                     | Stripe sheet handles the 3DS UI; on cancellation return to package selection with inline error                                                                                                                                                                                                                            | "Payment authentication failed or was cancelled. Please try again."                                                                                     | User-initiated.                                                                                                                                                                                                                                                                                                                                                                              |
| Credit purchase — $LOAR insufficient balance                                              | `purchaseWithLoar` returns `PRECONDITION_FAILED`                                                   | Disable the $LOAR payment tab; show a tooltip on the disabled "Buy" button                                                                                                                                                                                                                                                | "You don't have enough $LOAR. Your balance: X $LOAR. Required: Y $LOAR."                                                                                | No retry — user must acquire more $LOAR. Show a "Learn how to get $LOAR" link.                                                                                                                                                                                                                                                                                                               |
| NFT image load failure                                                                    | IPFS/Walrus gateway returns 404 or times out after 8 s                                             | Replace image with a generated placeholder avatar (deterministic color + initials from NFT name); do not show a broken-image icon                                                                                                                                                                                         | No user-facing message on individual card; if more than 3 images fail, show a banner "Some NFT images are unavailable"                                  | `expo-image` auto-retries once. After second failure, show placeholder permanently for that session.                                                                                                                                                                                                                                                                                         |
| Push notification permission denied                                                       | User taps "Don't Allow" on the OS prompt                                                           | Store `pushPermissionDenied: true` in AsyncStorage; do not re-prompt for 30 days; show a subtle settings nudge in Notification Settings screen                                                                                                                                                                            | "Enable notifications in Settings to get alerts for new royalties and quest completions." (settings nudge, not a modal)                                 | No automatic re-prompt. Show deep-link to iOS/Android notification settings in the Notification Settings screen.                                                                                                                                                                                                                                                                             |
| WalletConnect pairing failure — QR timeout                                                | Reown AppKit QR scan session expires (default: 5 minutes)                                          | Close the modal; return to Wallet Management sheet with an error state on the "Connect via WalletConnect" button                                                                                                                                                                                                          | "Connection timed out. Please try again."                                                                                                               | Tap to retry generates a new QR code.                                                                                                                                                                                                                                                                                                                                                        |
| WalletConnect pairing failure — wallet app not installed                                  | Reown AppKit deep-link fails on iOS/Android                                                        | Modal shows "No compatible wallet found"; offer a "Get a wallet" link to Reown's wallet discovery page                                                                                                                                                                                                                    | "No wallet app found. Install a compatible wallet to continue."                                                                                         | N/A.                                                                                                                                                                                                                                                                                                                                                                                         |
| Transaction confirmation timeout                                                          | Sepolia block time variance; `credits.purchaseWithLoar` polled for 2+ minutes without confirmation | After 120 s of waiting, surface a "Taking longer than expected" non-blocking sheet. Do not cancel the purchase — the transaction may still confirm.                                                                                                                                                                       | "Your transaction is taking longer than expected. We'll update your balance when it confirms. You can close this screen."                               | No server-side retry. Server webhook will process the grant when the transaction eventually confirms. User can close the screen safely.                                                                                                                                                                                                                                                      |
| Quest claim race condition                                                                | Two devices submit `quests.claimReward` for the same quest simultaneously                          | Server uses a Firestore transaction to atomically check `claimed` before setting it. The second request receives `CONFLICT` (HTTP 409). The first device shows success; the second device's optimistic update is reverted, and the row shows "Already claimed."                                                           | "This reward was already claimed." (second device only)                                                                                                 | No retry.                                                                                                                                                                                                                                                                                                                                                                                    |
| JWT expired mid-purchase                                                                  | Token expires between PaymentIntent creation and Stripe sheet completion                           | The Stripe sheet operates independently of tRPC after receiving the `clientSecret`. JWT expiry does not affect the Stripe payment itself. After sheet closes, the client's next call (`credits.getBalance`) will trigger silent re-auth (Section 2). The PaymentIntent and webhook flow complete regardless of JWT state. | No visible impact to user if silent re-auth succeeds within 2 s. If re-auth fails, show "Session expired — please sign in to see your updated balance." | Silent re-auth is automatic.                                                                                                                                                                                                                                                                                                                                                                 |
| Offline during credit purchase — PaymentIntent created, network drops before Stripe sheet | Client has `clientSecret`, but network is lost before the Stripe SDK can open                      | Stripe SDK will error on initialization. Store `{ paymentIntentId, packageId, clientSecret }` in SecureStore as a `pendingRecovery` entry.                                                                                                                                                                                | "You're offline. Your pending purchase has been saved."                                                                                                 | On next app foreground with network: detect `pendingRecovery` in SecureStore, re-open the Stripe payment sheet with the saved `clientSecret`. Stripe PaymentIntents are valid for 24 hours — the same intent is reused, so there is zero risk of double-charging. If the PaymentIntent has expired (> 24 h), delete the `pendingRecovery` entry and prompt the user to start a new purchase. |

---

### 4. Testing Strategy

#### Unit Tests (Jest + React Native Testing Library)

**Coverage target: 80% for all files under `apps/mobile/src/screens/portfolio/`, `apps/mobile/src/screens/credits/`, and `apps/mobile/src/components/portfolio/`.**

**Mocks required:**

- `@stripe/stripe-react-native`: mock `useStripe()` and `presentPaymentSheet()` — control success/failure paths
- `@reown/appkit-react-native`: mock `useAppKit()` and the modal open/close lifecycle
- `expo-notifications`: mock `getExpoPushTokenAsync()`, `requestPermissionsAsync()`
- `expo-secure-store`: mock `getItemAsync()`, `setItemAsync()`, `deleteItemAsync()` with an in-memory store
- `expo-image`: mock with a standard `<View>` to avoid native module issues in Jest

**Specific test cases:**

1. **BalanceCard — renders with cached data:** Given AsyncStorage returns a stale `portfolio.getSummary` result, the balance card renders the credit number immediately without showing a skeleton. Assert that the credit number text matches the cached value before any network call resolves.

2. **BalanceCard — partial data chip:** Given `portfolio.getSummary` returns `{ partial: true, timedOutFields: ['royalties30d'] }`, the balance card renders a visible "some data unavailable" chip and does NOT render the royalties strip chip. Assert chip presence via `getByTestId('partial-data-chip')`.

3. **BalanceCard — low credit warning:** Given `credits: 85` (below 100 threshold), assert the progress bar has `style.backgroundColor === amber` and the `accessibilityLabel` contains the string "low balance".

4. **CreditPurchaseFlow — Stripe success path:** Mock `presentPaymentSheet()` to return `{ error: undefined }`. Assert that after the sheet closes, `credits.getBalance` is called at least once and the success screen is navigated to.

5. **CreditPurchaseFlow — Stripe decline path:** Mock `presentPaymentSheet()` to return `{ error: { code: 'Canceled', message: 'Card declined' } }`. Assert that the user is NOT navigated to the success screen, and the error banner contains "card was declined".

6. **CreditPurchaseFlow — disabled $LOAR tab:** Given the server returns `PRECONDITION_FAILED` for `purchaseWithLoar`, assert the $LOAR tab's "Buy" button has `disabled={true}` and the tooltip text contains the user's balance.

7. **EarningsRow — renders all four event types:** For each event type (royalty, treasury, collab, affiliate), assert the correct left-border accent color and icon are rendered. This is a parameterized test with 4 cases.

8. **QuestTracker — optimistic claim and revert:** Mock `quests.claimReward` to reject after 500 ms. Assert that after tapping "Claim", the row immediately shows "Claimed" (optimistic), then reverts to "Claim" after the rejection. Assert that an error toast is visible.

9. **QuestTracker — daily check-in disabled state:** Given `quests.getCheckinStatus` returns `{ checkedIn: true }`, assert the check-in button renders as "Done for today" with `disabled={true}`. Assert `quests.dailyCheckin` is never called.

10. **BalanceCard — counter animation skipped under reduced motion:** Mock `useReducedMotion()` to return `true`. Assert that when the balance changes from 100 to 500, the displayed value jumps directly to 500 without intermediate values. Verify by checking the text node's value in the next render frame (mock Reanimated's `withTiming` to be synchronous in test).

#### Integration Tests (Backend — Vitest + Firestore Emulator)

**Firestore emulator seed data required for all tests:**

- A `users/{uid}` document with `{ walletAddress, credits: 500, pushTokens: [] }`
- A `questRewards` document with one claimed and one unclaimed reward for the test uid
- A `royaltyEvents` document with two royalty records for the test uid
- A `pendingPurchases` collection (empty for most tests, seeded for recovery tests)

**Specific integration tests:**

1. **`portfolio.getSummary` — all sub-calls succeed:** Seed Firestore with credits, NFTs, royalties, and quests. Assert the response contains all four non-null fields and `partial: false`.

2. **`portfolio.getSummary` — royalties sub-call simulated timeout:** Inject an artificial 2,000 ms delay into the royalties query by wrapping the Firestore read in a controlled delay utility. Assert the endpoint returns within 1,600 ms (sub-call timeout of 1,500 ms + 100 ms overhead), `partial: true`, and `timedOutFields: ['royalties30d']`. Assert `royalties30d` is `null` in the response.

3. **`licensing.getRoyaltyHistory` — correct pagination:** Seed 25 royalty records for the test uid. Call with `limit: 10`. Assert exactly 10 records returned and `cursor` is set. Call again with the cursor. Assert the next 10 records are returned with no overlap.

4. **`quests.getRewardHistory` — returns only claimed rewards:** Seed one claimed and one unclaimed reward. Assert only the claimed reward is returned.

5. **`notifications.register` — stores token:** Call with a valid Expo push token. Assert `users/{uid}/pushTokens` contains the token. Call again with the same token. Assert no duplicate is stored (idempotent).

6. **`notifications.getPreferences` + `notifications.updatePreferences` round-trip:** Call `updatePreferences` with `{ creditLow: false, royaltyReceived: true }`. Call `getPreferences`. Assert the returned preferences match what was set.

7. **`portfolio.getSummary` — unauthorized access rejected:** Call without a valid JWT. Assert the response is HTTP 401. Assert no Firestore reads were performed.

8. **Secondary wallet link signature verification:** Call `profiles.upsert` with a valid nonce, correctly signed message, and matching address. Assert `users/{uid}.secondaryWalletAddress` is updated. Call again with the same nonce. Assert the second call fails with `UNAUTHORIZED` (nonce consumed). Call with a forged signature. Assert `UNAUTHORIZED`.

#### E2E Tests (Maestro)

**CI run policy:**

- **On PR:** E2E tests 1, 2, and 3 (smoke path only)
- **On merge to main:** All 6 E2E tests
- **On release candidate build:** All 6 E2E tests on physical device gate (1 iOS, 1 Android)

**Device matrix:**

- iOS 16.x simulator (Xcode 15)
- iOS 17.x simulator
- Android 13 emulator (API 33)
- Android 14 emulator (API 34)
- Physical device gate: iPhone 14 (iOS 17) + Pixel 7 (Android 14) — release candidates only

**Specific E2E flows:**

1. **Portfolio home loads within SLA:** Launch app cold (cleared state). Authenticate with test account. Assert balance card is visible within 3,000 ms of app foreground. Assert credit number matches seeded value.

2. **Full credit purchase via Stripe test card:** Navigate to "Top Up". Select the smallest credit package. Tap "Fiat". Stripe payment sheet opens. Enter test card `4242 4242 4242 4242`, expiry `12/28`, CVC `123`. Tap "Pay". Assert success screen shows "Credits added". Navigate back. Assert balance card shows incremented credit value. Total flow must complete within 15 seconds.

3. **Quest claim flow:** Open Quest Tracker. Assert one quest shows "Claim" button. Tap daily check-in. Assert streak increments. Tap "Claim" on a completed quest. Assert the row shows "Claimed". Assert balance card credit count has increased by the quest reward amount.

4. **Portfolio offline mode:** Load portfolio successfully (seed data visible). Enable airplane mode via device API. Kill and relaunch the app. Assert portfolio home renders with cached data within 1,200 ms. Assert "Offline — showing cached data" banner is visible. Assert "Top Up" button is disabled. Disable airplane mode. Assert banner disappears and data refreshes.

5. **Secondary wallet link via WalletConnect:** Open Wallet Management sheet. Tap "Connect via WalletConnect". Assert Reown AppKit modal opens with a QR code. (In E2E, use a test wallet that auto-accepts the pairing and signs the challenge.) Assert the wallet address appears in the "Link another wallet" section after completion.

6. **Earnings tab — all four event types visible:** With a test account seeded with royalty, treasury, collab, and affiliate records, open the Earnings tab. Assert all four event type rows are rendered (by testId or accessibility label). Assert the 30-day summary card is visible and shows a non-zero total. Assert fiat toggle switches amounts to USD display.

#### Load Tests

**`portfolio.getSummary` load test:**

- Baseline: 200 RPS (expected at launch with ~5,000 daily active users with typical session patterns)
- 3× overload test: 600 RPS — assert p95 remains ≤ 2,500 ms and error rate < 0.1%
- Degraded sub-call test: inject a 2,000 ms artificial delay on all royalties Firestore reads. Assert at 200 RPS that the endpoint still returns within 1,600 ms (sub-call timeout fires at 1,500 ms) and `partial: true` responses contain correct data for the non-delayed fields. Assert the delay does NOT cause thread pool exhaustion (all other requests continue to process normally).
- Tool: k6 scripts in `apps/server/tests/load/portfolio-summary.k6.js`

**Push notification batch delivery load test:**

- Simulate 10,000 simultaneous push sends (representing a mass notification event).
- Expo Push API hard limit: 100 push tokens per request. The `push-notifications.ts` service must chunk token arrays into batches of 100 and process them.
- Test the batching logic: assert that for 10,000 tokens, exactly 100 batch requests are made to the Expo Push API.
- Test error handling: simulate 5 of the 100 batches returning `DeviceNotRegistered` errors. Assert those tokens are removed from the user's `pushTokens` array in Firestore.
- Target throughput: all 10,000 sends dispatched within 30 seconds (100 batches × ~250 ms per Expo API call, with concurrency of 10).

#### Contract Tests

The `portfolio.getSummary` response shape is a contract between the server and the mobile client. A Zod schema is maintained at `apps/mobile/src/lib/contracts/portfolio-summary.contract.ts`:

```typescript
import { z } from 'zod';

export const PortfolioSummaryContract = z.object({
  credits: z.number().nullable(),
  nftCount: z.number().nullable(),
  royalties30d: z
    .object({
      loar: z.number(),
      usd: z.number().nullable(),
    })
    .nullable(),
  activeQuestCount: z.number().nullable(),
  walletAddress: z.string(),
  partial: z.boolean(),
  timedOutFields: z.array(z.string()),
});
```

A contract test in `apps/server/src/routers/portfolio/__tests__/portfolio.contract.test.ts` calls `getPortfolioSummary` with seeded data and parses the result with `PortfolioSummaryContract.parse(result)`. If the server changes the response shape without updating the contract schema, this test fails. The contract schema file is owned by the mobile team — any PR that modifies `portfolio.routes.ts` response shape must update `portfolio-summary.contract.ts` or CI fails.

---

### 5. Observability and Alerting

#### Server-Side Metrics

All server metrics are emitted to the LOAR observability backend (Prometheus-compatible, exported via `prom-client`). Dashboards hosted in Grafana.

**`portfolio.getSummary` metrics:**

- `portfolio_get_summary_duration_ms` (histogram, labels: `sub_call: credits|nftCount|royalties30d|activeQuestCount`) — tracks per-sub-call latency separately to identify the slowest component
- `portfolio_get_summary_partial_total` (counter) — increments each time a response is returned with `partial: true`
- `portfolio_get_summary_timeout_by_field_total` (counter, labels: `field`) — which sub-call timed out most often
- `portfolio_get_summary_requests_total` (counter, labels: `status: success|partial|error`) — overall call volume

**`licensing.getRoyaltyHistory` metrics:**

- `licensing_royalty_history_duration_ms` (histogram)
- `licensing_royalty_history_empty_total` (counter) — tracks calls that returned zero records (useful for detecting indexer lag or missing data)

**Credit purchase funnel (server-side):**

- `credits_purchase_fiat_initiated_total` — PaymentIntent creation attempted
- `credits_purchase_fiat_intent_created_total` — PaymentIntent created successfully
- `credits_purchase_stripe_webhook_confirmed_total` — `payment_intent.succeeded` webhook received
- `credits_purchase_grant_completed_total` — credits actually written to user's balance
- `credits_purchase_fiat_failed_total` (labels: `reason: stripe_error|webhook_timeout|grant_error`) — drop-off tracking

**Push notification metrics:**

- `push_notifications_sent_total` (labels: `type: credit_low|royalty_received|quest_complete|collab_status|treasury_allocation`)
- `push_notifications_delivered_total` (labels: `type`) — Expo receipt API confirmation
- `push_notifications_failed_total` (labels: `type, reason: DeviceNotRegistered|MessageRateExceeded|unknown`)

**Secondary wallet link metrics:**

- `wallet_link_attempts_total`
- `wallet_link_success_total`
- `wallet_link_failed_total` (labels: `reason: invalid_signature|expired_nonce|nonce_reuse`)

#### Client-Side Metrics

Client metrics collected via `apps/mobile/src/lib/analytics.ts` (wraps the platform analytics SDK — e.g., PostHog or Mixpanel). Metrics are performance properties attached to analytics events.

- **Balance card render time:** Measured from `portfolio_opened` (screen mount timestamp) to `balance_card_viewed` (data rendered timestamp). Property `render_duration_ms` on the `balance_card_viewed` event.
- **Earnings tab merge time:** Measured from `earnings_tab_viewed` (mount) to all four queries returning. Property `merge_duration_ms` on the `earnings_tab_viewed` event, plus `partial: boolean` indicating if any sub-call failed.
- **Portfolio offline cache hit rate:** Property `had_cached_data: boolean` on `portfolio_opened`. Computed as: was AsyncStorage non-empty before the network call returned?
- **Credit purchase funnel (client-side):** Tracked as a sequence of events: `top_up_tapped` → `package_selected` → `purchase_initiated` → `purchase_completed` (or `purchase_failed`). Each step has a `session_id` to allow funnel analysis.

#### Alerting Rules

| Alert                               | Severity | Condition                                                                                                                   | Notification               |
| ----------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Portfolio summary slow              | P1       | `portfolio_get_summary_duration_ms` p95 > 3,000 ms over 5-minute window                                                     | PagerDuty on-call rotation |
| Credit purchase success rate low    | P1       | (`credits_purchase_grant_completed_total` / `credits_purchase_stripe_webhook_confirmed_total`) < 0.98 over 10-minute window | PagerDuty on-call rotation |
| Push delivery rate low              | P2       | (`push_notifications_delivered_total` / `push_notifications_sent_total`) < 0.90 over 10-minute window                       | Slack `#alerts-mobile`     |
| Portfolio partial failure rate high | P2       | (`portfolio_get_summary_partial_total` / `portfolio_get_summary_requests_total`) > 0.10 over 5-minute window                | Slack `#alerts-mobile`     |
| Earnings sub-call error rate        | P3       | Any individual sub-call error rate > 0.05 over 15-minute window                                                             | Slack `#alerts-backend`    |
| Push token registration failures    | P3       | `push_notifications_failed_total` with `reason: DeviceNotRegistered` > 100 per hour                                         | Slack `#alerts-mobile`     |

#### Dashboards

**Portfolio Health Dashboard:**

- Panel 1: `portfolio.getSummary` p50/p95/p99 latency (time series, 1-hour window)
- Panel 2: Per-sub-call latency breakdown (stacked bar: credits / nftCount / royalties30d / activeQuestCount)
- Panel 3: Partial failure rate (gauge + time series — turns red above 10%)
- Panel 4: Balance card render time p95 (client-measured, from analytics)
- Panel 5: `portfolio.getSummary` request volume (RPS)

**Credit Purchase Funnel Dashboard:**

- Panel 1: Funnel visualization — each step as a bar: initiated → intent created → Stripe confirmed → credits granted
- Panel 2: Step-by-step conversion rates with daily trend (7-day sparkline per step)
- Panel 3: Stripe success rate (gauge — turns red below 98%)
- Panel 4: Purchase volume by payment method (fiat vs. $LOAR, daily bars)
- Panel 5: Failed purchase breakdown by reason (pie chart: card_declined, 3ds_fail, insufficient_loar, network_error)

**Notifications Health Dashboard:**

- Panel 1: Send/delivered/failed by notification type (stacked bar, hourly)
- Panel 2: Delivery latency p50/p95 (time series)
- Panel 3: `DeviceNotRegistered` error rate (triggers token cleanup)
- Panel 4: Push opt-in rate trend (7-day rolling, from analytics `push_opt_in_accepted` / `push_opt_in_shown`)

---

### 6. Analytics Instrumentation

Every analytics event for Workstream 2 with exact trigger and typed properties. All events are sent via `apps/mobile/src/lib/analytics.ts`. All timestamps are ISO 8601. All amounts are raw numbers (not formatted strings).

```typescript
/**
 * portfolio_opened
 * Trigger: user taps Portfolio tab OR app cold-launches directly to Portfolio
 */
portfolio_opened: {
  cold_launch: boolean; // true if this is the first screen after app launch
  had_cached_data: boolean; // true if AsyncStorage had a non-expired portfolio cache
  balance_loaded_from: 'cache' | 'network'; // which data source rendered first
}

/**
 * balance_card_viewed
 * Trigger: balance card renders with real data (skeleton replaced)
 * NOT fired while skeleton is showing
 */
balance_card_viewed: {
  credits: number; // credit balance at render time
  nft_count: number; // total NFT count
  had_estimated_value: boolean; // true if price feed returned a value
  render_duration_ms: number; // time from screen mount to this event
}

/**
 * top_up_tapped
 * Trigger: user taps the "Top Up" ghost button on the balance card
 */
top_up_tapped: {
  current_balance: number;
  entry_point: 'balance_card' | 'low_credit_nudge' | 'notification';
}

/**
 * package_selected
 * Trigger: user taps a credit package card on the packages screen
 */
package_selected: {
  package_id: string;
  credits: number;
  price_usd: number;
  payment_method: 'fiat' | 'loar';
  is_best_value: boolean; // true if this package has the "Best value" badge
}

/**
 * purchase_initiated
 * Trigger: user taps "Buy" on the payment confirmation screen
 * (BEFORE the Stripe sheet opens or the $LOAR tx is submitted)
 */
purchase_initiated: {
  package_id: string;
  payment_method: 'fiat' | 'loar';
}

/**
 * purchase_completed
 * Trigger: credits.getBalance returns a value higher than pre-purchase balance
 * (confirms server-side grant completed, not just Stripe confirmation)
 */
purchase_completed: {
  package_id: string;
  payment_method: 'fiat' | 'loar';
  credits_added: number; // actual delta from balance poll
  duration_ms: number; // time from purchase_initiated to this event
}

/**
 * purchase_failed
 * Trigger: Stripe payment fails OR $LOAR tx is rejected OR server returns error
 */
purchase_failed: {
  package_id: string;
  payment_method: 'fiat' | 'loar';
  error_code: string; // Stripe error code or tRPC error code
}

/**
 * nft_tab_viewed
 * Trigger: user opens or focuses the Assets tab
 */
nft_tab_viewed: {
  character_count: number;
  episode_count: number;
}

/**
 * nft_detail_opened
 * Trigger: user taps an NFT card (character or episode)
 */
nft_detail_opened: {
  token_id: string;
  nft_type: 'character' | 'episode';
  universe_id: string;
}

/**
 * earnings_tab_viewed
 * Trigger: user opens or focuses the Earnings tab
 */
earnings_tab_viewed: {
  has_royalties: boolean;
  has_treasury: boolean;
  has_collab: boolean;
  has_affiliate: boolean;
  merge_duration_ms: number; // time for all 4 sub-calls to resolve and merge
  partial: boolean; // true if any sub-call failed
}

/**
 * earnings_event_tapped
 * Trigger: user taps an earnings row to expand or open detail
 */
earnings_event_tapped: {
  event_type: 'royalty' | 'treasury' | 'collab' | 'affiliate';
  amount_loar: number;
  status: 'pending' | 'confirmed' | 'claimed';
}

/**
 * quest_tracker_opened
 * Trigger: user opens the Quest Tracker bottom sheet
 */
quest_tracker_opened: {
  completed_count: number;
  claimable_count: number; // completed && !claimed
  streak: number;
}

/**
 * quest_claimed
 * Trigger: quests.claimReward call completes successfully (server confirms)
 * NOT fired on optimistic update — only on confirmed success
 */
quest_claimed: {
  quest_id: string;
  reward_amount: number;
}

/**
 * daily_checkin_completed
 * Trigger: quests.dailyCheckin call completes successfully
 */
daily_checkin_completed: {
  streak: number; // updated streak value returned by server
}

/**
 * wallet_sheet_opened
 * Trigger: user taps the balance card (which opens Wallet Management sheet)
 */
wallet_sheet_opened: {
  has_secondary_wallet: boolean;
}

/**
 * secondary_wallet_link_initiated
 * Trigger: user taps "Connect via WalletConnect" button
 */
secondary_wallet_link_initiated: Record<string, never>; // no properties

/**
 * secondary_wallet_link_completed
 * Trigger: secondary wallet address successfully persisted to Firestore
 */
secondary_wallet_link_completed: {
  wallet_prefix: string; // first 6 characters of wallet address ONLY (e.g., "0x1a2b")
}

/**
 * push_opt_in_shown
 * Trigger: OS notification permission prompt is about to be presented
 * (fired immediately before requestPermissionsAsync())
 */
push_opt_in_shown: {
  entry_point: 'post_wallet_link' | 'settings';
}

/**
 * push_opt_in_accepted
 * Trigger: requestPermissionsAsync() returns status 'granted'
 */
push_opt_in_accepted: Record<string, never>;

/**
 * push_opt_in_declined
 * Trigger: requestPermissionsAsync() returns status 'denied' or 'undetermined' after prompt
 */
push_opt_in_declined: Record<string, never>;

/**
 * notification_received
 * Trigger: Expo Notifications listener fires (both foreground and background)
 */
notification_received: {
  type: 'credit_low' |
    'royalty_received' |
    'quest_complete' |
    'collab_status' |
    'treasury_allocation';
  foreground: boolean; // true if app was in foreground when received
}

/**
 * notification_tapped
 * Trigger: user taps a notification from the notification tray or foreground banner
 */
notification_tapped: {
  type: 'credit_low' |
    'royalty_received' |
    'quest_complete' |
    'collab_status' |
    'treasury_allocation';
  destination: string; // the in-app route navigated to (e.g., "/(tabs)/portfolio/credits/packages")
}
```

---

### 7. Rollout Strategy

#### Feature Flags

All flags are managed server-side via a `featureFlags/{flag}` Firestore collection. The mobile client fetches active flags at startup via a lightweight `flags.getActive()` tRPC call (not gated behind auth — cached 10 minutes). All flags default to `off` unless specified.

| Flag                           | Kill switch | Alpha default | Closed beta default | Open beta default | GA default | Notes                                                                                                                                                 |
| ------------------------------ | ----------- | ------------- | ------------------- | ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio_summary_v1`         | Yes         | On            | On                  | On                | On         | Master flag for the entire workstream. Killing this hides the Portfolio tab and falls back to a "coming soon" state.                                  |
| `fiat_credit_purchase`         | Yes         | On            | On                  | On                | On         | Kill-switch for the Stripe purchase path. If Stripe has an outage, disable this flag to show "$LOAR only" mode without a native build.                |
| `loar_credit_purchase`         | Yes         | On            | On                  | On                | On         | Kill-switch for the $LOAR on-chain purchase path. Disable if Sepolia is degraded.                                                                     |
| `secondary_wallet_link`        | Yes         | On            | On                  | Off               | On         | Open beta default is Off — wallet link is a higher-risk feature; enable only after closed beta validation.                                            |
| `push_notifications_portfolio` | Yes         | On            | On                  | On                | On         | Disabling prevents all push sends for Workstream 2 notification types. Does not affect the opt-in UI (which should still render, just without sends). |
| `royalty_history`              | No          | On            | On                  | On                | On         | Not a kill switch — royalty history is additive. If the endpoint is broken, FR-E-05 degraded mode applies.                                            |
| `quest_reward_history`         | No          | On            | On                  | On                | On         | Additive data endpoint.                                                                                                                               |
| `earnings_tab`                 | Yes         | On            | On                  | On                | On         | Hides the Earnings tab entirely if disabled.                                                                                                          |
| `loar_fiat_toggle`             | No          | On            | On                  | On                | On         | The $LOAR ↔ fiat display toggle on Earnings. Not safety-critical.                                                                                     |
| `offline_portfolio_cache`      | No          | On            | On                  | On                | On         | AsyncStorage caching. Disabling causes every cold launch to show skeleton until network resolves.                                                     |

#### Staged Rollout

**Internal Alpha (team — ~20 users):**

- Minimum bar to advance: zero P0 crashes in 7 days of daily use; `portfolio.getSummary` p95 < 1,200 ms on staging environment; credit purchase end-to-end tested with Stripe test cards on at least 2 iOS and 2 Android devices; push notifications received on at least 1 iOS and 1 Android physical device.

**Closed Beta (~500 users — invited waitlist):**

- Go/no-go criteria: crash-free session rate ≥ 99.0%; portfolio home render time p95 ≤ 2,800 ms (measured from client analytics); Stripe purchase success rate ≥ 99%; no P1 alerts firing for 48 hours before advancement. Test the secondary wallet link with at least 20 real WalletConnect sessions.

**Open Beta (~5,000 users — App Store/Play Store TestFlight/internal track):**

- Go/no-go criteria: crash-free session rate ≥ 99.2%; push opt-in rate ≥ 55% (below target, but acceptable for beta — GA target is 65%); portfolio D1 retention ≥ 45%; no unresolved P1 or P2 bugs; `fiat_credit_purchase` and `loar_credit_purchase` validated at volume; `secondary_wallet_link` enabled and validated.

**GA:**

- Go/no-go criteria: all success metrics from the PRD header met or exceeded over a 7-day measurement window; crash-free ≥ 99.2%; `portfolio.getSummary` p95 ≤ 1,200 ms at production load; App Store review approved; Play Store review approved; no P1 alerts firing in the 72 hours before GA date.

#### A/B Tests

**Test 1: Balance card layout ordering**

- Hypothesis: Showing credit balance prominently first (vs. NFT count first) increases credit top-up conversion.
- Variant A (control): Credit balance number is the hero element; NFT count chip is in the summary strip below.
- Variant B: NFT count is displayed as a prominent secondary stat on the balance card itself; credit balance is still present but shares visual weight.
- Primary metric: `top_up_tapped` rate (proportion of portfolio opens that lead to a top-up tap within the session).
- Secondary metric: time-to-top-up-tap (how quickly users navigate to purchase).
- Sample size: 500 users per variant minimum. Minimum 14 days runtime.
- Rollout: 50/50 random assignment on first app open, persisted in AsyncStorage.

**Test 2: Low-credit nudge threshold**

- Hypothesis: A higher nudge threshold (200 credits remaining) triggers more top-up conversions because users aren't yet in a "panic" state and are more receptive to the nudge.
- Variant A (control): Nudge threshold = 100 credits (progress bar turns amber at 100).
- Variant B: Nudge threshold = 200 credits.
- Primary metric: credit top-up conversion rate (users who received the nudge and completed a purchase within 24 hours).
- Secondary metric: user satisfaction score (post-purchase survey).
- Sample size: 1,000 users per variant. Minimum 21 days runtime.
- Rollout: 50/50 assignment. The threshold value is passed down from the feature flag payload (not hard-coded in the client).

**Test 3: Quest tracker placement**

- Hypothesis: A dedicated "Quests" tab in the bottom tab bar increases quest completion vs. a bottom sheet accessible only from a chip on the portfolio home.
- Variant A (control): Quest tracker is a sheet, accessible from the "Active quests" summary chip.
- Variant B: Quest tracker is promoted to a fifth tab in the bottom navigation bar.
- Primary metric: `quest_claimed` rate (proportion of users with claimable quests who claim within a session).
- Secondary metric: `daily_checkin_completed` rate (daily check-in streak maintenance).
- Sample size: 500 users per variant. Minimum 14 days runtime.
- Note: Variant B requires a different navigation build. Feature flag `quest_tab_variant` controls which layout is rendered.

#### Rollback

**OTA rollback (JS-only changes via Expo Updates):**
The Expo Updates channel structure:

- `production` — GA releases. Only promoted from `open-beta` after go/no-go sign-off.
- `open-beta` — Open beta builds. Promoted from `staging`.
- `staging` — Closed beta and internal alpha builds. Promoted from `canary`.
- `canary` — Continuous deployment from `main` branch merges.

To OTA rollback: use Expo EAS CLI to re-publish the last known-good JS bundle to the affected channel:

```bash
eas update --channel production --message "rollback: revert to build 1.2.3"
```

OTA rollback takes effect on the next app foreground (Expo Updates checks for updates in the background on launch). P1 rollbacks should be deployed within 15 minutes of decision.

**Native rollback (requires App Store / Play Store submission):**
The following features have native module dependencies and CANNOT be OTA rolled back:

- `@stripe/stripe-react-native` — Stripe native payment sheet. A breaking Stripe issue requires a new App Store/Play Store submission. Mitigate with `fiat_credit_purchase` kill switch while the build is in review.
- `@reown/appkit-react-native` — Reown AppKit uses native WalletConnect transport. Kill with `secondary_wallet_link` flag while a fix is submitted.
- `expo-secure-store` — Encrypted storage is a native module. If SecureStore is broken, auth is broken — this requires an emergency native build. Cannot be feature-flagged out.
- `expo-notifications` — APNs/FCM native module. Kill with `push_notifications_portfolio` flag while a fix is submitted.

**Database rollback:**
The new Firestore collections and fields added in Workstream 2 are entirely additive:

- `users/{uid}.pushTokens` — new field, harmless if empty or missing
- `users/{uid}.secondaryWalletAddress` — new field, harmless if absent
- `users/{uid}/notificationPreferences` — new subcollection, harmless if missing (server returns defaults)
- `questRewards` — new collection, not read by any pre-Workstream-2 code path

On a rollback to a pre-Workstream-2 server build, records written by Workstream-2 code continue to exist in Firestore but are not read. They are orphaned but harmless. No migration rollback script is required.

---

### 8. Accessibility Requirements

#### Screen Reader (VoiceOver / TalkBack)

**Balance card — unified accessibility label:**
The balance card as a whole must be treated as a single interactive unit for screen readers. Set `accessibilityRole="button"` and a dynamically computed `accessibilityLabel` on the outermost `Pressable`:

```
"Portfolio balance: {credits} LOAR credits. Estimated value: {usd_value}. {nft_count} NFTs owned. {low_balance_warning}Tap to manage wallet."
```

Where `{low_balance_warning}` is an optional prefix: if credits are below 100, prepend `"Warning: low balance. "`. If the estimated value is unavailable, replace with: `"Estimated value unavailable."` If the price feed returns a value, format as `"Estimated value: $12.50."` (two decimal places, USD prefix).

The sub-elements inside the balance card (wallet address text, progress bar, "Top Up" button) must each have `accessibilityElementsHidden={true}` to prevent VoiceOver from reading them individually when the card is focused as a unit. The "Top Up" button must also be accessible as an independent element when the user navigates into the card — use `accessibilityViewIsModal={false}` and allow nested accessibility. Specifically: the card can be swiped to as a unit, OR the user can swipe into it to reach the "Top Up" button independently.

**Credit progress bar:**
The progress bar is a visual-only component and requires explicit screen reader support. Implement as a `View` with:

```
accessibilityRole="progressbar"
accessibilityValue={{ min: 0, max: 100, now: Math.round(percentRemaining) }}
accessibilityLabel={`Credit budget: ${credits} credits remaining, approximately ${Math.round(percentRemaining)}% of a typical generation run. ${credits < 100 ? 'Low balance.' : ''}`}
```

The "approximately X% of a typical generation budget" interpretation must be included — raw numbers alone are meaningless to a creator who doesn't know the cost of a generation.

**Earnings timeline rows:**
Each row in the earnings timeline must announce all material information in a single swipe. Set `accessibilityLabel` on the row's `Pressable`:

```
"{event_type_label}. {direction} {amount} LOAR. {status}. {formatted_date}."
```

Examples:

- `"Royalty received. Plus 50 LOAR. Confirmed. March 26th."`
- `"Treasury allocation. Plus 120 LOAR. Pending. March 24th."`
- `"Collab payout. Plus 200 LOAR. Claimed. March 20th."`
- `"Affiliate reward. Plus 30 LOAR. Confirmed. March 18th."`

The left-border accent color is decorative and must not be the sole differentiator (see Visual Accessibility below). Each row's `accessibilityHint` should be: `"Double tap to view details."` if the row is tappable.

**NFT cards in carousel:**
Focus order within the Characters horizontal carousel: left-to-right, left edge first. Each card: `accessibilityRole="button"`, `accessibilityLabel="{character_name}. {universe_name} universe. Character NFT."`. After the last card, the "See all" button receives focus. The carousel container must set `accessibilityElementsHidden={false}` and should NOT use `ScrollView` without explicit `accessible={false}` on the scroll container (to prevent the scroll container itself from stealing focus).

**Quest progress rings:**
SVG-based progress rings are entirely invisible to screen readers. Each quest row must have `accessibilityLabel` on its container:

```
"{quest_name}. {progress_percent}% complete. {cta_state}."
```

Where `{cta_state}` is one of: `"Claim your reward."` (claimable), `"Claimed."` (done), `"In progress."` (not yet complete). The SVG ring itself must have `accessibilityElementsHidden={true}`.

#### Motor Accessibility

**Bottom sheet dismissal:**
All bottom sheets in Workstream 2 (Wallet Management, Quest Tracker, Character Detail, Episode Detail) MUST be dismissible by a single tap on the backdrop overlay. Do NOT require a downward swipe gesture as the only dismiss method. Implement using `react-native-reanimated`'s pan gesture handler with a simultaneous backdrop tap handler — both must close the sheet.

**Credit purchase interactive element sizing:**
All tappable elements in the purchase flow (package cards, payment method tabs, "Buy" button, "Cancel" link) must have a minimum touch target of 44×44 points, per Apple HIG and Android Material Design guidelines. This is enforced by a shared `minTouchTarget` style utility:

```typescript
// apps/mobile/src/styles/accessibility.ts
export const minTouchTarget = {
  minHeight: 44,
  minWidth: 44,
};
```

Apply to all interactive elements in the purchase flow. If the visual element is smaller (e.g., a text link), use `hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}` to extend the touch area.

**Quest claim button minimum height:**
In the quest list context, each quest row's "Claim" button must have a minimum height of 44 points and a minimum width of 80 points. Given quest rows are in a FlatList that may render many items, do not pad excessively — use the `hitSlop` approach for rows where the button cannot be enlarged without affecting layout.

#### Visual Accessibility

**Balance card credit balance contrast:**
The balance card uses a frosted-glass gradient overlay on a dynamic background color. Because the gradient color is user-derived (from universe palette) and can be any hue/luminance, the credit balance number cannot rely on a fixed color for 4.5:1 contrast.

Solution: wrap the credit balance number in a semi-opaque scrim layer:

```typescript
// A dark scrim that guarantees contrast on any background
const creditBalanceScrim = {
  backgroundColor: 'rgba(0, 0, 0, 0.45)',
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 4,
};
```

The text color of the credit number is always `#FFFFFF`. With a 45% black scrim, the effective background luminance is at most 0.55 × any foreground — for the worst case (white gradient background, L=1.0): effective background = 0.55. Contrast = (1.05) / (0.55 × 1.0 + 0.05) = 1.75 — this is insufficient for WCAG AA. Increase scrim opacity to 0.65:

- Worst case white background: effective L = 0.35. Contrast = (1.05) / (0.35 + 0.05) = 2.63 — still insufficient.
- Solution: use `#000000` text on a white variant scrim when the background is light. Detect background luminance from the universe color using `chroma-js` (or a lightweight luminance function) and switch between white/black text accordingly. Maintain a minimum scrim opacity of 0.55 regardless of direction. This guarantees ≥ 4.5:1 on all backgrounds.

**Earnings timeline — non-color event type differentiation:**
The left-border accent colors (green for royalty, teal for treasury, blue for collab, purple for affiliate) MUST NOT be the only way to distinguish event types. Each row must also use a distinct icon shape:

| Event type          | Color  | Icon                                                                            |
| ------------------- | ------ | ------------------------------------------------------------------------------- |
| Royalty received    | Green  | Circle with upward arrow (`arrow.up.circle.fill` on iOS, equivalent on Android) |
| Treasury allocation | Teal   | Building/bank icon (`building.columns.fill` on iOS)                             |
| Collab payout       | Blue   | Two-person group icon (`person.2.fill` on iOS)                                  |
| Affiliate reward    | Purple | Link/chain icon (`link` on iOS)                                                 |

Icons are drawn from SF Symbols (iOS) and Material Symbols (Android) via `@expo/vector-icons`. The icon shape alone must communicate the event type to a user who cannot distinguish green from teal (deuteranopia) or blue from purple (tritanopia).

**Reduced motion — balance counter:**

```typescript
import { useReducedMotion } from 'react-native-reanimated';

function BalanceCounter({ value }: { value: number }) {
  const reducedMotion = useReducedMotion();
  const animatedValue = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      animatedValue.value = value; // instant, no animation
    } else {
      animatedValue.value = withTiming(value, {
        duration: Math.min(600 + (value / 5000) * 600, 1200),
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [value, reducedMotion]);

  const animatedProps = useAnimatedProps(() => ({
    text: String(Math.round(animatedValue.value)),
  }));

  return <AnimatedTextInput editable={false} animatedProps={animatedProps} />;
}
```

#### Testing Protocol

**Pre-every release candidate:**

1. **VoiceOver (iOS) — credit purchase flow:** Starting from Portfolio Home with VoiceOver enabled, navigate to "Top Up" using swipe navigation only (no tapping on visual targets). Select a package, confirm the method, open the Stripe sheet. Verify that every interactive element in the Stripe sheet is reachable via VoiceOver (Stripe's payment sheet uses native UIKit — it should be inherently accessible, but verify). Complete the purchase. Verify the success screen announces "Credits added."

2. **TalkBack (Android) — portfolio home + earnings tab:** With TalkBack enabled, swipe through the portfolio home screen. Verify the balance card announces the full computed `accessibilityLabel` (not individual sub-elements). Swipe to the Earnings tab. Verify each row in the earnings timeline announces event type, amount, status, and date in that order. Verify no element is skipped or reads as an empty string.

Both testing protocols must be documented as a checklist in the release notes. A QA engineer signs off on both before the RC is promoted to production.

---

### 9. Rate Limiting Specifications

#### Rate Limit Table

| Endpoint                                  | Burst limit   | Sustained limit     | Rate limit key | Client behavior when limited                                                                                                                                                                                              |
| ----------------------------------------- | ------------- | ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio.getSummary`                    | 30 per minute | 120 per hour        | per-user (UID) | Silent: use cached data and continue to poll on the standard TTL. Do NOT show an error to the user for this endpoint — it is a background fetch. Log the 429 to analytics as `portfolio_rate_limited`.                    |
| `credits.purchaseWithFiat`                | 3 per minute  | 10 per hour         | per-user (UID) | Disable the "Buy" button. Show a countdown timer beneath the button: "Try again in Xs." Timer counts down from `retryAfter` value. After the timer expires, re-enable the button automatically.                           |
| `credits.purchaseWithLoar`                | 3 per minute  | 10 per hour         | per-user (UID) | Same as `purchaseWithFiat`: disable button, show countdown.                                                                                                                                                               |
| `licensing.getRoyaltyHistory`             | 20 per minute | 200 per hour        | per-user (UID) | Silent retry after 5 seconds. Show a subtle "Refresh" button on the Earnings tab if retry fails. Do not block the tab render.                                                                                             |
| `notifications.register`                  | 5 per hour    | 20 per day          | per-user (UID) | Silent failure. The client has already stored the push token locally in SecureStore. The token will be re-registered on next app launch. Do NOT show any error to the user — push registration is a background operation. |
| `quests.claimReward`                      | 10 per minute | — (no hourly limit) | per-user (UID) | Show inline error on the quest row: "Too many claims. Please wait a moment." Re-enable after `retryAfter` seconds. Do not revert the optimistic update until the rate limit expires — keep showing "Claiming..." state.   |
| `profiles.upsert` (secondary wallet link) | 5 per hour    | —                   | per-user (UID) | Show error on the wallet link sheet: "Too many link attempts. Please try again later." Do not show a countdown timer (this is an unusual operation — a user who hits this limit is doing something unexpected).           |

#### Implementation

Rate limiting is enforced in **tRPC middleware** using a shared `rateLimit` utility. It is NOT implemented in individual handlers — applying it in middleware ensures consistency and prevents accidental omission.

**Middleware:**

```typescript
// apps/server/src/middleware/rate-limit.middleware.ts
export function withRateLimit(config: RateLimitConfig) {
  return middleware(async ({ ctx, next }) => {
    const key = `ratelimit:${config.endpoint}:${ctx.user.uid}`;
    await rateLimit(key, config);
    return next();
  });
}
```

**Utility: `apps/server/src/lib/rate-limit.ts`**

**Implementation: In-memory Map with TTL** is used for single-instance deployments (current). The trade-off:

- **In-memory Map:** Zero latency, no external dependency, trivially simple. Works perfectly for a single server instance. **Breaks in multi-instance deployments** — each instance has its own counter, so a user can hit the same endpoint N × limit times if N instances are running.
- **Firestore document counters:** Consistent across instances, survives restarts. Adds ~10–30 ms per rate-limited call (Firestore increment operation). Requires careful TTL management (Firestore TTL policies or manual cleanup).
- **Redis:** Fastest consistent option (~1 ms), but requires a Redis instance in infrastructure.

**Recommendation:** Start with in-memory Map. Fly.io (the deployment target) can be configured to run a single instance per region with `min_machines_running = 1` and `max_machines_running = 1` per region. For a pre-mainnet, sub-10,000 DAU deployment, a single instance per region is acceptable. Migrate to Firestore counters (or Redis via Upstash) before open beta if multi-instance becomes necessary.

```typescript
// apps/server/src/lib/rate-limit.ts

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  endpoint: string;
  burstLimit: number;
  burstWindowMs: number; // typically 60_000 (1 minute)
  sustainedLimit?: number;
  sustainedWindowMs?: number; // typically 3_600_000 (1 hour)
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export async function rateLimit(key: string, config: RateLimitConfig): Promise<void> {
  const now = Date.now();

  // Burst check
  const burstKey = `${key}:burst`;
  const burstEntry = rateLimitStore.get(burstKey);
  if (!burstEntry || now - burstEntry.windowStart > config.burstWindowMs) {
    rateLimitStore.set(burstKey, { count: 1, windowStart: now });
  } else {
    burstEntry.count++;
    if (burstEntry.count > config.burstLimit) {
      const retryAfter = Math.ceil((config.burstWindowMs - (now - burstEntry.windowStart)) / 1000);
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
      });
    }
  }

  // Sustained check (if configured)
  if (config.sustainedLimit && config.sustainedWindowMs) {
    const sustainedKey = `${key}:sustained`;
    const sustainedEntry = rateLimitStore.get(sustainedKey);
    if (!sustainedEntry || now - sustainedEntry.windowStart > config.sustainedWindowMs) {
      rateLimitStore.set(sustainedKey, { count: 1, windowStart: now });
    } else {
      sustainedEntry.count++;
      if (sustainedEntry.count > config.sustainedLimit) {
        const retryAfter = Math.ceil(
          (config.sustainedWindowMs - (now - sustainedEntry.windowStart)) / 1000
        );
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Hourly rate limit exceeded. Retry after ${retryAfter} seconds.`,
        });
      }
    }
  }
}
```

The `TRPCError` with code `TOO_MANY_REQUESTS` maps to HTTP 429. The client reads `error.message` to extract the `retryAfter` value for the countdown timer.

---

### 10. Caching Strategy

#### Full Cache Specification

| Data                                         | Client cache TTL            | Server cache TTL                   | Invalidation trigger                                                                                                                                     | SWR? | Notes                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio.getSummary`                       | 60 s                        | 30 s per-user in-memory            | Credit purchase confirmed, NFT mint event from Ponder, royalty written                                                                                   | Yes  | Most critical. SWR means: show cached value immediately, re-fetch in background. `staleTime: 60_000`, `gcTime: 300_000` in TanStack Query.                                                                                                                                             |
| `nft.getMyNFTs`                              | 5 min                       | 60 s per-user in-memory            | NFT mint event from Ponder (Ponder writes to Firestore on Transfer; server cache expires on the next request after a write)                              | Yes  | Ponder indexer lag: up to 15 s after on-chain mint before Firestore record exists. Client SWR means the cache may serve pre-mint data. Acceptable — NFT list staleness is not time-critical.                                                                                           |
| `licensing.getRoyaltyHistory`                | 2 min                       | 60 s per-user in-memory            | New royalty record written via `licensing.recordRoyalty` (server invalidates its own cache on write)                                                     | Yes  |                                                                                                                                                                                                                                                                                        |
| `credits.getHistory`                         | 30 s                        | Not cached server-side             | Any call to `credits.spend`, `credits.grant`, `credits.purchaseWithFiat`, `credits.purchaseWithLoar`                                                     | Yes  | Credit ledger is high-frequency — server does not cache to avoid serving stale transaction history. Client-side 30 s stale time is a reasonable balance.                                                                                                                               |
| `credits.getPackages`                        | 24 h                        | 24 h (in-memory or CDN edge cache) | Admin price change (manual cache bust via `admin.invalidatePackagesCache` procedure)                                                                     | No   | Package prices change at most monthly. 24-hour TTL is safe. Cache at CDN edge if possible (this endpoint does not require auth).                                                                                                                                                       |
| `quests.list`                                | 5 min                       | 2 min per-user in-memory           | Quest completion event, daily reset at UTC midnight (server invalidates all users' quest cache on daily reset job)                                       | Yes  |                                                                                                                                                                                                                                                                                        |
| `universeTreasury.getPoolHistory`            | 5 min                       | 2 min per-universe in-memory       | Treasury mutation (deposit, allocation, withdrawal)                                                                                                      | Yes  | Keyed per universeAddress, not per user.                                                                                                                                                                                                                                               |
| Push notification preferences                | 10 min                      | Not cached server-side             | `notifications.updatePreferences` mutation (TanStack Query mutation `onSuccess` calls `queryClient.invalidateQueries(['notifications.getPreferences'])`) | Yes  |                                                                                                                                                                                                                                                                                        |
| `$LOAR/USD` price feed                       | 5 min                       | Not applicable (external poll)     | N/A — external endpoint polled on TTL                                                                                                                    | No   | If the price feed returns an error or stale data (last update > 15 min ago), the client falls back to the last known price and marks `had_estimated_value: true` with a visual staleness indicator: a small clock icon next to "Est. value" with tooltip "Price data may be outdated." |
| `credits.getBalance` (post-purchase polling) | Do not cache during polling | Not cached                         | Invalidated by any credit mutation                                                                                                                       | No   | During the post-purchase polling loop, bypass cache entirely: `queryClient.fetchQuery({ queryKey, options: { staleTime: 0 } })`.                                                                                                                                                       |

#### On Sign-Out — Cache Clearing

When the user taps "Sign out" in the Wallet Management sheet, ALL cached data must be cleared before navigating to the auth screen. This is a security requirement (cached portfolio data of one user must not be visible to the next user who signs in on the same device) and a correctness requirement.

```typescript
// apps/mobile/src/lib/auth.ts

export async function signOut() {
  // 1. Clear TanStack Query cache — all queries, all pages
  queryClient.clear();

  // 2. Clear AsyncStorage portfolio cache
  await AsyncStorage.multiRemove([
    'portfolio_cache',
    'nft_cache',
    'earnings_cache',
    'push_permission_denied',
    // Remove all keys with the 'loar_' prefix
    ...(await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('loar_')),
  ]);

  // 3. Clear SecureStore auth data
  await SecureStore.deleteItemAsync('jwt');
  await SecureStore.deleteItemAsync('wallet_address');
  await SecureStore.deleteItemAsync('push_token');
  // DO NOT delete pending_recovery unless it is expired — allow recovery on next login

  // 4. Navigate to auth screen
  router.replace('/auth');
}
```

#### App Foreground Refetch Policy

When `AppState` changes to `'active'` (app comes to foreground from background or from lock screen):

| Query                             | Action on foreground                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio.getSummary`            | Refetch immediately, regardless of TTL. This is the most critical freshness requirement — the user expects to see their current balance when they return to the app. |
| `credits.getBalance`              | Refetch immediately. Credit balance is used in the balance card and the purchase flow — must be current.                                                             |
| `quests.list`                     | Refetch if `staleTime` has elapsed (5 min). If the app was only backgrounded for < 5 minutes, serve cached data.                                                     |
| `nft.getMyNFTs`                   | Rely on TTL (5 min). No immediate refetch — NFT ownership changes rarely.                                                                                            |
| `licensing.getRoyaltyHistory`     | Rely on TTL (2 min). No immediate refetch.                                                                                                                           |
| `universeTreasury.getPoolHistory` | Rely on TTL (5 min).                                                                                                                                                 |
| `credits.getHistory`              | Refetch immediately on foreground if the user is on the Activity tab; otherwise rely on TTL (30 s).                                                                  |
| Push notification preferences     | Rely on TTL (10 min).                                                                                                                                                |
| `credits.getPackages`             | Never refetch on foreground — 24-hour TTL, packages don't change.                                                                                                    |

Implementation: TanStack Query's `refetchOnWindowFocus` handles web. For React Native, use `AppState.addEventListener('change', ...)` in the tRPC/query provider:

```typescript
useEffect(() => {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      queryClient.invalidateQueries({ queryKey: ['portfolio.getSummary'] });
      queryClient.invalidateQueries({ queryKey: ['credits.getBalance'] });
      // Other immediate-refetch queries handled above
    }
  });
  return () => subscription.remove();
}, []);
```

#### `portfolio.getSummary` Server-Side Cache — Implementation Decision

**Option A: In-memory Map with TTL (single-instance)**

- Pros: zero latency, no external dependency, trivial implementation.
- Cons: breaks in multi-instance deployments. Each Fly.io machine has its own cache — a user round-robining across 2 machines gets potentially stale data half the time. Cache is lost on restart.
- Suitable for: pre-mainnet, single-machine deployment.

**Option B: Firestore document cache**

- Pros: consistent across instances, survives restarts, same infrastructure already in use.
- Cons: adds ~10–30 ms per cache read/write. Requires managing a `portfolioCache/{uid}` Firestore collection with TTL (Firestore TTL policy or manual `expiresAt` field).
- Suitable for: multi-instance deployments.

**Option C: Redis via Upstash**

- Pros: ~1 ms latency, consistent across instances, built-in TTL, supports atomic operations.
- Cons: external dependency, monthly cost (~$10–20 at expected scale).
- Suitable for: post-GA when `portfolio.getSummary` is at high volume.

**Recommendation:** Implement Option A (in-memory Map) for M1 launch. The Fly.io deployment is configured as a single instance per region for pre-mainnet. Add a `// TODO: migrate to Firestore cache before scaling to multiple instances` comment in the handler. When multi-instance becomes necessary (open beta scaling), migrate to Option B (Firestore). Option C is deferred until post-GA.

The in-memory cache implementation:

```typescript
// apps/server/src/lib/server-cache.ts

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class ServerCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  // Called after credit mutations to immediately invalidate a user's summary cache
  invalidateUser(uid: string): void {
    this.invalidate(`portfolio:summary:${uid}`);
    this.invalidate(`credits:balance:${uid}`);
  }
}

export const serverCache = new ServerCache();
// TODO: migrate to Firestore-backed cache before scaling to multiple instances
```
