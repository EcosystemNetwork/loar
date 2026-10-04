/**
 * 3D model registry.
 *
 * Meshy and Tripo3D are the direct providers (both BYOK); `auto` routing in
 * threed.routes prefers Tripo when the user has a Tripo key. Selected FAL
 * passthroughs cover text-to-3d and multi-image-to-3d. Provider credits
 * are converted to USD at Meshy's Pro-tier rate (~$0.020/credit) — verify
 * during integration. The user's BYOK key can route directly to Meshy.
 */
import type { ThreedModelConfig } from './types';

export { FIAT_MARGIN, LOAR_MARGIN, LOAR_TO_USD } from '../video-models/registry';
import { FIAT_MARGIN, LOAR_MARGIN, LOAR_TO_USD } from '../video-models/registry';

/** Pro-tier conversion: $0.020 per Meshy credit. */
const MESHY_CREDIT_TO_USD = 0.02;

function withFiatMargin(c: number): number {
  return Math.round(c * FIAT_MARGIN * 100) / 100;
}
function withLoarMargin(c: number): number {
  return Math.round(c * LOAR_MARGIN * 100) / 100;
}
function usdToCredits(usd: number): number {
  return Math.max(1, Math.ceil(usd / LOAR_TO_USD));
}

function meshyEntry(args: {
  providerCredits: number;
}): Pick<
  ThreedModelConfig,
  'providerCreditCost' | 'providerCostUsd' | 'fiatPriceUsd' | 'loarPriceUsd' | 'creditCost'
> {
  const providerUsd = args.providerCredits * MESHY_CREDIT_TO_USD;
  return {
    providerCreditCost: args.providerCredits,
    providerCostUsd: providerUsd,
    fiatPriceUsd: withFiatMargin(providerUsd),
    loarPriceUsd: withLoarMargin(providerUsd),
    creditCost: usdToCredits(withFiatMargin(providerUsd)),
  };
}

/** Tripo bills $0.01 per Tripo credit; costs are entered in USD. */
function tripoEntry(args: {
  providerUsd: number;
}): Pick<
  ThreedModelConfig,
  'providerCreditCost' | 'providerCostUsd' | 'fiatPriceUsd' | 'loarPriceUsd' | 'creditCost'
> {
  return {
    providerCreditCost: Math.round(args.providerUsd * 100),
    providerCostUsd: args.providerUsd,
    fiatPriceUsd: withFiatMargin(args.providerUsd),
    loarPriceUsd: withLoarMargin(args.providerUsd),
    creditCost: usdToCredits(withFiatMargin(args.providerUsd)),
  };
}

function falEntry(args: {
  providerUsd: number;
}): Pick<
  ThreedModelConfig,
  'providerCreditCost' | 'providerCostUsd' | 'fiatPriceUsd' | 'loarPriceUsd' | 'creditCost'
> {
  return {
    providerCreditCost: 0,
    providerCostUsd: args.providerUsd,
    fiatPriceUsd: withFiatMargin(args.providerUsd),
    loarPriceUsd: withLoarMargin(args.providerUsd),
    creditCost: usdToCredits(withFiatMargin(args.providerUsd)),
  };
}

