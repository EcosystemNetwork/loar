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
| 5b    | Wiki-conditioned generation (entity refs → shot conditioning)    | drafted, premium-gated                          |
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

| Path                            | Kind               | Purpose                                                    |
| ------------------------------- | ------------------ | ---------------------------------------------------------- |
| `vlm.extract.start`             | protected mutation | Enqueue an extraction job on a media URL                   |
| `vlm.extract.status`            | protected query    | Poll job status + output ref                               |
| `vlm.extract.get`               | protected query    | Fetch full extraction by id                                |
| `vlm.proposals.list`            | protected query    | List entity proposals for an extraction                    |
| `vlm.proposals.accept`          | protected mutation | Accept → creates real entity via `createEntity`            |
| `vlm.proposals.reject`          | protected mutation | Reject proposal                                            |
| `vlm.proposals.merge`           | protected mutation | Merge proposal into existing entity                        |
| `vlm.canon.check`               | protected mutation | Run consistency check against universe                     |
| `vlm.canon.getConflicts`        | public query       | Read latest conflicts for a target                         |
| `vlm.search.query`              | public query       | Text search over `sceneIndex` + `vlmExtractions`           |
| `vlm.moderation.riskScore`      | public query       | Read risk for a contentId (used by client to show badges)  |
| `vlm.moderation.requeue`        | admin mutation     | Force re-scoring                                           |
| `vlm.copilot.improvePrompt`     | protected mutation | Reference images → better prompt                           |
| `vlm.copilot.scoreOutput`       | protected mutation | Score a generated asset against intent                     |
| `vlm.copilot.scoreLipSync`      | protected mutation | VLM-verify phoneme↔viseme alignment on talking-scene video |
| `vlm.copilot.extractStyleBible` | protected mutation | Moodboard → structured style pack metadata                 |
| `vlm.recap.chapters`            | protected mutation | Chapter markers for an asset                               |
| `vlm.recap.trailer`             | protected mutation | Cut suggestions + pitch text                               |
| `vlm.recap.seo`                 | protected mutation | Title + description + thumbnail suggestions                |
| `vlm.governance.draftProposal`  | protected mutation | Draft a canon proposal from an extraction                  |

## 7. Integration hooks

- **Post-generation**: the existing `generation.worker.ts` enqueues a `vlm.extract` job on success (best-effort, non-blocking). Extraction populates `sceneIndex` + `vlmRiskScores` automatically for every new asset.
- **Post-talking-scene**: on `talkingScene.create` completion, the worker additionally enqueues `vlm.copilot.scoreLipSync` with the audio track + video. The VLM rates phoneme-to-viseme alignment (score `lipSyncScore` 0..1) and flags ranges where mouth movements drift from the driving audio. Scores below `VLM_LIPSYNC_MIN_SCORE` (default 0.65) surface a "lip-sync warning" badge in the gallery and are eligible for one automatic re-dispatch with a tighter audio-conditioning seed before asking the creator. Continuous-mode runs (§13) treat lip-sync score as a required judge input for any dialogue shot.
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

## 12. Phase 5b — Wiki-conditioned generation (retrieval-augmented shots)

Phases 1–5 push media → canon (extraction, proposals, conflicts, risk, recaps). Phase 5b adds the reverse flow: **canon → media**. Wiki entities become persistent visual memory that conditions new generations, so characters, locations, and objects stay consistent across scenes. This is the spine of LOAR's long-form positioning and ships behind the paid (Studio) tier — see `memory/project_vlm_continuity_premium.md`.

### 12.1 Entity `visualDescriptor`

Every `person`, `place`, `thing`, `species`, `vehicle`, `technology`, and `faction` entity gains an optional `visualDescriptor` field, maintained by the VLM layer:

