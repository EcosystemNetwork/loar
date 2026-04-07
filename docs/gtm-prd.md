# LOAR — Go-to-Market PRD

## The Core Problem

The stack is production-grade. The public story isn't. The domain shows a "BedTime Stories" page. The README describes a narrative-control suite. The app is a cinematic universe studio. These describe three different products. Until they describe one product, every demo, investor pitch, and press mention will confuse the audience before they see a single feature.

The secondary problem: the revenue loop is broken at the last step. Backend APIs, smart contracts, and IP classification all exist. No frontend lets a wallet actually pay for anything. That is a wiring problem, not an architecture problem — it takes days, not months.

---

## Positioning

**What LOAR is:**

> An AI cinematic universe studio for original IP creators. Build, publish, and tokenize your story world — characters, episodes, timelines, governance — on-chain.

**What LOAR is not (for launch):**

> A broad fan fiction or parody platform. A licensed franchise remix engine. A ten-revenue-stream marketplace.

**Why this framing wins:**

- Original IP is the legally clean lane. No rights negotiations, no DMCA exposure at launch.
- The stack already does this — universe deployment, AI generation, NFT minting, token governance are all working end-to-end except the payment buttons.
- "Original IP studio" maps cleanly to a creator audience that understands IP ownership because they care about owning their own work.
- Fan/parody content can exist as a free sandbox lane without being the lead product story.

---

## Public Narrative Alignment (Do First)

These four surfaces need to describe the same product before any other work:

| Surface                       | Current state                  | Required state                                                                     |
| ----------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| Domain / landing page         | "BedTime Stories" placeholder  | LOAR cinematic universe studio — original IP creator pitch, demo universe showcase |
| README                        | Technical monorepo description | Product description first, then technical stack                                    |
| In-app home                   | Generic page                   | Universe gallery + "Create Universe" CTA as primary action                         |
| Any deck / external materials | Unknown                        | Must match the above before sharing                                                |

This is not a marketing task. This is a prerequisite for any user arriving from any source.

---

## Phase 1: Close One Transaction Loop

**Target loop:** Creator lists an Episode NFT → fan discovers it → fan mints it with ETH.

This is the loop the MVP doc already identifies as broken at Step 7. It requires no new backend work. The `nft.createEpisodeListing` and `nft.recordMint` procedures exist. The `Universe.sol` contract is deployed on Sepolia. The gap is four UI elements:

| Missing element                              | Location                               | Wire to                                  |
| -------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| "List as NFT" button on timeline node detail | `SceneEditor.tsx` or node detail panel | `nft.createEpisodeListing` mutation      |
| Episode NFT card with mint price + supply    | Universe marketplace tab               | `nft.getEpisodesByUniverse` query        |
| "Mint" button with wallet transaction        | Episode card                           | wagmi `writeContract` → `nft.recordMint` |
| Creator earnings summary                     | Creator dashboard                      | `nft.getMyNFTs` query                    |

**Why this loop and not another:**

- Episode NFT is the cleanest atomic transaction: one creator action, one fan action, one on-chain event, verifiable result.
- Credit purchase is also close (1-2 days per `docs/mvp.md`) but requires a creator to already have a universe to spend credits on, making it step two.
- Subscription requires recurring infrastructure that doesn't yet exist in the frontend.
- Canon voting requires social dynamics that need users first.

**Definition of done for Phase 1:**

1. A creator on Sepolia can generate an AI video, attach it to a timeline node, and list it as an NFT with a price.
2. A different wallet can find that listing in the discovery feed and mint it.
3. The mint transaction confirms on Sepolia and appears in the creator's earnings summary.
4. The IP classification badge is visible on the listing (see Rights Classification UI Spec).

---

## Phase 2: Make the Product Legible to Outsiders

After Phase 1 closes the loop, the product needs to be legible to three audiences: early creators, fans, and investors. Each needs different evidence.

**For early creators:**

