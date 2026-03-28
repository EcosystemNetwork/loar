# PRD: Revenue Loop Closure

**Status:** Draft — 2026-03-28
**Track:** Alpha Hardening (parallel workstream 2 of 10)
**Effort:** 5–7 days

---

## Problem

Every revenue surface in LOAR has a working backend API and deployed Sepolia contract. None of them have a transactable frontend. The marketplace page is informational UI — tab cards that explain revenue streams without letting a wallet actually execute one.

From `docs/product-loops.md`:

> **Loop 4: Monetization — Status: 15% WORKING (on frontend)**
> Every revenue stream: display only or placeholder.

From `docs/mvp.md`:

> Step 7 — Earn Revenue: BROKEN. No purchase/mint flow on frontend.

An outside creator cannot complete the core loop. An investor demo question — "can someone buy something?" — has no answer. This is a wiring problem, not an architecture problem. The contracts and APIs are ready.

---

## Goal

Close one complete creator-to-fan revenue loop on the frontend so that:

1. A creator can list an Episode NFT
2. A fan can discover it and mint it with ETH
3. The creator receives royalties on-chain
4. Credits can be purchased and deducted for AI generation

Secondary: fix the dashboard so creators see their actual universes, not dummy data.

---

## Scope

### In scope (must-have for M1)

- Episode NFT: list + mint/buy transaction flow
- Character NFT: mint transaction flow
- Credit purchase flow (ETH-based, no fiat yet)
- Dashboard universe list wired to real API data
- Canon marketplace: submission form + token-weighted voting UI

### In scope (should-have for M1)

- Subscription purchase flow (basic subscribe button → `subscriptions.subscribe()`)
- Governance voting completion (GovernanceSidebar proposal creation + vote casting)

### Out of scope

- Fiat payments (Stripe/MoonPay) — M3
- Collab, Ad, IP Licensing, Merch marketplace tabs — M2
- Swap UI for universe tokens — M2

---

## Deliverables

### 1. Episode NFT — Mint / Buy Flow

**Where:** `apps/web/src/routes/marketplace/` — Episode NFTs tab

**What to build:**

- Query `marketplace.listEpisodeNFTs(universeAddress)` from the tRPC router to populate a grid of listed episodes
- Each card shows: title, creator, price (ETH), supply remaining
- "Mint" button calls the EpisodeNFT contract's `mint()` function via wagmi `useWriteContract`
- Transaction lifecycle: idle → pending (user confirms in wallet) → confirming (waiting for block) → success/error
- On success: show tx hash with Etherscan Sepolia link, update local supply count

**Component structure:**

```
EpisodeNFTTab
  ├── EpisodeNFTGrid (query + layout)
  │     └── EpisodeNFTCard (display + mint button)
  └── MintTransactionToast (tx lifecycle feedback)
```

**ABI:** Use generated wagmi hooks from `packages/abis`. If ABI is stale (contracts README notes it needs regeneration), the engineer must run `forge build && npx wagmi generate` first.

### 2. Character NFT — Mint Flow

**Where:** `apps/web/src/routes/marketplace/` — Character NFTs tab

Same pattern as Episode NFTs but calls `CharacterNFT.mint()`. Character NFTs have appearance royalties — the card should show royalty % alongside price.

### 3. Credit Purchase Flow

**Where:** `apps/web/src/routes/marketplace/` — Credits tab (currently shows balance + tier display only)

**What to build:**

- Tier selection grid (Free / Creator / Pro / Studio) — already rendered, needs interactive selection state
- "Purchase Credits" button calls `credits.purchase({ tier, amount })` tRPC mutation
- For testnet: ETH transfer to platform treasury address, not fiat
- On success: refresh `credits.getBalance()` and show updated balance

**Important:** Credit purchase is gated behind wallet auth. Non-authenticated users should see a "Connect wallet to purchase" prompt, not a broken form.

### 4. Dashboard — Real Universe Data

**Where:** `apps/web/src/routes/dashboard/index.tsx` (or equivalent)

**What to fix:**

