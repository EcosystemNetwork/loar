# PRD — VLM Subsystem (Vision-Language Model intelligence)

**Status:** Phase 1–5 implemented (testnet). Phase 6 drafted. Phase 7 deferred behind feature flag.
**Scope:** Turn LOAR from a generation app into a story-intelligence platform by layering a Vision-Language Model understanding pipeline across upload, generation, canon, moderation, and governance.
**Author:** Platform team · 2026-04-18
**Depends on:** Gemini 2.5 Pro (video + image), Gemini 2.5 Flash (cheap JSON), OpenAI (optional, for cross-model evaluation), BullMQ/Redis, Firestore, StorageManager (Pinata/Lighthouse).

---

## 1. Why

LOAR already generates video and images. What it lacks is **understanding** of what those assets contain. Understanding unlocks:

- Auto-populated worldbuilding (scenes, characters, factions, timeline events extracted from upload)
- Canon consistency enforcement before publish
- Mainnet-grade moderation and rights triage
- True multimodal search across the platform catalog
- Reference-aware generation copilots (prompt coaching, output scoring, identity enforcement)
- Trailer / recap / chapter generation
- Governance proposals grounded in actual media artifacts
- Always-on "continuous film" loops where the universe keeps producing canon

Without this layer, the entity graph, governance, and canon marketplace remain hand-curated and slow. With it, LOAR becomes a franchise engine.

## 2. Non-goals

- The VLM **never silently mutates canon**. It drafts and scores; humans (or token voters) accept.
- The VLM **never decides legal clearance alone**. It risk-scores; admins resolve.
- No client-side calls to Gemini/OpenAI. All VLM keys stay server-side.
- No new storage provider. We use existing StorageManager for any cached VLM artifacts.

## 3. Phased rollout

| Phase | Features                                                         | State                                           |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------- |
| 1     | Video-to-lore extraction, entity proposal review                 | implemented                                     |
| 2     | Canon consistency validator on publish                           | implemented                                     |
| 3     | Moderation risk scoring (copyright/NSFW/watermark/IP-similarity) | implemented                                     |
| 4     | Multimodal search (tags, captions, optional embeddings)          | implemented (tags+captions; embeddings flagged) |
| 5     | Generation copilot + trailer/recap/chapter generator             | implemented                                     |
| 6     | Governance assist — draft canon proposals from media             | implemented                                     |
| 7     | Editing graph primitives + continuous-film autoplay              | feature-flagged (`VLM_CONTINUOUS_FILM=true`)    |

Each phase ships production-grade (no mocks, per the `feedback_no_mocks` rule) and is additive — no existing flow breaks.

## 4. Architecture

```
                           ┌─────────────────────────────┐
                           │   tRPC vlm.* + REST hooks   │
                           └──────────┬──────────────────┘
                                      │ enqueue
                                      ▼
                  ┌──────────────────────────────────────┐
                  │  BullMQ "vlm" queue  (Redis-backed)  │
                  └──────────┬───────────────────────────┘
                             │
         ┌───────────────────┼────────────────────────┐
         ▼                   ▼                        ▼
    vlm.worker.ts       generation.worker.ts     background.worker.ts
         │                   │ (on completion emits vlm.extract job)
         │
         ▼
    services/vlm/
      ├─ extractor.ts       — Gemini File API → strict JSON
      ├─ canon-checker.ts   — compare vs. entities + lore
      ├─ moderation.ts      — risk score → flags collection
      ├─ copilot.ts         — prompt coaching + output scoring
      ├─ recap.ts           — trailer/chapter/SEO
      ├─ governance.ts      — proposal drafter
      └─ search.ts          — tag/caption retrieval (+ embeddings)

Firestore collections (new):
  vlmJobs/{jobId}           — job state, counters, output refs
  vlmExtractions/{id}       — raw structured output per asset
  entityProposals/{id}      — draft entities pending review
  canonConflicts/{id}       — consistency findings per target
  vlmRiskScores/{contentId} — moderation risk from VLM
  sceneIndex/{id}           — per-scene tags + captions for search
  canonProposalDrafts/{id}  — VLM-authored governance drafts
```

All VLM writes are **append-only where possible**; mutations to `entities/` happen only after explicit accept via `vlm.proposals.accept`.

## 5. Firestore schemas

### `vlmJobs/{jobId}`