```ts
interface EntityVisualDescriptor {
  version: number; // bumped on each canon-accepted update
  canonicalDescription: string; // VLM-authored paragraph for prompt injection
  attributes: Record<string, string | string[]>; // structured features, kind-specific
  referenceAssets: Array<{
    cid: string; // Pinata / Lighthouse CID
    mediaUrl: string; // gateway URL at time of write
    sourceContentId?: string;
    sourceSceneIndex?: number;
    role: 'identity' | 'outfit' | 'location' | 'prop' | 'emblem';
    priority: number; // higher = preferred for conditioning
    pinnedByCreator?: boolean; // protects against VLM auto-displacement
  }>;
  lastUpdatedBy: 'vlm' | 'creator' | 'admin';
  updatedAt: Date;
  sourceExtractionId?: string;
}
```

Written in two paths:

- **Proposal accept** — `vlm.proposals.accept` derives an initial `visualDescriptor` from the extraction's scene subjects + best keyframe.
- **Canon refresh** — subsequent extractions that pass canon check enqueue `vlm.copilot.refreshVisualDescriptor`, which merges evidence from new scenes. Previous versions persist in `entityDescriptorHistory/{entityId}/{version}` so creators can revert.

### 12.2 `entityRefs` on generation endpoints

Generation routes (`generation.image.create`, `generation.video.create`, `talkingScene.create`, outpaint) accept optional `entityRefs: string[]` of entity IDs. On enqueue the generation worker:

1. Loads each entity + its current `visualDescriptor`.
2. Composes the final prompt: user prompt + serialized `canonicalDescription`s, budgeted by token count.
3. Selects top-priority `referenceAssets` (hard cap 4 per generation) and passes them to the model as reference inputs (Imagen reference input, runway image_to_video, or IP-Adapter where supported).
4. Writes `entityRefs[]` + per-entity descriptor `version` onto the resulting `galleryItem` for lineage and reproducibility.

Rights checks (`assertContentOperable`) remain authoritative — retrieval does **not** bypass classification gates for `licensed` / `fan` entities.

### 12.3 Entity tagger + coverage surfaces

`components/editor/EntityTagger.tsx` — typeahead over `entities/` scoped to the active universe. Returns chips that attach to the generation request. `@` opens the picker inline. For universes with many entities, server-side `vlm.copilot.suggestEntityRefs` proposes likely subjects from the prompt text.

`entityRefs` retrieval is **not tab-specific** — any surface that enqueues a generation can pass them. Phase 5b mounts `EntityTagger` (and wires the routes) in every generation entry point so creators get the same continuity guarantees everywhere:

| Surface                  | Path(s)                               | Notes                                                                   |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------------------- |
| Editor — Animate tab     | `apps/web/src/routes/editor/*`        | Standard entry point; tagger next to prompt textarea                    |
| Editor — Talking tab     | same                                  | Tagger + auto-`scoreLipSync` on completion                              |
| Sandbox                  | `apps/web/src/routes/sandbox/*`       | Free-form experiments — tagger available; paid-tier gate same as editor |
| Universe editor          | `apps/web/src/routes/universe/*/edit` | Worldbuilding + shot generation against the active universe's entities  |
| Continuous-mode autoplay | Phase 7 (§13)                         | Planner selects `entityRefs` automatically from universe state          |
| Mobile — create tab      | `apps/mobile/src/...`                 | Ships after web lands; reuses same tRPC routes                          |

Every surface calls the same `generation.*` routes with `entityRefs`; the server resolves descriptors, injects conditioning, and writes lineage identically. No surface should fork the retrieval path.

### 12.4 Router additions

| Path                                  | Kind               | Purpose                                                                   |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `vlm.copilot.refreshVisualDescriptor` | protected mutation | Rebuild an entity's `visualDescriptor` from accumulated canon extractions |
| `vlm.copilot.suggestEntityRefs`       | protected mutation | Given a prompt + universe, suggest entities likely present in the shot    |
| `entities.visualDescriptor.get`       | public query       | Read current descriptor (for wiki detail page)                            |
| `entities.visualDescriptor.pinAsset`  | protected mutation | Creator pins a reference asset so VLM can't auto-displace it              |
| `entities.visualDescriptor.revert`    | protected mutation | Revert to a prior descriptor version from `entityDescriptorHistory`       |

### 12.5 Premium gating

