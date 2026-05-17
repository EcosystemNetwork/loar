# PRD: Episode Builder (Video Editor)

> Status: Phase 1 restored (2026-05-16) — `/editor` route + 3 exclusive panels back on main; Phase 2 buildout in progress
> Priority: Core creation surface — the canonical "produce an episode" UI
> Owners: web (apps/web/src/routes/editor.tsx + editing/\*)

---

## Problem

LOAR's content stack accumulated four separate "produce video" entry points: `/create` (single-shot wizard), `/sandbox` (open canvas, batch generation), `/studio` (entity-pack orchestration), and `/editor` (Runway-style timeline). The editor was the only one with timeline-aware editing — drag clips into order, trim, splice, set transitions, export an episode bundle.

When we deleted `/editor` on April 24, 2026, we lost the only surface where a creator could **build an episode from clips they already have**. The other three surfaces all start from a prompt or an entity. There is no "I have 8 clips from 8 generations, assemble them into a 90-second episode with this music + this dub track" workflow without `/editor`.

Phase 1 restored the route. **This PRD covers Phase 2 — integrating the editor with everything LOAR has built since April 24**: voice studio (multilingual dubbing), scene controls, cinematic references, talking-scene/lipsync, VLM continuity, canvas mode.

---

## Goal

Make `/editor` the single non-overlapping "assemble an episode" surface, where a creator:

1. **Picks clips** from their gallery, recent generations, or imported uploads (drag onto timeline).
2. **Arranges** clips in order, trims start/end, sets transitions (cut, dissolve, fade) between adjacent clips.
3. **Layers** audio — base scene audio + voice dub + music track + sound effects (each on its own track).
4. **Generates inline** — right-click any clip slot to "generate a clip here" using the inline panels (Animate, Talking-Scene, Voice-modify, Inpaint, Outpaint).
5. **Previews** the assembled episode via HLS preview, with scrubbable timeline.
6. **Exports** as either a raw video bundle (mp4 + manifest) or a canon-ready episode (mints `EpisodeNFT`, optionally lists on universe shop).

The editor is the **only** surface that produces an `EpisodeNFT`. `/create` and `/sandbox` produce clips that the editor then assembles.

---

## Non-Goals

- Frame-perfect video editing (cuts on second boundaries; sub-frame trim is Phase 3)
- Multi-track video compositing (one video track for v1; PiP / split-screen is Phase 3)
- Pro audio mixing (volume + crossfade only; full EQ/compression is out of scope)
- Live collaboration (single-editor sessions for v1; multi-cursor editing tracked separately under `collaboration` router)
- Real-time export-while-recording (always offline render)

---

## Current State (post-restore, 2026-05-16)