```ts
{
  jobId: string
  kind: 'extract' | 'canon_check' | 'moderation' | 'recap' | 'search_index' | 'governance_draft' | 'copilot_score'
  status: 'pending' | 'running' | 'completed' | 'failed'
  creatorUid: string
  input: {
    assetType: 'video' | 'image' | 'audio'
    mediaUrl: string
    contentId?: string        // existing gallery content
    generationId?: string     // source gen
    universeAddress?: string | null
    // kind-specific options
  }
  outputRef?: string          // doc id in the target collection
  tokensUsed?: number
  costUsd?: number
  error?: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}
```

### `vlmExtractions/{id}`

```ts
{
  id: string
  sourceMediaUrl: string
  contentId?: string
  creatorUid: string
  universeAddress?: string | null
  model: 'gemini-2.5-pro' | 'gemini-2.5-flash'
  summary: string             // 1–2 sentence gist
  durationSec?: number
  scenes: Array<{
    index: number
    startSec: number
    endSec: number
    shotType?: string         // wide/medium/close/etc
    description: string
    location?: string
    mood?: string
    subjects: string[]        // raw names; resolution happens in proposals
    actions: string[]
  }>
  entities: Array<{
    proposalId: string        // FK to entityProposals
    kind: EntityKind
    name: string
    description: string
    firstSeenAtSec?: number
    evidenceSceneIndexes: number[]
  }>
  relationships: Array<{
    sourceName: string
    targetName: string
    type: EntityRelationType
    evidenceSceneIndex: number
  }>
  timelineEvents: Array<{
    name: string
    description: string
    atSec: number
    confidence: number        // 0..1
  }>
  chapterMarkers: Array<{
    title: string
    startSec: number
    summary: string
  }>
  risks: Array<{
    kind: 'nsfw' | 'violence' | 'copyright_logo' | 'copyright_character' | 'watermark' | 'ocr_credits' | 'franchise_lookalike'
    score: number            // 0..1
    evidence: string          // what was observed
    sceneIndex?: number
  }>
  canonDelta?: {              // what changed vs. parent
    newEntities: string[]
    changedRelationships: string[]
    newTimelineEvents: string[]
    conflicts: string[]
  }
  tokensUsed: number
  costUsd: number
  createdAt: Date
}
```

### `entityProposals/{id}`

```ts
{
  id: string
  extractionId: string        // FK
  creatorUid: string
  universeAddress?: string | null
  kind: EntityKind
  name: string
  description: string
  metadata: Record<string, string>
  imageFrameUrl?: string      // extracted keyframe we kept
  sourceSceneIndexes: number[]
  matchedEntityId?: string    // if an existing entity was likely the same
  matchConfidence?: number
  status: 'pending' | 'accepted' | 'rejected' | 'merged'
  decidedBy?: string
  decidedAt?: Date
  acceptedEntityId?: string   // populated after accept
  createdAt: Date
}
```

### `canonConflicts/{id}`

```ts
{
  id: string;
  targetId: string; // contentId / generationId / proposalId
  universeAddress: string;
  conflicts: Array<{
    severity: 'info' | 'warn' | 'block';
    rule:
      | 'costume_drift'
      | 'timeline_impossible'
      | 'character_out_of_lore'
      | 'location_layout'
      | 'faction_insignia'
      | 'duplicate_beat'
      | 'rights_mismatch';
    message: string;
    evidence: string; // quote from extraction
    sceneIndex?: number;
    relatedEntityIds: string[];
  }>;
  passed: boolean; // false if any 'block'
  checkedAt: Date;
}
```

### `vlmRiskScores/{contentId}`

```ts
{
  contentId: string
  overallRisk: 'low' | 'medium' | 'high'
  autoAction: 'none' | 'flag' | 'hide_pending_review'
  scores: Array<{
    kind: 'nsfw' | 'violence' | 'copyright_logo' | ...
    score: number
    evidence: string
  }>
  extractionId: string
  evaluatedAt: Date
}
```

### `sceneIndex/{id}`

```ts
{
  id: string
  contentId: string
  sceneIndex: number
  caption: string
  tags: string[]              // lowercase tokens — red sigil, desert, sunset, betrayal, void engine
  objects: string[]
  faces: string[]             // matched entity names (when identity resolution runs)
  mood: string
  startSec: number
  endSec: number
  embedding?: number[]        // optional — only written when `VLM_EMBEDDINGS=true`
}
```

