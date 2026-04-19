# PRD 7: Pose, Composition, Angle, and Scene Control

## Goal

Bring in deep controllability for creators who want more than prompting. This
is where LOAR should borrow most heavily from ComfyUI via ControlNet-style
pose/depth/edge control and pair it with Higgsfield-like angle/shot tools.

## Scope

- Pose guide uploads
- Scribble/edge/depth/segmentation conditioning
- Camera angle presets: low angle, close-up, over-the-shoulder, wide
  establishing, etc.
- "Match previous shot" control using previous frame or scene ref

## LOAR-specific value

- Storyboard-to-final workflow
- Better continuity between episode shots
- Faster creation of canon scenes described in lore/wiki entries

## Acceptance criteria

- User can upload a sketch or pose guide and get a controlled result
- Strength sliders determine how tightly the image follows the guide
- Saved shot templates can be reused within an episode

## Architecture (implementation)

### Control types

| Type             | Guide input                | Prompt wrapper                                               | Typical use               |
| ---------------- | -------------------------- | ------------------------------------------------------------ | ------------------------- |
| `subject`        | Character photo/render     | "Match the subject identity shown in the reference."         | Character continuity      |
| `style`          | Style reference image      | "Apply the visual style of the reference image."             | Style transfer / look-dev |
| `scribble`       | Rough sketch               | "Use the reference as a rough compositional sketch."         | Storyboard → final        |
| `pose`           | Pose skeleton / figure ref | "Replicate the subject pose shown in the reference."         | Character posing          |
| `depth`          | Depth map or depth ref     | "Match the depth layout of the reference scene."             | Scene layout              |
| `canny`          | Edge/line art              | "Follow the edge structure of the reference closely."        | Line-accurate comps       |
| `shot_reference` | Previous frame             | "Match framing, camera, and lighting of the reference shot." | Cross-shot continuity     |

### Strength mapping (0.0–1.0)

Quantized to five verbal buckets used in the system prompt since Gemini
image models don't accept a numeric ControlNet weight:

- `0.00–0.20` — "loosely inspired by"
- `0.20–0.45` — "taking general cues from"
- `0.45–0.65` — "following the reference closely"
- `0.65–0.85` — "matching the reference tightly"
- `0.85–1.00` — "strictly replicating the reference"

### Camera angle presets

Reused from `apps/server/src/services/scene-controls/types.ts`
(`CAMERA_PRESETS`). For still-image generation the preset label is
injected as a prompt prefix, e.g. `"[Low angle, close-up]"`.

Supported via prompt: `low_angle`, `high_angle`, `close_up`, `medium_shot`,
`wide_establishing`, `over_shoulder`, `dutch_tilt`, `birds_eye`, `worms_eye`,
`two_shot`, `extreme_close_up`.

### Model choice

- Primary: `nano-banana-pro-preview` (Gemini 2.5 Flash Image) —
  natively accepts multi-part input (text + inline image refs) via the
  `generateContent` endpoint. No Vertex AI credentials required.
- Guide images are sent as `inlineData` parts (base64) with MIME type.

### Data model

New Firestore collection `shotTemplates`:

```ts
{
  id: string,                  // uuid
  universeId: string | null,   // scoped to universe or global
  episodeId: string | null,    // optional episode scoping
  createdBy: string,           // wallet address
  name: string,
  description: string,
  anglePreset: string | null,  // camera preset id
  controls: Array<{
    controlType: 'subject' | 'style' | 'scribble' | 'pose' | 'depth' | 'canny' | 'shot_reference',
    guideImageUrl: string,
    guideContentHash: string,
    strength: number,          // 0.0–1.0
  }>,
  basePrompt: string,          // prompt template users can extend
  createdAt: Date,
  updatedAt: Date,
}
```

### API surface

- `image.generateControlled` — new tRPC mutation. Extends `image.generate`
  with `controls[]` (guide URL + type + strength), `anglePreset`, and
  optional `shotTemplateId` to load a saved template.
- `shotTemplates.*` — CRUD router: `create`, `list`, `get`, `update`,
  `delete`, `apply` (returns the controls + base prompt for use in a
  generate call).

### UI

Route: `/studio-controlled` (standalone Studio route).

Components:

- `ControlledGenerate.tsx` — prompt box, angle preset picker, guide
  upload slots (up to 4), per-control strength sliders, save-as-template.
- Reuses existing `DirectUpload.tsx` for guide uploads.

## Deferred to v2

- True ControlNet weighting via Vertex Imagen 3 capability model
  (`imagen-3.0-capability-001`) — requires Vertex AI credentials & GCP
  billing; current build works with the free-tier Gemini key.
- Segmentation-map conditioning (needs a pre-processing service).
- Depth-map auto-extraction from uploaded photos.
