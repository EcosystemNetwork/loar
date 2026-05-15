# LOAR — Go-to-Market PRD

**Last refreshed:** 2026-05-15 — reconciled against actual shipped state.
**Canonical "what's left" page:** [docs/launch-readiness.md](./launch-readiness.md).

> **Status note.** This document was originally written 2026-03-27 when the home page was a "BedTime Stories" placeholder and the Episode NFT mint loop had four missing UI wires. Almost all of that shipped. The phase tables below are kept for historical record, but anything marked **SHIPPED** has moved to the [Launch Readiness Scorecard](./launch-readiness.md); the remaining real work is operational + legal handoffs, not feature implementation.

---

## Positioning (still canonical)

**What LOAR is:**

> An AI cinematic universe studio for original IP creators. Build, publish, and tokenize your story world — characters, episodes, timelines, governance — on-chain.

**What LOAR is not (for launch):**

> A broad fan fiction or parody platform. A licensed franchise remix engine. A ten-revenue-stream marketplace.

**Why this framing wins:**

- Original IP is the legally clean lane. No rights negotiations, no DMCA exposure at launch.
- The stack does this end-to-end — universe deployment, AI generation, NFT minting, token governance, rights classification, on-chain governance.
- "Original IP studio" maps cleanly to a creator audience that understands IP ownership because they care about owning their own work.
- Fan/parody content exists as a free sandbox lane via the `fan` rights enum, not the lead product story.

---

## Phase 0: Public narrative alignment — **SHIPPED**

| Surface               | Then (Mar 2026)                | Now (May 2026)                                                                                                                                                                                    |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain / landing page | "BedTime Stories" placeholder  | Netflix × Webtoons hybrid universe gallery at [apps/web/src/routes/index.tsx](../apps/web/src/routes/index.tsx) — hero billboard, trending row, recent episodes, all universes, token-powered row |
| README                | Technical monorepo description | Product description leads; honest LIVE / PARTIAL / PLANNED status table; live testnet demo link                                                                                                   |
| In-app home           | Generic page                   | Universe gallery + "Create Universe" CTA primary                                                                                                                                                  |

---

## Phase 1: Episode NFT transaction loop — **SHIPPED**

Original gap (four UI elements). Current state:

| Element                                   | Then          | Now                                                                                              |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| "List as NFT" button on node detail       | Missing       | `MintContentDialog` wired in node detail panel and `RevenuePanel`                                |
| Episode NFT card with mint price + supply | Missing       | Renders in marketplace tab, sourced from `nft.getEpisodesByUniverse`                             |
| Mint button with wallet tx                | Missing       | `BuyNFTDialog` invokes `writeContract` + records via `nft.recordMint` with revenue splits        |
| Creator earnings summary                  | Missing       | Dashboard surfaces `analytics.getUniverseMetrics` (views / mints / subs / votes / revenue chips) |
| Atomic batch listing                      | Not specified | `BatchMintEpisodesDialog` up to 50 per batch                                                     |

The loop runs end-to-end on Sepolia + Base Sepolia today.

---

## Phase 2: Make the product legible to outsiders — **MOSTLY SHIPPED**

| Audience       | Need                                                                 | State                                                                                            |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Early creators | Guided first universe (connect → name → generate → publish), <10 min | Universe create + atomic `createUniverseWithToken()`, chain selector UI, multi-step deploy flow  |
| Early creators | Creator dashboard with real data                                     | `analytics.getUniverseMetrics`, LP yield manager, quests panel, monetization overview — all live |
| Early creators | Rights classification on own content                                 | Live — `fan` / `original` / `licensed` enum + `<ContentLaneBadge />`                             |
| Fans           | Discovery feed sorted by activity                                    | `/discover` queries `content.feed` with rights filter, activity sort                             |
| Fans           | Wallet not required to browse                                        | Browse anonymous; auth-gated only at transact                                                    |
| Investors      | One working testnet tx they can complete                             | Sepolia mint loop is operational                                                                 |
| Investors      | Admin metrics                                                        | `/admin` panels for cost, moderation, activity. `/admin/cost` has per-provider margin gauges     |
| Investors      | Rights classification as IP hygiene evidence                         | Visible per content card; review queue for `licensed` lane                                       |

Open items in this phase are minor (subscription renewal reminders, push notifications to mobile) — see PARTIAL rows in README.

---

