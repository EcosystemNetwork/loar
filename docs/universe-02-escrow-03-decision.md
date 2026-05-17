# UNIVERSE-02 + ESCROW-03 — Pre-Mainnet Design Decisions

**Last updated:** 2026-05-16
**Status:** Recommendations for user sign-off.

These two items in [launch-readiness.md](launch-readiness.md) are flagged as "design call" rather than missing code. Both have a recommendation below — sign off and they close. Both are safe to **keep as-is for mainnet launch**.

---

## UNIVERSE-02 — Canon flag inconsistency after `setCanon`

### Current state

`Universe.sol:407-408` (per audit-fix-tracker) documents an O(1) trade-off: when `setCanon` promotes a node, sibling/ancestor nodes' `isCanon` field on the per-node struct is NOT eagerly swept. The contract's authoritative source for "what's canon right now" is the linked-list walk via `getCanonChain()`. Off-chain consumers (indexer, server, web) all read via `getCanonChain()`.

### The two options

| Option                          | Pros                                                                                                              | Cons                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Keep O(1)** (current)      | Constant-time `setCanon`. No gas cliff on long chains. Indexer already does the right thing. Documented + tested. | The per-node `isCanon` field is stale for non-current canon members. Any future direct-storage reader will be wrong.                                                                                                                      |
| **B. Walk-and-update refactor** | Direct `node.isCanon` reads are correct.                                                                          | O(n) gas on canon promotion. For a long-running universe (say 200 canon nodes), `setCanon` becomes a gas grenade and may exceed block limits. Forces pagination or chunked re-canonization, which is worse UX than the current trade-off. |

### Recommendation: **keep current O(1) design.**

**Why:** every consumer that exists today already uses `getCanonChain()`. The "wrong direct read" failure mode is hypothetical (no caller does this). The walk-and-update cost scales linearly with universe age — a 200-episode universe paying ~5M gas to canonize a new episode is materially worse than today's behavior.

**What to do:** add an interface-level lint to discourage direct `node.isCanon` reads on consumers. The audit-fix-tracker's existing documentation comment is sufficient hardening.

**What you'd revisit:** if the audit firm flags this as material in Pass 1, we either commit to `getCanonChain()`-only access patterns (declare per-node `isCanon` deprecated) or do the refactor with a per-call gas cap and an admin "rebuild canon" entry point.

---

## ESCROW-03 — `Escrow.resolveDispute` single-owner dictatorship

### Current state

`Escrow.resolveDispute` is `onlyOwner`. Pre-GOV-01 that's an EOA — a real centralization risk. Post-GOV-01 the owner is the `TimelockController`, which is itself proposer-gated by a 3/5 Safe with a 48-hour delay. So in production:

1. Safe signer proposes a `resolveDispute(...)` call.
2. 2 more Safe signers approve.
3. 48-hour Timelock delay elapses.
4. Anyone executes the queued tx.

That's a 3-signer multisig + 48h public-visibility delay — not "dictatorship" in any meaningful sense.

### The two options

| Option                                  | Pros                                                                                                                                                | Cons                                                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Accept current model post-GOV-01** | Zero new code. 3/5 Safe + 48h delay is a real mitigation. Disputes are low-volume at testnet scale; "ask Safe signers" is operationally reasonable. | Counterparties to a dispute have to trust the Safe to act fairly. No on-chain appeal path.                                                                                                                                                                           |
| **B. Build a DAO appeal path**          | Disputed parties can escalate to a Governor vote or 7-day veto window.                                                                              | Adds 1–2 weeks of dev + audit surface. Governor-based dispute resolution is itself an attack vector at low-quorum (a flash-borrowed token bag could overturn a legitimate fraud ruling). Designing a sound appeal flow takes longer than the launch timeline allows. |

### Recommendation: **accept current model for mainnet launch.** Treat option B as a Year-2 governance upgrade.

**Why:** 3/5 Safe + 48h Timelock is industry-standard for v1 escrow contracts (Uniswap V2 admin was similar at launch). The dispute incident rate at testnet beta is low enough that the operational answer ("Safe signers convene if a dispute is raised") is acceptable. A poorly-designed DAO appeal is worse than no DAO appeal — flash-loan voting on dispute resolution is a documented attack pattern (e.g., MakerDAO 2020).

**What to do:**

1. Once GOV-01 lands, **publish the Safe signer roster** + an SLA ("disputes resolved within 5 business days of a Safe proposal") on the LOAR public docs.
2. Add a Telegram/Discord channel for dispute escalation — operational, not on-chain.
3. Year-2 governance upgrade: a `proposeEscrowAppeal(disputeId)` flow with a 7-day veto window from a quorum of stakers (`LaunchpadStaking.totalStaked`-weighted). Defer the implementation until there's enough staker base to make quorum non-trivially manipulable.

**What you'd revisit:** if Pass 1 audit flags this as a launch blocker, the fastest path is to add a `proposeAppeal()` function that triggers a 14-day "objection" window where the original ruling can be undone by `>= 50% of LaunchpadStaking.totalStaked()` voting against it. The 14-day window is long enough to deter flash loans (no loan stays open 14 days) but short enough that disputes resolve in practice.

---

## Sign-off

Both recommendations are conservative: ship what we have, document the trade-offs, address in audit Pass 2 only if flagged. If you agree, mark C3 and C4 closed in [launch-readiness.md](launch-readiness.md) with a pointer to this doc. If you disagree on either, the option-B path is described above and is ~1–2 weeks of work each.
