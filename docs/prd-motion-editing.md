# PRD 8 — Image-to-Video, Video-to-Video, Talking Scene Edits

**Status**: implemented (2026-04-18)
**Owner**: EricsWorkspace branch

## Goal

Extend the editor from stills into short-form narrative motion. Animate stored
images, restyle existing clips, and produce talking-character lore drops from a
portrait + dialogue.

## Scope

- Animate image → short clip with motion preset (push-in, orbit, crash zoom,
  dolly, walk-up).
- Edit existing short clip with prompt-based scene changes (video-to-video
  restyle — already shipped via `editing.restyle`).
- Talking scene: portrait + dialogue text + voice → TTS → animated portrait →
  lip-sync → published clip in one mutation.
- Every derivative clip records source refs (`parentGenerationId`,
  `sourceImageUrl`, `sourceVideoGenerationId`, `sourceAudioGenerationId`) on
  both the generation record and the gallery doc.

## Reuse map

Almost the entire backend already exists — PRD 8 surfaces it.

| Capability      | Existing surface                               | Gap closed                                                                                         |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Image-to-video  | `generation.generate({mode:'image_to_video'})` | Surface in editor with curated motion presets                                                      |
| Video-to-video  | `editing.restyle`                              | Already exposed in `VideoEditingToolbar`                                                           |
| Lip-sync        | `lipsync.sync`                                 | Auto-publish to gallery + source refs                                                              |
| TTS             | `voice.synthesize` (ElevenLabs)                | Reused inside talking-scene combo                                                                  |
| Camera presets  | `scene-controls/camera.ts` (16 presets)        | Added `crash_zoom`, `walk_up`; surfaced PRD 8 subset                                               |
| Gallery linkage | `publishToGallery` writes `generationId`       | Added `parentGenerationId`, `sourceImageUrl`, `sourceVideoGenerationId`, `sourceAudioGenerationId` |

## New surfaces

### Server

- `apps/server/src/services/motion-presets.ts` — curated PRD 8 list mapping
  `push_in | orbit | crash_zoom | dolly | walk_up` → underlying
  `(cameraPresetId, intensity)` tuples.
- `apps/server/src/routers/generation/talking-scene.routes.ts` —
  `talkingScene.create({ imageUrl, dialogue, voiceId, durationSec? })`:
  TTS → image-to-video portrait animation → lip-sync → publish + auto-attach.
  Single mutation, atomic credit accounting (refunds on any failure).

### Frontend

- `apps/web/src/components/editing/AnimateImagePanel.tsx` — image preview,
  PRD 8 motion preset picker, duration slider, prompt → mutates
  `generation.generate`.
- `apps/web/src/components/editing/TalkingScenePanel.tsx` — image preview,
  dialogue textarea, voice picker → mutates `talkingScene.create`.
- `apps/web/src/routes/editor.tsx` — adds "Animate" and "Talking" tabs to the
  right sidebar.

## Acceptance criteria (verified)

1. ✅ Animate stored image — `/editor?image=<url>` + Animate tab + motion preset.
2. ✅ Add spoken dialogue to a portrait — `/editor?image=<url>` + Talking tab.
3. ✅ Linked child version with source refs — gallery doc carries
   `parentGenerationId`, `sourceImageUrl`, `sourceVideoGenerationId`,
   `sourceAudioGenerationId`. Lineage queryable via Firestore.

## Out of scope (deferred)

- Higgsfield direct integration (Runway accessed today via `fal-ai/runway-gen3`).
- Multi-character dialogue scenes (single speaker only).
- Real-time editing UI for lipsync timing / phoneme adjustment.
- Voice cloning from canon character portraits (separate PRD 9 work).