- Onboarding flow: guided first universe (connect wallet → name universe → generate first clip → publish → share link). Target: under 10 minutes.
- Creator dashboard with real data (replace hardcoded placeholders with `cinematicUniverses.getByCreator()` and `analytics.getUniverseMetrics()`).
- Rights classification clearly shown on their own content.

**For fans:**

- Discovery feed sorted by activity, not creation date.
- Universe detail page with playable clips, character roster, and mint/subscribe actions.
- Wallet not required to browse; required only to transact.

**For investors:**

- One working transaction on testnet they can complete themselves.
- Metrics visible in the admin panel (total universes, total mints, credit purchases, active wallets).
- Rights classification system as evidence of IP hygiene.

---

## Phase 3: Pre-Mainnet Gates (Do Not Skip)

These are not optional. None of them should block Sepolia testing but all of them block real money:

| Requirement                                          | Status      | Blocker if missing                                         |
| ---------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| Smart contract audit (third-party)                   | Not started | Cannot hold real ETH in contracts                          |
| DMCA agent registration + notice/counter-notice flow | Not built   | No Section 512 safe harbor                                 |
| Content flagging + review queue                      | Not built   | No mechanism to respond to infringement complaints         |
| Real-person consent/likeness policy                  | Draft only  | California statutory damages exposure on public UGC        |
| Fiat on-ramp                                         | Not built   | Limits addressable market to crypto-native users           |
| Proactive similarity scanning                        | Not built   | Reduces but doesn't eliminate infringing monetized content |

**Minimum viable compliance for mainnet:**

1. DMCA designated agent registered with US Copyright Office.
2. Takedown request form with 72-hour acknowledgment SLA.
3. Counter-notice flow documented in ToS.
4. Real-person and likeness policy in ToS with creator attestation checkbox at universe creation.
5. Manual review queue for flagged content (can be email-based at launch).

---

## What Not to Do at Launch

- **Do not lead with ten revenue streams.** One working loop is more credible than ten described ones. Add revenue streams after Phase 1 validates the first.
- **Do not tell creators "AI output belongs to you."** The correct language is: "LOAR treats you as the rights claimant for content you generate on this platform, subject to applicable law and third-party rights." The distinction matters when challenged.
- **Do not present the fan/parody lane as legally cleared.** Fair use is a case-by-case defense. The platform can permit non-commercial fan work, but it cannot promise fair use protection.
- **Do not accept monetized third-party franchise content on the claim that it's "transformative."** That determination belongs to courts. The licensed IP lane (Phase 4+) requires documentary proof, not checkbox attestation.
- **Do not open public UGC monetization before DMCA infrastructure is live.** The safe harbor only protects you if you have the process in place.

---

## Lane Structure (Connects to Rights Classification UI)

Three content lanes are the backbone of every product decision from here forward:

| Lane                    | Classification value | Monetization                         | IP requirement                                       |
| ----------------------- | -------------------- | ------------------------------------ | ---------------------------------------------------- |
| Personal / Fan / Parody | `fan`                | None                                 | None — platform permits, does not guarantee fair use |
| Creator-Owned           | `original`           | All (NFT, subscribe, license, merch) | Originality attestation + provenance log             |
| Rights-Cleared          | `licensed`           | All (with documented scope)          | Uploaded license agreement, manual review            |

The existing binary (`fun` / `monetized`) maps to the first two lanes. The third lane (`licensed`) is deferred until manual review infrastructure is in place. For launch, `licensed` content is treated as `original` with an additional `licensingProof` field that triggers a review queue.

See `docs/rights-classification-ui.md` for the complete UI spec.

---

## Success Metrics for Phase 1

| Metric                                                        | Target                     |
| ------------------------------------------------------------- | -------------------------- |
| First creator who is not the team deploys a universe          | Week 1 of public beta      |
| First mint transaction by a wallet that is not the creator    | Week 2                     |
| Total mints in first 30 days                                  | 100                        |
| Creator conversion rate (wallet connected → universe created) | >30%                       |
| Mint conversion rate (universe viewed → mint transaction)     | >5%                        |
| DMCA complaints received with no resolution process           | 0 (ship the process first) |