export const THREED_MODELS: ThreedModelConfig[] = [
  // ── Meshy text-to-3D ─────────────────────────────────────────────────
  {
    id: 'meshy-text-to-3d-preview',
    provider: 'meshy',
    displayName: 'Meshy Text-to-3D Preview',
    shortDescription: 'Geometry-only preview (no textures)',
    providerEndpoint: '/openapi/v2/text-to-3d',
    task: 'text_to_3d_preview',
    outputFormats: ['glb', 'fbx', 'obj', 'usdz', 'stl', '3mf'],
    producesPbr: false,
    producesTexture4k: false,
    maxPolycount: 300_000,
    qualityTier: 'standard',
    speedTier: 'medium',
    ...meshyEntry({ providerCredits: 10 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'text-to-3d', 'preview'],
    bestFor: 'Quick geometry preview before committing to refine',
  },
  {
    id: 'meshy-text-to-3d-refine',
    provider: 'meshy',
    displayName: 'Meshy Text-to-3D Refine',
    shortDescription: 'Add PBR textures + high-fidelity geometry to a preview',
    providerEndpoint: '/openapi/v2/text-to-3d',
    task: 'text_to_3d_refine',
    outputFormats: ['glb', 'fbx', 'obj', 'usdz', 'stl', '3mf'],
    producesPbr: true,
    producesTexture4k: true,
    maxPolycount: 300_000,
    qualityTier: 'premium',
    speedTier: 'slow',
    ...meshyEntry({ providerCredits: 10 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'text-to-3d', 'refine', 'pbr'],
    bestFor: 'Final textured mesh after preview approval',
  },
  // ── Meshy image-to-3D ────────────────────────────────────────────────
  {
    id: 'meshy-image-to-3d',
    provider: 'meshy',
    displayName: 'Meshy Image-to-3D',
    shortDescription: 'Single-image to textured 3D mesh',
    providerEndpoint: '/openapi/v1/image-to-3d',
    task: 'image_to_3d',
    outputFormats: ['glb', 'fbx', 'obj', 'usdz', 'stl', '3mf'],
    producesPbr: true,
    producesTexture4k: true,
    maxPolycount: 300_000,
    qualityTier: 'premium',
    speedTier: 'medium',
    ...meshyEntry({ providerCredits: 30 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'image-to-3d', 'pbr', '4k-tex'],
    bestFor: 'Turning a character concept image into a textured mesh',
  },
  {
    id: 'meshy-multi-image-to-3d',
    provider: 'meshy',
    displayName: 'Meshy Multi-Image to 3D',
    shortDescription: '1-4 reference images → mesh (more accurate geometry)',
    providerEndpoint: '/openapi/v1/multi-image-to-3d',
    task: 'multi_image_to_3d',
    outputFormats: ['glb', 'fbx', 'obj', 'usdz', 'stl', '3mf'],
    producesPbr: true,
    producesTexture4k: true,
    maxPolycount: 300_000,
    qualityTier: 'premium',
    speedTier: 'medium',
    ...meshyEntry({ providerCredits: 30 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'multi-image-to-3d', 'pbr', '4-view'],
    bestFor: 'Higher-fidelity mesh when you have multiple character views',
  },
  {
    id: 'meshy-retexture',
    provider: 'meshy',
    displayName: 'Meshy Retexture',
    shortDescription: 'Apply new textures to an existing mesh',
    providerEndpoint: '/openapi/v1/retexture',
    task: 'retexture',
    outputFormats: ['glb', 'fbx', 'obj', 'usdz', 'stl', '3mf'],
    producesPbr: true,
    producesTexture4k: true,
    qualityTier: 'standard',
    speedTier: 'medium',
    ...meshyEntry({ providerCredits: 10 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'retexture'],
    bestFor: 'Reskinning a character with a new texture prompt',
  },
  {
    id: 'meshy-remesh',
    provider: 'meshy',
    displayName: 'Meshy Remesh',
    shortDescription: 'Retopology / decimation — quad or triangle',
    providerEndpoint: '/openapi/v1/remesh',
    task: 'remesh',
    outputFormats: ['glb', 'fbx', 'obj', 'usdz', 'stl', '3mf', 'blend'],
    producesPbr: false,
    producesTexture4k: false,
    maxPolycount: 300_000,
    qualityTier: 'standard',
    speedTier: 'fast',
    ...meshyEntry({ providerCredits: 5 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'remesh', 'retopology'],
    bestFor: 'Cleaning up topology + decimating polycount',
  },
  {
    id: 'meshy-rigging',
    provider: 'meshy',
    displayName: 'Meshy Auto-Rigging',
    shortDescription: 'Humanoid skeleton + skinning weights',
    providerEndpoint: '/openapi/v1/rigging',
    task: 'rigging',
    outputFormats: ['glb', 'fbx'],
    producesPbr: false,
    producesTexture4k: false,
    qualityTier: 'standard',
    speedTier: 'fast',
    ...meshyEntry({ providerCredits: 5 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'rigging', 'humanoid'],
    bestFor: 'Auto-rigging humanoid characters for animation',
  },
  {
    id: 'meshy-animation',
    provider: 'meshy',
    displayName: 'Meshy Animation',
    shortDescription: '500+ animation clips applied to a rigged mesh',
    providerEndpoint: '/openapi/v1/animations',
    task: 'animation',
    outputFormats: ['glb', 'fbx', 'usdz'],
    producesPbr: false,
    producesTexture4k: false,
    qualityTier: 'standard',
    speedTier: 'fast',
    ...meshyEntry({ providerCredits: 3 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'meshy', 'animation', 'rig-required'],
    bestFor: 'Applying canned animation clips (walk, run, idle, dance, fight)',
  },

  // ── Tripo3D (OpenAPI v3, BYOK) ───────────────────────────────────────
  ...(
    [
      [
        'tripo-text-to-3d-hifi',
        'text_to_3d_preview',
        'Tripo3D Text-to-3D (H3.1)',
        'High-detail textured PBR mesh from a prompt — no refine step',
        '/v3/generation/text-to-model',
        'premium',
        0.4,
        'Finished, high-detail models straight from a prompt',
      ],
      [
        'tripo-text-to-3d-game',
        'text_to_3d_preview',
        'Tripo3D Text-to-3D (P1 game-ready)',
        'Clean low-poly topology from a prompt',
        '/v3/generation/text-to-model',
        'standard',
        0.25,
        'Game-engine props and characters with clean topology',
      ],
      [
        'tripo-image-to-3d-hifi',
        'image_to_3d',
        'Tripo3D Image-to-3D (H3.1)',
        'High-detail textured PBR mesh from one image',
        '/v3/generation/image-to-model',
        'premium',
        0.4,
        'Turning concept art into a faithful model',
      ],
      [
        'tripo-image-to-3d-game',
        'image_to_3d',
        'Tripo3D Image-to-3D (P1 game-ready)',
        'Clean low-poly topology from one image',
        '/v3/generation/image-to-model',
        'standard',
        0.25,
        'Game-ready assets from concept art',
      ],
      [
        'tripo-multiview-to-3d-hifi',
        'multi_image_to_3d',
        'Tripo3D Multiview-to-3D (H3.1)',
        'Front/left/back/right views to a high-detail mesh',
        '/v3/generation/multiview-to-model',
        'premium',
        0.4,
        'Character turnarounds',
      ],
      [
        'tripo-multiview-to-3d-game',
        'multi_image_to_3d',
        'Tripo3D Multiview-to-3D (P1 game-ready)',
        'Front/left/back/right views to clean low-poly topology',
        '/v3/generation/multiview-to-model',
        'standard',
        0.25,
        'Game-ready characters from a turnaround',
      ],
      [
        'tripo-retexture',
        'retexture',
        'Tripo3D Retexture',
        'Re-texture a mesh from a text or style-image prompt',
        '/v3/models/texture',
        'standard',
        0.3,
        'Restyling a model to match a universe look',
      ],
      [
        'tripo-remesh',
        'remesh',
        'Tripo3D Convert / Remesh',
        'Quad retopology + polygon budget, GLB/FBX/OBJ/USDZ',
        '/v3/models/convert',
        'standard',
        0.1,
        'Engine-ready quad meshes at a target polycount',
      ],
      [
        'tripo-rigging',
        'rigging',
        'Tripo3D Auto-Rigging',
        'Humanoids, monsters, beasts, insects, spiders, birds, snakes, fish',
        '/v3/animations/rig',
        'standard',
        0.3,
        'Rigging anything — auto-detects the skeleton',
      ],
      [
        'tripo-animation',
        'animation',
        'Tripo3D Animation Retarget',
        'Preset motions for every rig type',
        '/v3/animations/retarget',
        'standard',
        0.1,
        'Walk / run / attack / slither / swim clips on any rig',
      ],
    ] as const
  ).map(
    ([
      id,
      task,
      displayName,
      shortDescription,
      providerEndpoint,
      qualityTier,
      usd,
      bestFor,
    ]): ThreedModelConfig => ({
      id,
      provider: 'tripo',
      displayName,
      shortDescription,
      providerEndpoint,
      task,
      outputFormats: task === 'remesh' ? ['glb', 'fbx', 'obj', 'usdz', 'stl', '3mf'] : ['glb'],
      producesPbr: task !== 'remesh' && task !== 'rigging' && task !== 'animation',
      producesTexture4k: false,
      qualityTier,
      speedTier: 'medium',
      ...tripoEntry({ providerUsd: usd }),
      lastVerified: '2026-10-04',
      isEnabled: true,
      isVisibleToUsers: true,
      allowedPlans: [],
      // BYOK only — no platform Tripo key.
      serverPoolAvailable: false,
      tags: ['3d', 'tripo', task.replace(/_/g, '-')],
      bestFor,
    })
  ),

  // ── FAL 3D passthroughs ──────────────────────────────────────────────
  {
    id: 'meshy-v6-multi-image-fal',
    provider: 'fal',
    displayName: 'Meshy v6 Multi-Image (via FAL)',
    shortDescription: 'Meshy v6 multi-image-to-3D — FAL hosted',
    providerEndpoint: 'fal-ai/meshy/v6/multi-image-to-3d',
    task: 'multi_image_to_3d',
    outputFormats: ['glb', 'fbx', 'obj'],
    producesPbr: true,
    producesTexture4k: true,
    qualityTier: 'premium',
    speedTier: 'medium',
    ...falEntry({ providerUsd: 0.8 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: false, // direct Meshy preferred
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'fal', 'meshy', 'v6', 'multi-image'],
    bestFor: 'Fallback when direct Meshy unavailable',
  },
  {
    id: 'hunyuan-3d-text-fal',
    provider: 'fal',
    displayName: 'Hunyuan 3D v3.1 Rapid (via FAL)',
    shortDescription: 'Text-to-3D via Tencent Hunyuan 3D, textured',
    providerEndpoint: 'fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d',
    task: 'text_to_3d_refine',
    outputFormats: ['glb', 'obj'],
    producesPbr: true,
    producesTexture4k: false,
    qualityTier: 'standard',
    speedTier: 'fast',
    ...falEntry({ providerUsd: 0.5 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'fal', 'hunyuan', 'text-to-3d', 'rapid'],
    bestFor: 'Cheap alternative to Meshy for text-to-3d',
  },
  {
    id: 'pixal-3d-fal',
    provider: 'fal',
    displayName: 'Pixal3D (via FAL)',
    shortDescription: 'Image-to-3D via Pixal3D',
    providerEndpoint: 'fal-ai/pixal3d',
    task: 'image_to_3d',
    outputFormats: ['glb', 'obj'],
    producesPbr: true,
    producesTexture4k: false,
    qualityTier: 'standard',
    speedTier: 'medium',
    ...falEntry({ providerUsd: 0.4 }),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['3d', 'fal', 'pixal3d', 'image-to-3d'],
    bestFor: 'Mid-tier image-to-3D without Meshy BYOK',
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────

export function getThreedModelById(id: string): ThreedModelConfig | undefined {
  return THREED_MODELS.find((m) => m.id === id);
}

export function getEnabledThreedModels(): ThreedModelConfig[] {
  return THREED_MODELS.filter((m) => m.isEnabled);
}

export function getVisibleThreedModels(): ThreedModelConfig[] {
  return THREED_MODELS.filter((m) => m.isEnabled && m.isVisibleToUsers);
}

export function getThreedModelIds(): string[] {
  return THREED_MODELS.map((m) => m.id);
}

export function getModelsByTask(task: ThreedModelConfig['task']): ThreedModelConfig[] {
  return getVisibleThreedModels().filter((m) => m.task === task);
}
