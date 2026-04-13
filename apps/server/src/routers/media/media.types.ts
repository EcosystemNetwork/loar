export const MEDIA_CATEGORIES = [
  'image',
  'video',
  'music',
  'sound',
  'environment',
  '3d',
  'texture',
  'animation',
  'rig',
  'document',
  'design',
  'other',
] as const;

export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const MEDIA_CATEGORY_LABELS: Record<MediaCategory, string> = {
  image: 'Image / Artwork',
  video: 'Video / Animation',
  music: 'Music / Score',
  sound: 'Sound Effect',
  environment: 'Environment / Ambiance',
  '3d': '3D Model / Scene',
  texture: 'Texture Map',
  animation: 'Animation',
  rig: 'Rig / Skeleton',
  document: 'Document / Script',
  design: 'Design File',
  other: 'Other',
};

/** Sub-categories for finer-grained asset classification. */
export const TEXTURE_SUB_CATEGORIES = [
  'diffuse',
  'normal',
  'roughness',
  'metallic',
  'emissive',
  'ao',
  'height',
  'opacity',
  'other',
] as const;
export type TextureSubCategory = (typeof TEXTURE_SUB_CATEGORIES)[number];

export const ANIMATION_SUB_CATEGORIES = [
  'idle',
  'walk',
  'run',
  'attack',
  'emote',
  'cutscene',
  'lipsync',
  'other',
] as const;
export type AnimationSubCategory = (typeof ANIMATION_SUB_CATEGORIES)[number];

export const IMAGE_SUB_CATEGORIES = [
  'portrait',
  'full_body',
  'concept_art',
  'turnaround',
  'expression_sheet',
  'other',
] as const;
export type ImageSubCategory = (typeof IMAGE_SUB_CATEGORIES)[number];

export const THREE_D_SUB_CATEGORIES = [
  'high_poly',
  'low_poly',
  'game_ready',
  'sculpt',
  'preview',
  'other',
] as const;
export type ThreeDSubCategory = (typeof THREE_D_SUB_CATEGORIES)[number];

export type SubCategory =
  | TextureSubCategory
  | AnimationSubCategory
  | ImageSubCategory
  | ThreeDSubCategory
  | string;

export const ATTACHMENT_TARGET_TYPES = ['universe', 'entity'] as const;
export type AttachmentTargetType = (typeof ATTACHMENT_TARGET_TYPES)[number];

export interface MediaAttachment {
  id: string;
  contentHash: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  url: string;
  targetType: AttachmentTargetType;
  targetId: string;
  targetName: string;
  category: MediaCategory;
  label: string;
  /** Finer-grained classification within a category (e.g. 'diffuse' for textures). */
  subCategory: SubCategory | null;
  /** Version number for tracking iterations of the same asset. */
  version: number;
  /** ID of the attachment this is a variant of (e.g. anime vs realistic style). */
  variantOf: string | null;
  /** Human-readable variant label (e.g. "Anime Style", "Realistic", "Battle Armor"). */
  variantLabel: string | null;
  /** Sort order within a category for manual ordering. Lower = first. */
  sortOrder: number;
  /** Source generation ID if this was AI-generated (links to imageGenerations / threeDGenerations). */
  generationId: string | null;
  creator: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAttachmentInput {
  contentHash: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  url: string;
  targetType: AttachmentTargetType;
  targetId: string;
  targetName: string;
  category: MediaCategory;
  label: string;
  subCategory?: SubCategory | null;
  version?: number;
  variantOf?: string | null;
  variantLabel?: string | null;
  sortOrder?: number;
  generationId?: string | null;
}

export interface UpdateAttachmentInput {
  id: string;
  category?: MediaCategory;
  label?: string;
  subCategory?: SubCategory | null;
  version?: number;
  variantOf?: string | null;
  variantLabel?: string | null;
  sortOrder?: number;
  targetType?: AttachmentTargetType;
  targetId?: string;
  targetName?: string;
}
