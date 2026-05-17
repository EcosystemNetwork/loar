# PRD: Agents Tab — AI Agents, Talent Agents, Pipelines, API Keys

> Status: Phase 1 restored (2026-05-16) — all 4 routers + services + UI back on main; Phase 2 buildout in progress
> Priority: Strategic differentiator — turns LOAR from "creator tool" into "autonomous creator platform"
> Owners: server (aiAgents/talentAgents/aiPipelines/apiKeys routers), services (agentAuth, aiAgentCredits, pipelineExecutor), web (/agents/\*), mcp (4 agent tool defs)

---

## Problem

LOAR's content pipeline is human-operated end-to-end: a creator opens the studio, fills in prompts, picks models, kicks off generations, reviews, mints, lists. Every step needs a human in the loop. Two creator personas are blocked by this:

1. **Studio operators** (someone running 10+ universes) — they can't scale. Each universe needs the same daily-content cadence and the operator becomes a bottleneck.
2. **Talent agents** (real-world equivalent: managers / agencies) — they manage 20 client creators and want to offer "we'll run your AI universe for you" as a service, with revenue-share and contract terms enforced on-chain.

The Agents surface answers both. **AI Agents** are autonomous executors that run pre-configured pipelines on a schedule with a budget. **Talent Agents** are human operators who sign contracts with creators to manage their universe (with on-chain commission terms). **Pipelines** are reusable multi-step recipes (generate → review → mint → list → tweet) that either kind of agent can execute. **API Keys** let external tools (Zapier, custom scripts, MCP servers) drive any of the above without holding the user's wallet.

