/**
 * 3D model registry types.
 *
 * Covers text-to-3d, image-to-3d (single + multi-image), retexture,
 * remesh, rigging, and animation. Pricing in `Meshy credits` for Meshy
 * endpoints (we convert to USD using the user's tier rate; FAL passthroughs
 * are billed in USD directly).
 */

export type ThreedTask =
  | 'text_to_3d_preview'
  | 'text_to_3d_refine'
  | 'image_to_3d'
  | 'multi_image_to_3d'
  | 'retexture'
  | 'remesh'
  | 'rigging'
  | 'animation';

export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';

export interface ThreedModelConfig {
  id: string;
  provider: 'meshy' | 'fal';
  displayName: string;
  shortDescription: string;

  /** Provider-side endpoint or model identifier. */
  providerEndpoint: string;

  task: ThreedTask;

  /** Output mesh formats. */
  outputFormats: Array<'glb' | 'fbx' | 'obj' | 'usdz' | 'stl' | '3mf' | 'blend' | 'gltf'>;

  /** Texture map types produced (image-to-3d, retexture). */
  producesPbr: boolean;
  producesTexture4k: boolean;

  /** Max polycount when the API exposes it. */
  maxPolycount?: number;

  // ── Pricing ─────────────────────────────────────────────────────
  /** Native credit cost on the provider (Meshy uses internal credits). */
  providerCreditCost: number;
  /** USD equivalent at the provider's Pro-tier rate ($0.020/Meshy credit). */
  providerCostUsd: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  /** Our internal $LOAR credits charged per generation. */
  creditCost: number;
  lastVerified: string;

  // ── Tiers / gating ───────────────────────────────────────────────
  qualityTier: QualityTier;
  speedTier: SpeedTier;

  isEnabled: boolean;
  isVisibleToUsers: boolean;
  allowedPlans: string[];
  serverPoolAvailable: boolean;

  tags: string[];
  bestFor: string;
}