- Replace hardcoded universe array with `cinematicUniverses.getByCreator({ creatorAddress })` tRPC query
- Show real universe names, token addresses, creation dates
- If the creator has no universes, show an empty state with a "Create Universe" CTA
- Display real generation credit balance from `credits.getBalance()`

This is a 1-day fix. No new UI components needed — just replace the mock data source.

### 5. Canon Marketplace — Submission + Voting

**Where:** `apps/web/src/routes/marketplace/` — Canon tab

**What to build:**

_Submit Canon Proposal form:_

- Text area: proposal title + description
- Universe selector (from creator's universes)
- Submit calls `marketplace.submitCanon({ universeAddress, title, description })`
- Transaction confirmation: canon submission is on-chain

_Voting UI:_

- List of active proposals from `marketplace.listCanonProposals(universeAddress)`
- Each proposal shows: title, description, vote counts (for/against), time remaining
- "Vote For" / "Vote Against" buttons call `marketplace.voteOnCanon({ proposalId, support })`
- Vote weight is proportional to governance token balance (shown next to buttons)

### 6. Subscription Purchase

**Where:** `apps/web/src/routes/marketplace/` — Subscriptions tab

- "Subscribe" button on each tier calls `subscriptions.subscribe({ universeAddress, tierId })`
- Active subscriptions show "Subscribed" badge with expiry date
- Creators see their subscriber count per tier from `subscriptions.getStats()`

### 7. GovernanceSidebar — Proposal Creation + Voting

**Where:** `apps/web/src/components/GovernanceSidebar.tsx`

**Currently:** Shows token holder info and static governance stats. Voting and proposal creation are display-only stubs.

**What to wire:**

- "Create Proposal" form: description + actions array → `useWriteContract` calling `Governor.propose()`
- Proposal list: pull from Ponder GraphQL `proposals` table, show state (active/succeeded/defeated/executed)
- "Vote" buttons: `Governor.castVote(proposalId, support)` via wagmi
- Delegation button: `GovernanceToken.delegate(delegatee)` — currently `useERC20Governance` hook is empty

---

## Transaction Lifecycle Pattern

All write operations across every deliverable above must follow this state machine consistently:

```
idle
  → user clicks action button
waiting_wallet    (spinner: "Confirm in wallet")
  → user approves in wallet
pending           (spinner: "Transaction submitted...", show tx hash)
  → block confirms
success           (toast: "Done!", show Etherscan link)
  OR
error             (toast: error message, "Try again" button)
  → user dismisses
idle
```

Do not build bespoke state per component. Extract a `useTxLifecycle(writeContractResult)` hook that maps wagmi's `useWriteContract` status to this model and returns `{ state, errorMessage, txHash }`. All marketplace components consume this hook.

---

## Testing

Each wired flow must have at minimum one Vitest integration test:

| Test                          | What it verifies                                                  |
| ----------------------------- | ----------------------------------------------------------------- |
| `episode-nft-mint.test.ts`    | `mint()` called with correct args when button clicked             |
| `credits-purchase.test.ts`    | `credits.purchase` mutation called on submit                      |
| `dashboard-universes.test.ts` | Dashboard queries real API, not dummy array                       |
| `canon-submit.test.ts`        | Canon proposal form calls `submitCanon` on submit                 |
| `canon-vote.test.ts`          | Vote buttons call `voteOnCanon` with correct proposalId + support |

Use wagmi's test utils and tRPC's `createCallerFactory` for server-side tests.

---

## Accept When

- [ ] A non-team wallet on Sepolia can: connect → find an Episode NFT listing → click Mint → confirm tx → see success with Etherscan link
- [ ] A creator can list an Episode NFT and see it appear in the Episode NFT tab
- [ ] Credits tab shows real balance; purchase flow completes without error
- [ ] Dashboard shows creator's real universes (zero empty-state shown for new creator)
- [ ] Canon tab: creator can submit a proposal; token holder can vote on it
- [ ] All five new integration tests pass in CI
- [ ] No revenue tab shows placeholder text as its only content