Restored May 16, 2026 after removal April 22. This PRD covers Phase 2 — wiring into Circle DCW (so AI agents can sign on behalf of users), BYOK (so agents pay with the universe owner's API keys, not platform credits), and Solana (so agents can act cross-chain).

---

## Goal

Make every action a human creator can take available to an autonomous agent or a delegated talent agent:

1. **AI Agent**: a stored "persona + budget + pipeline assignment" record that the server can execute on behalf of its owner — generation, listing, canon submission, replies to comments, etc.
2. **Pipeline**: a YAML-like recipe (sequence of MCP tool calls + decision nodes) that AI agents follow. Authored visually in `/agents/dashboard` → "Pipelines" tab.
3. **Talent Agent**: a public profile (verified human operator) that can be matched to creators via `talentAgents.discover`, and that can be granted `onBehalfOfUid` permission via signed contracts.
4. **API Keys**: scoped, revocable tokens (with per-permission grants) that external software can use to drive any of the above without exposing the wallet.

All four are restored; Phase 2 connects them to the live transaction stack.

---

## Non-Goals

- LLM-orchestrated open-ended autonomy (agents follow declared pipelines, not freeform reasoning)
- Marketplace of pre-built pipelines (planned for Phase 3 — Phase 2 is creator-authored only)
- Talent Agent on-chain dispute resolution (off-chain mediation only on testnet)
- Solana-native pipelines (Phase 3; Phase 2 keeps execution on EVM via Circle DCW)

---

## Current State (post-restore, 2026-05-16)

| Surface                                                                                                                                                                  | Status                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/routers/aiAgents/`                                                                                                                                      | Restored — 10 procedures (create/update/pause/resume/delete/get/listByUniverse/listByOwner/allocateBudget/getUsage)                                      |
| `apps/server/src/routers/aiPipelines/`                                                                                                                                   | Restored — 8 procedures (create/update/delete/get/listByAgent/run/getRun/listRuns)                                                                       |
| `apps/server/src/routers/apiKeys/`                                                                                                                                       | Restored — 5 procedures (create/list/revoke/getUsage/availablePermissions)                                                                               |
| `apps/server/src/routers/talentAgents/`                                                                                                                                  | Restored — 10 procedures (register/updateProfile/getProfile/myProfile/discover/proposeContract/acceptContract/terminateContract/getContract/myContracts) |
| `apps/server/src/services/agentAuth.ts`                                                                                                                                  | Restored — `resolveActingUid(callerUid, onBehalfOfUid, scope)`                                                                                           |
| `apps/server/src/services/aiAgentCredits.ts`                                                                                                                             | Restored — agent-scoped credit ledger                                                                                                                    |
| `apps/server/src/services/pipelineExecutor.ts`                                                                                                                           | Restored — runs pipelines step-by-step against the MCP tools                                                                                             |
| `apps/web/src/routes/agents/`                                                                                                                                            | Restored — index, dashboard, register, $uid                                                                                                              |
| `apps/web/src/components/agents/`                                                                                                                                        | Restored — 5 components (AIAgentCreator, AgentContractModal, ApiKeyManager, PipelineBuilder, UniverseAgentPanel)                                         |
| `apps/web/src/hooks/`                                                                                                                                                    | Restored — useAIAgents, useAIPipelines, useApiKeys, useTalentAgents                                                                                      |
| `apps/mcp/src/tools.ts`                                                                                                                                                  | Restored — 4 tool defs (listAIAgents, runPipeline, getPipelineRun, discoverTalentAgents)                                                                 |
| `apps/server/src/routers/marketplace/marketplace.routes.ts`                                                                                                              | `onBehalfOfUid` re-added to `submit` and `licenseCanon`                                                                                                  |
| Firestore collections (aiAgents, talentAgentProfiles, aiAgentCredits, aiAgentPipelines, aiAgentPipelineRuns, universeAgentAssignments, agentContracts, agentCommissions) | Never deleted — data is intact                                                                                                                           |

---

## Phase 2 — Buildout Items

### G1. AI Agent server-signs via Circle DCW (P0)

Pipeline steps that touch the chain currently assume the user is browsing and can pop a wallet. AI agents are headless. Add:

- `pipelineExecutor.ts` should resolve the agent's owner → call the owner's Circle DCW wallet for any tx (mint, list, license, accept).
- Server-side rate-limit: an AI agent cannot trigger more than its allocated daily budget (already tracked via `aiAgentCredits`).
- New permission: `tx.signOnBehalfOfOwner` granted only to AI agents (not Talent Agents, who must request signature each time).

### G2. `onBehalfOfUid` propagated to all monetization endpoints (P0)

Marketplace.submit and licenseCanon already accept `onBehalfOfUid`. The same wiring is needed on:

- `listings.create` / `listings.updatePrice` (NFT listings)
- `nft.mint` (primary mint via agent)
- `subscriptions.create` / `subscriptions.cancel`
- `licensing.create` / `licensing.transfer`
- `bounties.create` / `bounties.award` (per the bounties PRD)
- `ads.placeBid` / `ads.acceptBid`

Pattern: add `.optional()` `onBehalfOfUid` to input schema, call `resolveActingUid(ctx.user.uid, input.onBehalfOfUid, '<router-scope>')`, and use the returned `actingUid` for the operation's creator/owner field.

### G3. BYOK propagation (P1)

When an AI agent runs a generation step, who pays for the model call? Today: the agent's `aiAgentCredits` budget (platform-funded). The BYOK system landed after agents were removed — now there is a "bring your own API key" flow per generation provider.

- Pipeline steps should respect `useBYOK: boolean` per agent
- When true: read the owner's stored API keys (`userSecrets` router) for each provider and inject them into the generation call
- When false: deduct from `aiAgentCredits` ledger as today
- Surface BYOK toggle in the AIAgentCreator UI

### G4. Talent Agent contract execution (P1)

Talent Agents register, propose contracts, and accept contracts today — but the contract terms (commission %, scope, duration) are stored in Firestore only. Add:

- A new contract `agreements/TalentAgentContract.sol` (UUPS proxy, deployed once per contract acceptance) that:
  - Holds the agreed commission BPS (e.g., 1500 = 15%)
  - Receives the talent agent's share of any monetization triggered while they hold the contract
  - Auto-routes platform fee + creator share + agent share on each operation
- `talentAgents.acceptContract` deploys the contract and stores its address
- All `onBehalfOfUid`-flagged earnings while a contract is active flow through this contract for split

This is the highest-value buildout — it makes talent agency real on-chain.

### G5. MCP tool exposure for external automation (P1)

The 4 tool defs are restored. Expand to cover the full surface:

- `loar_create_ai_agent`, `loar_update_pipeline`, `loar_create_api_key` (admin / owner only)
- Add an API-key auth path in `apps/mcp/src/server.ts` so external MCP clients can hold a scoped key and call any tool the key grants

### G6. Solana wallet support for agents (P2)

AI Agents currently sign EVM only. Adding Solana means:

- `pipelineExecutor.ts` branches on the target chain per step
- New helper: `executeSolanaTransactionAsAgent(ownerUid, instructions)` — uses the owner's Circle DCW Solana wallet
- Pipeline schema gains a `chain: 'evm' | 'solana'` per step

Defer until the Solana parity rollout reaches mainnet (per `docs/prd-solana-parity.md`).

---

## Success Criteria

- A creator can set up an AI agent (`/agents/register`), build a pipeline (`PipelineBuilder`), allocate a $LOAR budget, and have the agent autonomously produce + list 1 episode/day for 7 days with zero human intervention.
- A talent agent can sign a 15% commission contract with a creator, and earn measurable on-chain commission flowing into their wallet within 60 seconds of any monetization event by that creator.
- An external automation tool (Zapier, n8n, custom script) can drive all of canon-submit / mint / list / award via an API key with explicit per-permission scopes.
- An AI agent never exposes the owner's wallet to a popup — every transaction signs server-side via Circle DCW.
- Agent activity is fully auditable: every `pipelineExecutor` step writes to `aiAgentPipelineRuns` with the resolved `actingUid`, target chain, tx hash, cost, and outcome.

---

## Open Questions

1. Should AI agents be able to spend $LOAR from the universe treasury (Safe-gated) instead of from the owner's personal wallet? (Treasury-funded agents are powerful but require multisig sign-off per spend. Defer to Phase 3.)
2. Do we let one AI agent be assigned to multiple universes simultaneously? (Today: yes via `universeAgentAssignments`. Phase 2 should add per-universe sub-budgets.)
3. Talent Agent verification — manual platform-team review (current) vs. social-proof (Farcaster / X verified handle) vs. KYC (Persona). Pick one for v1; default = manual.
4. Pipeline failure handling — retry policy, dead-letter queue, alerting. Today: best-effort. Need a clearer SLA before Phase 3 marketplace.
