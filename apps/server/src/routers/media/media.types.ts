export const MEDIA_CATEGORIES = [
  'image',
  'video',
  'music',
  'sound',
  'environment',
  '3d',
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
  document: 'Document / Script',
  design: 'Design File',
  other: 'Other',
};

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
}

export interface UpdateAttachmentInput {
  id: string;
  category?: MediaCategory;
  label?: string;
  targetType?: AttachmentTargetType;
  targetId?: string;
  targetName?: string;
}
