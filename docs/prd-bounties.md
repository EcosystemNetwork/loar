# PRD: Story Bounties

> Status: Phase 1 restored (2026-05-16) — UI + routers + contract back on main; full-featured buildout in progress
> Priority: Required for the creator-economy launch loop (universe owners commission canon material from external creators)
> Owners: protocol (StoryBounties.sol), server (bounties router), web (/bounties/\*)

---

## Problem

LOAR's creator economy assumes universe owners want material they cannot personally produce — a specific character backstory, a side-story episode, a scene generated in a style they don't have access to. Today the only path is direct DM + off-chain payment + manual canon submission. Three things break:

1. **No price discovery** — there is no public surface where a universe owner can post "I will pay 500 $LOAR for an episode set in this character's youth, due in 2 weeks."
2. **No escrow** — payment trust is one-sided; either creator finishes work and hopes to be paid, or owner pays up-front and hopes for delivery.
3. **No on-chain reputation** — completing 50 paid bounties for major universes is exactly the credential an aspiring creator needs, and we throw it away.

Story Bounties closes all three. The MVP was built and removed (April 22, 2026) before Circle DCW landed. Restored May 16, 2026 — this PRD covers Phase 2 buildout (wiring into the post-DCW transaction stack, ContentLicensing, and the canon flow).

---

## Goal

Ship a fully-featured Story Bounties surface where:

1. Any universe owner (or universe Safe multi-sig) can **post a bounty** with a $LOAR escrow deposit and an open submission window.
2. Any creator can **submit work** against an open bounty (content hash + lineage + rights classification).
3. The owner can **award** the bounty to a winning submission — escrow releases atomically, platform fee taken, $LOAR transferred to the creator's Circle DCW wallet.
4. Awarded submissions are **automatically canonized** into the universe (skips the public vote when the universe owner is paying directly).
5. Every bounty action is visible on `/bounties` (browse), `/bounties/$id` (detail), and `/bounties/mine` (creator dashboard), with optional filters for universe / deadline / payout band.

---

## Non-Goals

- Dispute resolution / arbitration (mainnet only; testnet uses owner-final + on-chain audit)
- Multi-winner bounties (one award per bounty for v1; multi-prize is a future iteration)
- Cross-chain bounties (EVM-only for v1; Solana port tracked in `docs/prd-solana-parity.md`)
- Auto-matching creators to bounties via ML (manual browse for v1)

---

## Current State (post-restore, 2026-05-16)

| Surface                                                  | Status                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/contracts/src/revenue/StoryBounties.sol`           | Restored, UUPS proxy, 17 functions (post/cancel/submit/award/refund)                             |
| `apps/server/src/routers/bounties/`                      | Restored — list, get, create, submit, submissions, award, cancel, stats                          |
| `apps/web/src/routes/bounties/`                          | Restored — index, $bountyId, mine                                                                |
| Header link + UniverseSidebar button                     | Restored                                                                                         |
| `packages/abis/src/generated.ts`                         | `storyBountiesAbi` injected from feature/bounties (will be overwritten on next `wagmi generate`) |
| Deploy scripts (DeployAll, governance, transfer, verify) | Restored — `STORY_BOUNTIES_ADDRESS` env var threaded through                                     |
| Firestore collections (`bounties`, `bountySubmissions`)  | Never deleted — data is intact and reachable                                                     |

---

## Phase 2 — Buildout Items

### B1. Circle DCW transaction integration (P0)

The restored routes still call `useThirdwebWrite`-era patterns in places where they should now use `useCircleWrite` → `POST /api/tx/write`. Specifically:

- `bounties/create` UI button calls `StoryBounties.postBounty()` — must route via `useCircleWrite` (server-signed)
- `bounties/$id` "Submit" and "Award" buttons — same
- Submission fee (small flat $LOAR amount to prevent spam) — must use `executeSolanaTransaction` / Circle DCW for sponsored UX

**Files**: `apps/web/src/routes/bounties/index.tsx`, `$bountyId.tsx`, `mine.tsx`. Look for any direct `useContractWrite` / `useWriteContract` callsites and replace with `useCircleWrite`.

### B2. Auto-canonization on award (P0)

When a bounty is awarded, the winning submission should land in the universe's canon without going through the public-vote `marketplace.submit` flow. Owner-paid work is by-definition canon. Implementation:

1. Add `autoCanonize: boolean` field to the bounty record (default `true`)
2. On `bounties.award`, if `autoCanonize`, write a canonized submission record directly into `submissionsCol()` with `status: 'ACCEPTED'` and `originatedFrom: 'bounty:<bountyId>'`
3. Emit a server-side audit log entry: `bounty.awarded → canonized`
4. Add an event listener for `StoryBounties.BountyAwarded` to mirror the canonization on-chain (call `CanonMarketplace.acceptDirect()` from the owner Safe)

### B3. ContentLicensing integration (P1)

Awarded bounties produce derivative content. Today the submission's `classification` (fan / original / licensed) is captured at submit-time but not enforced against rights. Add:

- On submit: call `assertContentOperable()` and `assertContentClassified()` for the submission's contentId
- On award: write a `ContentLicensing` on-chain license record with `licensor = creator`, `licensee = universeOwner`, `royaltyBps = 0` (paid-out via bounty), `expiry = never`
- Surface the license on the submission detail page

### B4. Bounty notifications (P1)

Currently submissions are listed but creators get no signal. Add:

- Notify universe owner on each new submission (server → notifications router)
- Notify creator on award / rejection
- Notify all active submitters when a bounty is cancelled (with refund automatically issued)

### B5. Creator reputation surface (P2)

`/profile/$address` should show:

- "Bounties Completed" badge with count
- "Total Earned (Bounties)" in $LOAR
- Link to a public bounty history table

This is a join across `bountySubmissions.status='WON' + creatorUid` and the `bounties` collection. No new contract; pure server + UI.

### B6. Solana parity (P2 — tracked separately)

A Solana port of StoryBounties is out of scope for this PRD; it slots into the Solana Parity PRD (`docs/prd-solana-parity.md`) as a future Anchor program. Defer.

---

## Success Criteria

- A creator can browse `/bounties`, pick one, submit work (content hash + media), and see their submission listed within 5 seconds.
- A universe owner can post a bounty with $LOAR escrow, receive submissions, award one, and see the winning submission appear as canon on the universe wiki — all within one browser session with no manual transaction-builder steps.
- 100% of bounty-paid content carries an on-chain `ContentLicensing` record by 2026-06-30.
- Bounty operations show up in the `analytics` router (volume, average payout, creator participation) for the launch dashboard.

---

## Open Questions

1. Should a universe Safe's signers each have to co-sign a bounty award, or does the universe owner have direct authority? (Current default: universe owner alone; Safe-gated awards = future feature.)
2. Should bounty escrow earn LP staking yield while it sits? (Capital efficiency vs complexity — defer to Phase 3.)
3. Bounty visibility window — should expired-unfilled bounties auto-cancel + refund, or stay open indefinitely? (Default: auto-refund after `deadline + 7 days`.)