`entityRefs` retrieval is gated by the Studio tier per `project_vlm_continuity_premium.md`. Free tier: field silently ignored with a UI hint ("unlock cross-scene continuity"). Gate sits in `generation.worker.ts` pre-dispatch so no billable conditioning work happens for free-tier jobs. A 2-entity / 30-second taste may be allowed on free tier for shareable demos — tunable via `VLM_FREE_TIER_ENTITY_CAP` and `VLM_FREE_TIER_DURATION_CAP_SEC`.

### 12.6 Feedback loop

Phase 1 already writes every generation to `vlmExtractions/` + `sceneIndex/`. Phase 5b closes the loop:

1. Post-generation extraction runs as today.
2. If the extraction passes canon check and an entity accumulates ≥ `VLM_DESCRIPTOR_REFRESH_THRESHOLD` (default 3) new evidence scenes since its last descriptor version, the worker enqueues `refreshVisualDescriptor`.
3. The VLM selects best new reference frames, merges structured attributes, bumps `version`, and archives the prior version.
4. Creators see a "Canon updated" banner on the entity page; creator-pinned assets are never displaced.

### 12.7 Risks + mitigations

| Risk                                             | Mitigation                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Reference images bloat prompt and degrade output | Hard cap of 4 reference assets per generation, priority-selected                    |
| Wrong entity suggested / tagged by user          | `sourceExtractionId` on descriptor + version history enables revert                 |
| Descriptor drift after many auto-refreshes       | Creator-pinned reference assets cannot be displaced by VLM without explicit accept  |
| Licensed/fan-classified entities used as refs    | `assertContentOperable` stays authoritative — rights lanes enforced pre-dispatch    |
| Model API doesn't support reference inputs       | Fall back to textual-only conditioning (canonical description in prompt)            |
| Per-generation retrieval latency                 | Cache resolved descriptors + pre-signed reference URLs per job; no extra round trip |

## 13. Phase 7 — editing + continuous film (feature-flagged)