### `canonProposalDrafts/{id}`

```ts
{
  id: string
  extractionId: string
  creatorUid: string
  universeAddress: string
  title: string
  summary: string
  affectedEntityIds: string[]
  affectedLore: string[]
  continuityConflicts: string[]
  proChange: string
  conChange: string
  evidence: Array<{ sceneIndex: number; timestamp: string; note: string }>
  createdAt: Date
}
```

## 6. Routers

All under `vlm.*` in the app router, registered in `apps/server/src/routers/index.ts`.

| Path                            | Kind               | Purpose                                                   |
| ------------------------------- | ------------------ | --------------------------------------------------------- |
| `vlm.extract.start`             | protected mutation | Enqueue an extraction job on a media URL                  |
| `vlm.extract.status`            | protected query    | Poll job status + output ref                              |
| `vlm.extract.get`               | protected query    | Fetch full extraction by id                               |
| `vlm.proposals.list`            | protected query    | List entity proposals for an extraction                   |
| `vlm.proposals.accept`          | protected mutation | Accept → creates real entity via `createEntity`           |
| `vlm.proposals.reject`          | protected mutation | Reject proposal                                           |
| `vlm.proposals.merge`           | protected mutation | Merge proposal into existing entity                       |
| `vlm.canon.check`               | protected mutation | Run consistency check against universe                    |
| `vlm.canon.getConflicts`        | public query       | Read latest conflicts for a target                        |
| `vlm.search.query`              | public query       | Text search over `sceneIndex` + `vlmExtractions`          |
| `vlm.moderation.riskScore`      | public query       | Read risk for a contentId (used by client to show badges) |
| `vlm.moderation.requeue`        | admin mutation     | Force re-scoring                                          |
| `vlm.copilot.improvePrompt`     | protected mutation | Reference images → better prompt                          |
| `vlm.copilot.scoreOutput`       | protected mutation | Score a generated asset against intent                    |
| `vlm.copilot.extractStyleBible` | protected mutation | Moodboard → structured style pack metadata                |
| `vlm.recap.chapters`            | protected mutation | Chapter markers for an asset                              |
| `vlm.recap.trailer`             | protected mutation | Cut suggestions + pitch text                              |
| `vlm.recap.seo`                 | protected mutation | Title + description + thumbnail suggestions               |
| `vlm.governance.draftProposal`  | protected mutation | Draft a canon proposal from an extraction                 |

## 7. Integration hooks

- **Post-generation**: the existing `generation.worker.ts` enqueues a `vlm.extract` job on success (best-effort, non-blocking). Extraction populates `sceneIndex` + `vlmRiskScores` automatically for every new asset.
- **Post-upload**: `/api/upload` (Hono) enqueues the same job for user uploads.
- **Pre-publish**: `content.create` / `marketplace.submit` call `vlm.canon.check` when `universeAddress` is set. Conflicts are displayed non-blocking; admins may configure `CANON_BLOCK_ON_HIGH=true` to hard-block `severity=block`.
- **Pre-mint**: `marketplace.mintEpisode` reads latest `vlmRiskScores/{contentId}` — `high` risk requires admin review (consistent with `assertContentOperable`).

## 8. Cost controls

- **Model routing**: Gemini 2.5 Flash ($0.075 / 1M in) for short image extractions and small JSON. Gemini 2.5 Pro ($1.25 / 1M in) for video understanding. OpenAI is off by default; flip `VLM_CROSS_MODEL=true` to enable ensemble scoring.
- **Caching**: extraction results keyed by `sha256(mediaUrl + model + promptVersion)` stored in `vlmExtractions/`. Re-runs on same asset are free.
- **Rate limits**: reuse `middleware/rate-limit.ts`. Default 10 extract jobs / user / hour.
- **Budget cap**: per-user monthly budget via `VLM_USER_MONTHLY_USD` (default $5 free tier). Over cap → `402 Payment Required`. Creators can top up through credits.

## 9. Security

- Server-only keys: `GOOGLE_API_KEY`, `OPENAI_API_KEY` already server-side. Nothing added to `VITE_*`.
- SSRF: all remote media URLs flow through existing `validateUploadUrl`.
- Prompt injection: reuse `sanitizeForPrompt` from `services/gemini.ts`.
- Proposal accept is `protectedProcedure`. Proposal rejection and canon decisions are logged (either in `contentAuditLog` for content-scoped actions or a new `vlmDecisionLog` for proposal-scoped ones).
- VLM-authored entities are never monetizable until a human sets `monetized=true` (the proposal flow strips `rightsDeclaration`).

