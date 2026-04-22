import {
  STYLE_PRESETS,
  RESTYLE_MODELS,
  INTERPOLATE_MULTIPLIERS,
  VIDEO_DURATIONS,
  VIDEO_RESOLUTIONS,
  OUTPAINT_ASPECTS,
} from '../components/sandbox/constants';

export type VideoModel = 'fal-kling' | 'fal-wan25' | 'fal-veo3' | 'seedance' | 'seedance-fast';
export type ImageSize = 'landscape_16_9' | 'portrait_16_9' | 'square_hd';
export type AspectRatio = '16:9' | '9:16' | '1:1';

export type ReferenceMode = 'animate' | 'style';
export type GenKind = 'image' | 'video' | 'audio' | '3d-model';

export type SandboxMode = 'image' | 'video' | 'voice' | 'audio' | '3d' | 'talking';

export type StylePresetId = (typeof STYLE_PRESETS)[number]['id'];
export type RestyleModelId = (typeof RESTYLE_MODELS)[number]['id'];
export type InterpolateMultiplier = (typeof INTERPOLATE_MULTIPLIERS)[number];
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type OutpaintAspect = (typeof OUTPAINT_ASPECTS)[number];
export type CameraIntensity = 'subtle' | 'standard' | 'pronounced';

export type EditOp =
  | 'upscale'
  | 'remove-bg'
  | 'relight'
  | 'outpaint'
  | 'restyle'
  | 'extend'
  | 'interpolate';

export type Generation = {
  id: string;
  kind: GenKind;
  prompt: string;
  status: 'generating' | 'done' | 'failed';
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  sourceImageUrl?: string;
  referenceMode?: ReferenceMode;
  negativePrompt?: string;
  seed?: number;
  stylePresetId?: string;
  imageModel?: string;
  videoModel?: VideoModel;
  imageSize: ImageSize;
  aspectRatio: AspectRatio;
  videoDurationSec?: number;
  videoResolution?: VideoResolution;
  cameraPreset?: string;
  cameraIntensity?: CameraIntensity;
  videoAudio?: boolean;
  pollGenerationId?: string;
  audioFlavor?: 'tts' | 'sfx' | 'music';
  error?: string;
  draftId?: string;
  draftSaveError?: string;
  retryCount?: number;
  createdAt: number;
};

export interface DraftData {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl?: string | null;
  modelUrl?: string | null;
  thumbnailUrl?: string | null;
  kind?: string | null;
  model: string | null;
  tags: string[];
  status: string;
  createdAt: string | null;
}