## Phase 3: Pre-mainnet gates — **MOSTLY SHIPPED, OPS + LEGAL REMAIN**

The original GTM PRD listed six gates. Updated status:

| Original gate                                        | State                                                                                                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart contract audit (third-party)                   | Internal: 8 review passes, 130/157 findings fixed. External Pass 1 + Pass 2 still required — see X5/X6/X7 in [scorecard](./launch-readiness.md)                                                     |
| DMCA agent registration + notice/counter-notice flow | **Counter-notice loop SHIPPED** (§ 512(g) full implementation, business-day arithmetic, three statutory email templates). Agent-of-record registration ($6 filing) still external — X2 in scorecard |
| Content flagging + review queue                      | SHIPPED — `/admin/moderation`, immutable `contentAuditLog`                                                                                                                                          |
| Real-person consent / likeness policy                | Counsel needed — X4 in scorecard                                                                                                                                                                    |
| Fiat on-ramp                                         | Stripe integrated; broader on-ramp deferred — X10 in scorecard                                                                                                                                      |
| Proactive similarity scanning                        | **CSAM SHIPPED** — pHash + PhotoDNA + Hive AI gate every upload. Broader similarity (non-CSAM) deferred post-launch                                                                                 |

**Total remaining for mainnet** (per [scorecard](./launch-readiness.md)):

- 11 operational handoffs (you trigger — multisig deploy, env flags, signer onboarding)
- 13 external dependencies (legal counsel, audit firms, BD partners, app store review)
- 4 small internal code items (docs, design calls)

None of these block testnet beta or current Sepolia + Base Sepolia operations.

---

## What not to do at launch

- **Do not lead with ten revenue streams.** One working loop is more credible than ten described ones. The Episode NFT loop is that working loop today.
- **Do not tell creators "AI output belongs to you."** Correct language: "LOAR treats you as the rights claimant for content you generate on this platform, subject to applicable law and third-party rights." The distinction matters when challenged. Captured in `/terms`.
- **Do not present the fan/parody lane as legally cleared.** Fair use is a case-by-case defense. The platform permits non-commercial fan work, doesn't promise fair use protection.
- **Do not accept monetized third-party franchise content on a "transformative" claim.** That determination belongs to courts. The `licensed` lane requires documentary proof + manual review queue, not checkbox attestation.
- **Do not deploy to Base mainnet before** the external audit Pass 1 + Pass 2, multisig handoff (GOV-01), DMCA agent registration, and TimelockFactory wiring (TIMELOCK-01). See [scorecard](./launch-readiness.md).

---

## Lane structure (still canonical)

| Lane                    | Classification value | Monetization                         | IP requirement                                       |
| ----------------------- | -------------------- | ------------------------------------ | ---------------------------------------------------- |
| Personal / Fan / Parody | `fan`                | None                                 | None — platform permits, does not guarantee fair use |
| Creator-Owned           | `original`           | All (NFT, subscribe, license, merch) | Originality attestation + provenance log             |
| Rights-Cleared          | `licensed`           | All (with documented scope)          | Uploaded `licensingProof` + `reviewStatus` queue     |

All three are wired in [apps/web/src/routes/discover.tsx](../apps/web/src/routes/discover.tsx) with `<ContentLaneBadge />`.

---

## Success metrics for the first public beta cohort

Original Phase 1 metrics still applicable as KPIs for the public beta:

| Metric                                                        | Target                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| First creator who is not the team deploys a universe          | Week 1 of public beta                                  |
| First mint transaction by a wallet that is not the creator    | Week 2                                                 |
| Total mints in first 30 days                                  | 100                                                    |
| Creator conversion rate (wallet connected → universe created) | >30%                                                   |
| Mint conversion rate (universe viewed → mint transaction)     | >5%                                                    |
| DMCA complaints received with no resolution process           | 0 (process is shipped, runbook in `/admin/moderation`) |

---

## Where to look next

- **For what's left** → [docs/launch-readiness.md](./launch-readiness.md)
- **For per-finding audit status** → [docs/audit-fix-tracker.md](./audit-fix-tracker.md)
- **For the Phase 1 / Phase 2 split with current code citations** → [docs/pre-launch-checklist.md](./pre-launch-checklist.md)
- **For Solana mainnet sequencing** → [docs/solana-mainnet-runbook.md](./solana-mainnet-runbook.md)
- **For rights classification UI** → [docs/rights-classification-ui.md](./rights-classification-ui.md)