**North-star:** a creator (or a universe's community) can generate a **5, 10, 20, 30, or 60-minute fully-consistent AI film** in one session — characters, locations, props, wardrobe, lighting, and story beats all stay on-model scene-to-scene. Continuous mode is the delivery vehicle; Phase 5b (wiki-conditioned generation) is its spine. Phase 7 is feature-flagged behind `VLM_CONTINUOUS_FILM=true` because it needs budget + human checkpoints to stay stable.

### 13.1 Hard dependencies

Continuous mode **must** route every generated scene through the VLM retrieval pipeline. It cannot bypass it. Specifically:

1. Every auto-planned scene is dispatched via the same `entityRefs` path that manual generations use (Phase 5b §12.2). No direct-to-model shortcut.
2. The VLM-planner node selects relevant `entityRefs` from the universe's current state (characters present in the beat, location, key props) before enqueuing generation.
3. The VLM-judge node scores each completed scene against: (a) the `visualDescriptor` of every tagged entity, (b) the previous scene's `sceneIndex` for narrative continuity, (c) story-beat adherence from the plan.
4. Scenes failing judge-score thresholds are re-dispatched (up to `VLM_CONTINUOUS_REDISPATCH_MAX`, default 2) before escalating to human review.

### 13.2 Building blocks

- **Editing nodes**: extend `workflows/` with `vlm-planner` + `vlm-judge` nodes. Planner turns "make it moodier" or "next beat" into a generation DAG with entity refs attached; judge scores outputs and may trigger re-dispatch.
- **Universe autoplay**: daemon (one-replica opt-in, like `ABUSE_DETECT_ENABLED`) reads a universe's state, drafts the next scene via `vlm.governance.draftProposal`, waits for human or vote-timer approval, then enqueues generation through the entity-ref pipeline.
- **Character lifecycle state**: new `characterState/{entityId}` collection persists goals / relationships / memory / location / current outfit. VLM-planner reads it to know who to place where; VLM-extractor writes back state deltas after each scene.
- **Continuity ledger**: new `continuityLedger/{universeAddress}/shots/{shotId}` append-only log of every generated shot, its `entityRefs`, `visualDescriptor.version` per ref, VLM-judge score, and links to prior + next shots. The film is a traversal of this ledger.
- **Kill switches**: `VLM_AUTOPLAY_MAX_PER_DAY`, `VLM_AUTOPLAY_BUDGET_USD`, `VLM_AUTOPLAY_REQUIRE_VOTE=true`, `VLM_CONTINUOUS_REDISPATCH_MAX`.

### 13.3 Duration milestones

Phase 7 is shipped as graduated duration targets, each gated by VLM-judge aggregate consistency score (mean across all shots) ≥ threshold on a canary universe before unlocking the next.

| Milestone | Target duration | Minimum shots | Consistency-score gate | Notes                                                                     |
| --------- | --------------- | ------------- | ---------------------- | ------------------------------------------------------------------------- |
| M1        | 5 min           | ~60           | ≥ 0.80                 | Single location, single scene, 2–3 tagged entities — baseline proof       |
| M2        | 10 min          | ~120          | ≥ 0.80                 | Two locations, 3–5 entities, one costume change allowed                   |
| M3        | 20 min          | ~240          | ≥ 0.78                 | Multi-location + faction insignia consistency; time-of-day transitions    |
| M4        | 30 min          | ~360          | ≥ 0.76                 | Subplot branching — VLM-judge must hold secondary entity memory stable    |
| M5        | 60 min          | ~720          | ≥ 0.74                 | Full feature-length — ensemble cast, act structure, payoff to Act I setup |

Each milestone unlocks the next only after: (a) 3 canary films at target duration passing the score gate, (b) ≤ 5% human re-dispatch rate, (c) cost-per-minute within budget envelope.

### 13.4 Budget envelope

Feature-length runs are expensive — autoplay has two cost dimensions: generation tokens (model inference) + VLM tokens (planner + judge + extractor per shot). Envelope tracked per run:

- Per-shot VLM overhead target: ≤ $0.08 (planner + judge + post-extract using Flash where possible).
- Per-minute film cost ceiling (soft): starts at $8/min for M1, targets $4/min by M5 via caching + Flash routing.
- Hard cap per run: `VLM_AUTOPLAY_BUDGET_USD` — run halts and surfaces for review if exceeded.

## 14. Rollout sequence

1. Ship foundation (queue, worker, service layer, env) — no user-visible change.
2. Turn on `vlm.extract` from the generation worker — populates `sceneIndex` and `vlmRiskScores` silently for ~1 week to build the corpus.
3. Ship review UI + canon validator banner. Creators opt in per upload.
4. Ship moderation risk column in admin queue.
5. Ship multimodal search page (requires corpus built in step 2).
6. Ship copilot + recap.
7. Ship governance assist (wire into existing governance router).
8. Ship Phase 5b: `visualDescriptor` schema → `entityRefs` on generation routes → editor `EntityTagger` → feedback-loop refresh. Gate to Studio tier.
9. Flag on Phase 7 for pilot universes.

## 15. Risks + mitigations

| Risk                                             | Mitigation                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Hallucinated entities polluting canon            | Nothing writes to `entities/` without explicit accept. Proposals live in `entityProposals/`.           |
| Prompt-injection in user-supplied descriptions   | Reuse `sanitizeForPrompt`.                                                                             |
| Cost blow-ups from large videos                  | File API upload + processing cap (5 min timeout exists). Per-user monthly budget.                      |
| VLM flags legitimate content                     | Risk scoring is advisory; only `high` triggers auto-hide, and always admin-reviewable.                 |
| Gemini outage                                    | Job retries (BullMQ). Extractions are best-effort; base flows keep working.                            |
| Schema drift between VLM output and entity model | Zod-validated output in `services/vlm/schemas.ts`; failures go to dead-letter with raw text preserved. |

## 16. Open questions (tracked separately, not launch blockers)

- Should we ship embeddings-based search as default, or keep it behind `VLM_EMBEDDINGS=true`? Cost/value TBD from phase 4 corpus data.
- Do we want cross-model ensemble scoring for high-stakes canon checks (Gemini + OpenAI)? Cost is 2–3× — keep flagged until we see canon-validator false-positive rate.
- Should continuous-film autoplay be universe-scoped opt-in, or platform global? Safer scoped; revisit after pilot.