| Surface                                                   | Status                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/web/src/routes/editor.tsx`                          | Restored — 520 lines, timeline state + clip slots + export bundling                      |
| `apps/web/src/components/editing/VideoEditingToolbar.tsx` | Restored — 517 lines, top toolbar with cuts/trim/transitions                             |
| `apps/web/src/components/editing/AnimateImagePanel.tsx`   | Restored — inline image-to-video panel                                                   |
| `apps/web/src/components/editing/TalkingScenePanel.tsx`   | Restored — inline talking-scene generation panel                                         |
| Shared editing components                                 | Untouched (InpaintCanvas, VoiceModifyPanel, InpaintStudio, OutpaintStudio still present) |
| Header link + admin-toolbar QA-nav                        | `/editor` re-added                                                                       |
| EpisodesTab "New Episode" buttons                         | Restored                                                                                 |

### Known divergences since removal

These features shipped to main while `/editor` was shelved. They are **not** yet wired into the restored editor:

- `apps/server/src/routers/generation/talking-scene.routes.ts` — server-side talking-scene endpoint (the restored `TalkingScenePanel` may call older paths)
- `apps/server/src/routers/generation/multilingualDub.routes.ts` — voice-studio dubbing pipeline
- `apps/server/src/routers/generation/lipsync.routes.ts` — lipsync route
- `apps/server/src/routers/generation/cutdown.routes.ts` — auto-cutdown (AI selects best moments)
- `apps/server/src/routers/sceneControls/` — scene controls (lighting / camera / mood)
- `apps/web/src/components/StylePresetPicker.tsx` (uncommitted) + `style-presets.ts` — newer style preset system
- `cinematicReferences` router — newer "cite a known shot as inspiration" feature
- Canvas (`/canvas` route in main) — newer freeform whiteboard

---

## Phase 2 — Buildout Items

### E1. Wire restored panels to current server routes (P0)

`AnimateImagePanel` and `TalkingScenePanel` were pre-`talking-scene.routes.ts`. Walk both panels and update tRPC calls:

- `TalkingScenePanel` → `trpcClient.talkingScene.create` (current canonical path)
- `AnimateImagePanel` → `trpcClient.generation.imageToVideo` (current)
- Any direct `fetch('/api/...')` calls → tRPC equivalents

### E2. Multilingual dubbing track on the timeline (P0)

Voice Studio shipped a `multilingualDub` pipeline that produces N translated audio tracks per source video. The editor should:

- Expose a per-clip "Dub" toolbar action: select target languages, kick off `multilingualDub.create`, attach returned tracks as additional audio rows
- Render audio rows as muted-by-default with a language picker on the preview player
- Export step: if multiple dub tracks present, output as an HLS package with audio-track selectors (not a single mp4)

### E3. Lipsync inline (P0)

When a clip has both a generated video and a dub-replaced audio track, lips desync. Add:

- Per-clip "Lipsync to dub track" button → `lipsync.create` with the clip's video + the selected audio track
- Result replaces the original video for that clip slot
- Mark the lineage: parent = original clip, derivative = lipsynced clip

### E4. Scene controls + cinematic references in the generation panels (P1)

When generating a clip _inside_ the editor (Animate / Talking-Scene), the inline panels should expose:

- Scene-controls dropdown (lighting / camera / mood) → forwards `sceneControlIds` to the underlying generation call
- Cinematic-reference picker → forwards `referenceIds` to bias the generation toward a known shot
- Style-preset picker (the new `StylePresetPicker.tsx` we have uncommitted)

This brings clips generated _inside_ the editor to feature parity with clips generated in `/create`.

### E5. Cutdown / auto-assembly (P1)

`/editor` is "manual assembly." Add a top-toolbar button:

- "Auto-cutdown from script" → opens a modal, takes a script + a folder of clips, calls `cutdown.create`, returns a suggested timeline arrangement
- User reviews and accepts or rejects each clip placement
- Save to draft or commit to canon

### E6. Episode mint + canon submission as terminal exit (P0)

Today the export step bundles an mp4. To finish the loop:

- Add an "Mint as Episode" button at export time
- Calls `episodes.create` (server) + `EpisodeNFT.mint` (via Circle DCW)
- Optional: also submit to canon via `marketplace.submit` in the same flow
- Optional: list on shop via `listings.create` in the same flow

Replaces today's "manual three-step after export." End-state: one button "Publish as Episode."

### E7. Drafts persistence (P1)

Today closing the editor loses state. Add:

- Autosave timeline state to Firestore (`editorDrafts` collection, scoped to creator + universe)
- Resume from any device via `/editor?draft=<id>`
- LRU per creator (cap at 20 drafts)

### E8. Canvas mode integration (P2)

Canvas is the freeform companion. Add:

- "Send to Editor" action on any canvas selection → seeds the editor's clip pool
- "Open in Canvas" action on the editor's clip pool → roundtrip for re-arranging or annotating

Lower priority — canvas is its own surface and people don't have to context-switch immediately.

---

## Success Criteria

- A creator can assemble a 5-clip / 60-second episode end-to-end (pick clips → arrange → dub to 3 languages → lipsync → mint) in under 10 minutes.
- Every clip generated inline in the editor carries lineage references (`parentGenerationId`, `editorSessionId`) so the gallery shows the editor-context badge.
- Exported episodes are HLS-streamable with selectable audio tracks for all dub languages.
- Mint flow signs server-side via Circle DCW — no wallet popups inside the editor.
- Drafts persist across sessions and devices.

---

## Open Questions

1. Should the editor support importing 3rd-party videos (uploaded mp4s the creator owns) or only LOAR-generated clips? (Default: own uploads are fine, but they get the `fan` classification by default and require explicit `original` declaration with rights proof.)
2. Episode length cap — 5 minutes? 10? Unlimited? (Default: 10 minutes for v1, gated by storage cost.)
3. Per-clip transitions — only "cut" / "dissolve" / "fade", or include "wipes" and other Premiere-style effects? (Default: 3 transitions for v1; add more if requested.)
4. Should mint-as-episode require canon approval first? (Default: no — minting is a creator action; canon vote is the universe-owner action. Both can happen, independently.)