## 10. Frontend

| Route / component                         | Purpose                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `/extract/$jobId`                         | Extraction review page — summary, scenes timeline, proposals list with accept/reject |
| `components/vlm/ExtractionReview.tsx`     | Shared panel mounted inline next to upload + generation                              |
| `components/vlm/CanonValidatorBanner.tsx` | Pre-publish banner; severity chips                                                   |
| `components/vlm/EntityProposalCard.tsx`   | Single-proposal UI                                                                   |
| `components/vlm/SceneTimeline.tsx`        | Chapter + scene strip                                                                |
| `components/vlm/RiskBadge.tsx`            | NSFW/copyright badge                                                                 |
| `/search`                                 | Multimodal search page (text query → scene hits with thumbnails)                     |
| `/admin/moderation`                       | Extended with Risk column sourced from `vlmRiskScores`                               |

## 11. Telemetry

- `vlm_job_latency_ms` (by kind)
- `vlm_tokens_in_total`, `vlm_tokens_out_total` (by model)
- `vlm_cost_usd_total` (by user, by kind)
- `vlm_proposals_total` (by status)
- `vlm_canon_conflicts_total` (by rule, by severity)
- `vlm_risk_autoactions_total` (by action)

Exported via the existing `/metrics` Prometheus endpoint.

## 12. Phase 7 — editing + continuous film (feature-flagged)

Feature-flagged behind `VLM_CONTINUOUS_FILM=true` because it needs budget + human checkpoints to stay stable. Building blocks once flag is on:

- **Editing nodes**: extend `workflows/` with VLM-planner + VLM-judge nodes. Planner turns "make it moodier" into a generation DAG; judge scores outputs.
- **Universe autoplay**: daemon (one-replica opt-in, like `ABUSE_DETECT_ENABLED`) that reads a universe's state, drafts the next scene via `vlm.governance.draftProposal`, waits for human/votetimer, then enqueues generation.
- **Character lifecycle state**: new `characterState/{entityId}` collection persists goals / relationships / memory. VLM reads it before drafting.
- **Kill switches**: `VLM_AUTOPLAY_MAX_PER_DAY`, `VLM_AUTOPLAY_BUDGET_USD`, `VLM_AUTOPLAY_REQUIRE_VOTE=true`.

## 13. Rollout sequence

1. Ship foundation (queue, worker, service layer, env) — no user-visible change.
2. Turn on `vlm.extract` from the generation worker — populates `sceneIndex` and `vlmRiskScores` silently for ~1 week to build the corpus.
3. Ship review UI + canon validator banner. Creators opt in per upload.
4. Ship moderation risk column in admin queue.
5. Ship multimodal search page (requires corpus built in step 2).
6. Ship copilot + recap.
7. Ship governance assist (wire into existing governance router).
8. Flag on Phase 7 for pilot universes.

## 14. Risks + mitigations

| Risk                                             | Mitigation                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Hallucinated entities polluting canon            | Nothing writes to `entities/` without explicit accept. Proposals live in `entityProposals/`.           |
| Prompt-injection in user-supplied descriptions   | Reuse `sanitizeForPrompt`.                                                                             |
| Cost blow-ups from large videos                  | File API upload + processing cap (5 min timeout exists). Per-user monthly budget.                      |
| VLM flags legitimate content                     | Risk scoring is advisory; only `high` triggers auto-hide, and always admin-reviewable.                 |
| Gemini outage                                    | Job retries (BullMQ). Extractions are best-effort; base flows keep working.                            |
| Schema drift between VLM output and entity model | Zod-validated output in `services/vlm/schemas.ts`; failures go to dead-letter with raw text preserved. |

## 15. Open questions (tracked separately, not launch blockers)

- Should we ship embeddings-based search as default, or keep it behind `VLM_EMBEDDINGS=true`? Cost/value TBD from phase 4 corpus data.
- Do we want cross-model ensemble scoring for high-stakes canon checks (Gemini + OpenAI)? Cost is 2–3× — keep flagged until we see canon-validator false-positive rate.
- Should continuous-film autoplay be universe-scoped opt-in, or platform global? Safer scoped; revisit after pilot.
