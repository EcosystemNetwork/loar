/**
 * Maps the segment dialog's friendly model choices onto the ids the server's
 * `generation.generateVideo` accepts, for both text-to-video and image-to-video.
 *
 * Every id here must appear in that procedure's zod enum (a test guards this) —
 * an id outside it fails input validation before any generation starts.
 */
import type { AspectRatio, VideoModel } from '@/types/segments';

interface ModelIds {
  text: string;
  image: string;
}

/** Non-Google models: one row per dialog choice. Google-direct Veo is dual-mode (below). */
const FAL_MODEL_IDS: Partial<Record<VideoModel, ModelIds>> = {
  'fal-veo3': { text: 'fal-ai/veo3.1/fast', image: 'fal-ai/veo3.1/fast/image-to-video' },
  'fal-kling': {
    text: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    image: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  },
  'fal-wan25': {
    text: 'fal-ai/wan-25-preview/text-to-video',
    image: 'fal-ai/wan-25-preview/image-to-video',
  },
  'fal-sora': {
    text: 'fal-ai/sora-2/text-to-video',
    image: 'fal-ai/sora-2/image-to-video',
  },
  'seedance-fast': {
    text: 'bytedance/seedance-2.0/fast/text-to-video',
    image: 'bytedance/seedance-2.0/fast/image-to-video',
  },
  seedance: {
    text: 'bytedance/seedance-2.0/text-to-video',
    image: 'bytedance/seedance-2.0/image-to-video',
  },
};

/** Every server model id this module can return — exported for the enum-drift test. */
export const SEGMENT_SERVER_MODEL_IDS: string[] = Object.values(FAL_MODEL_IDS).flatMap((m) =>
  m ? [m.text, m.image] : []
);

/**
 * Server model id for a dialog model choice. Google-direct Veo ids ARE the
 * server ids (one dual-mode id that picks t2v/i2v from the presence of an
 * image), so they pass through unchanged.
 */
export function resolveSegmentVideoModel(model: VideoModel, hasImage: boolean): string | undefined {
  if (model.endsWith('-google')) return model;
  const ids = FAL_MODEL_IDS[model];
  return ids ? (hasImage ? ids.image : ids.text) : undefined;
}

/** `image.imageToImage` size preset matching a video aspect ratio, so the frame isn't cropped later. */
export function aspectRatioToImageSize(
  aspect: AspectRatio
): 'landscape_16_9' | 'portrait_16_9' | 'square_hd' {
  switch (aspect) {
    case '9:16':
      return 'portrait_16_9';
    case '1:1':
      return 'square_hd';
    case '16:9':
    default:
      return 'landscape_16_9';
  }
}
