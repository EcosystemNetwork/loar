import * as fal from '@fal-ai/serverless-client';

export interface FalImageGenerationOptions {
  prompt: string;
  model?:
    | 'fal-ai/nano-banana'
    | 'fal-ai/nano-banana-2'
    | 'fal-ai/nano-banana-pro'
    | 'fal-ai/flux/schnell'
    | 'fal-ai/flux/dev'
    | 'fal-ai/flux-pro'
    | 'fal-ai/flux-pro/v1.1'
    | 'fal-ai/flux-2-pro'
    | 'fal-ai/flux-pro/kontext'
    | 'fal-ai/recraft/v4/pro/text-to-image'
    | 'fal-ai/ideogram/v3/generate'
    | 'fal-ai/bytedance/seedream/v5/lite/edit'
    | 'fal-ai/gpt-image-1.5/edit'
    | 'fal-ai/wan/v2.7/text-to-image'
    | 'fal-ai/qwen-image';
  negativePrompt?: string;
  imageSize?:
    | 'square_hd'
    | 'square'
    | 'portrait_4_3'
    | 'portrait_16_9'
    | 'landscape_4_3'
    | 'landscape_16_9';
  numInferenceSteps?: number;
  guidanceScale?: number;
  numImages?: number;
  seed?: number;
  enableSafetyChecker?: boolean;
}

export interface FalImageEditOptions {
  prompt: string;
  imageUrls: string[];
  numImages?: number;
  strength?: number;
  negativePrompt?: string;
  numInferenceSteps?: number;
  guidanceScale?: number;
  seed?: number;
  enableSafetyChecker?: boolean;
}

export interface FalImageToImageOptions {
  prompt: string;
  imageUrls: string[];
  negativePrompt?: string;
  imageSize?:
    | 'square_hd'
    | 'square'
    | 'portrait_4_3'
    | 'portrait_16_9'
    | 'landscape_4_3'
    | 'landscape_16_9'
    | { width: number; height: number };
  numImages?: number;
  seed?: number;
}

export interface FalImageGenerationResult {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  imageUrl?: string;
  images?: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
  seed?: number;
  error?: string;
}

// ── Audio Generation Types ────────────────────────────────────────────

export interface FalAudioGenerationOptions {
  prompt: string;
  model?: 'fal-ai/stable-audio' | 'fal-ai/musicgen/large' | 'fal-ai/musicgen/stereo-large';
  durationSec?: number;
  steps?: number;
}

export interface FalAudioGenerationResult {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  audioUrl?: string;
  error?: string;
}

export interface FalVideoGenerationOptions {
  prompt: string;
  model?: // Text-to-Video models
    | 'fal-ai/hunyuan-video'
    | 'fal-ai/ltx-video'
    | 'fal-ai/cogvideox-5b'
    | 'fal-ai/runway-gen3'
    | 'fal-ai/veo3.1/fast'
    | 'fal-ai/veo3.1'
    | 'fal-ai/veo3.1/lite'
    | 'fal-ai/sora-2/text-to-video'
    | 'fal-ai/sora-2/text-to-video/pro'
    | 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video'
    | 'fal-ai/wan-25-preview/text-to-video'
    | 'fal-ai/wan/v2.7/text-to-video'
    | 'fal-ai/pixverse/v6/text-to-video'
    // Image-to-Video models
    | 'fal-ai/veo3.1/fast/image-to-video'
    | 'fal-ai/veo3.1/image-to-video'
    | 'fal-ai/veo3.1/lite/image-to-video'
    | 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'
    | 'fal-ai/kling-video/v3/pro/image-to-video'
    | 'fal-ai/wan-25-preview/image-to-video'
    | 'fal-ai/wan/v2.7/image-to-video'
    | 'fal-ai/sora-2/image-to-video'
    | 'fal-ai/sora-2/image-to-video/pro'
    | 'fal-ai/pixverse/v6/image-to-video'
    // Seedance 2.0 models
    | 'bytedance/seedance-2.0/text-to-video'
    | 'bytedance/seedance-2.0/image-to-video'
    | 'bytedance/seedance-2.0/fast/text-to-video'
    | 'bytedance/seedance-2.0/fast/image-to-video'
    | 'bytedance/seedance-2.0/reference-to-video'
    | 'bytedance/seedance-2.0/fast/reference-to-video';
  imageUrl?: string;
  endImageUrl?: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  guidanceScale?: number;
  numInferenceSteps?: number;
  aspectRatio?: string; // can be "16:9", "9:16", "1:1", or "auto"
  motionStrength?: number;
  negativePrompt?: string;
  cfgScale?: number;
  resolution?: '480p' | '720p' | '1080p' | 'auto';
  enablePromptExpansion?: boolean;
  generateAudio?: boolean;
  seed?: number;
}

export interface FalVideoGenerationResult {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

export class FalService {
  private configured = false;

  constructor() {
    // Defer config check — env vars may not be loaded yet (ESM hoisting)
  }

  private ensureConfigured() {
    if (!this.configured && process.env.FAL_KEY) {
      fal.config({ credentials: process.env.FAL_KEY });
      this.configured = true;
    }
    if (!this.configured) {
      throw new Error('FAL_KEY environment variable is required for AI generation');
    }
  }

  async generateImage(options: FalImageGenerationOptions): Promise<FalImageGenerationResult> {
    this.ensureConfigured();

    try {
      const model = options.model || 'fal-ai/nano-banana';

      const input: any = { prompt: options.prompt };
      if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
      if (options.imageSize) input.image_size = options.imageSize;
      if (options.numInferenceSteps) input.num_inference_steps = options.numInferenceSteps;
      if (options.guidanceScale) input.guidance_scale = options.guidanceScale;
      if (options.numImages) input.num_images = options.numImages;
      if (options.seed) input.seed = options.seed;
      if (options.enableSafetyChecker !== undefined)
        input.enable_safety_checker = options.enableSafetyChecker;

      const result = await fal.subscribe(model, {
        input,
        logs: true,
      });

      // Parse the response
      let data: any;
      if ((result as any).data) data = (result as any).data;
      else if ((result as any).images || (result as any).image) data = result;
      else
        throw new Error(
          `No data in FAL response. Available keys: ${Object.keys(result as any).join(', ')}`
        );

      // Extract images
      let images: Array<{ url: string; width?: number; height?: number; content_type?: string }> =
        [];
      if (data.images && Array.isArray(data.images)) images = data.images;
      else if (data.image) images = [{ url: data.image }];
      else if (typeof data === 'string') images = [{ url: data }];
      else if (data.url) images = [{ url: data.url }];

      if (images.length === 0 || !images[0]?.url) {
        throw new Error(`No image URLs found. Response keys: ${Object.keys(data).join(', ')}`);
      }

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        imageUrl: images[0].url,
        images,
        seed: data.seed,
      };
    } catch (error) {
      console.error('❌ FAL Image Generation Failed:', error);
      return {
        id: Date.now().toString(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async editImage(options: FalImageEditOptions): Promise<FalImageGenerationResult> {
    this.ensureConfigured();

    try {
      const model = 'fal-ai/nano-banana/edit';
      const input: any = {
        prompt: options.prompt,
        image_urls: options.imageUrls,
        num_images: options.numImages || 1,
        output_format: 'png',
        sync_mode: false,
      };

      const result = await fal.subscribe(model, {
        input,
        logs: true,
      });

      let responseData: any;
      if ((result as any).data) responseData = (result as any).data;
      else if ((result as any).images) responseData = result;
      else
        throw new Error(
          `Unexpected FAL response structure. Keys: ${Object.keys(result as any).join(', ')}`
        );

      if (!responseData.images || !Array.isArray(responseData.images)) {
        throw new Error(
          `Expected 'images' array in response. Got keys: ${Object.keys(responseData).join(', ')}`
        );
      }

      const images = responseData.images;
      if (images.length === 0 || !images[0]?.url) {
        throw new Error('Images array is empty or missing URLs');
      }

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        imageUrl: images[0].url,
        images,
        seed: responseData.seed,
      };
    } catch (error) {
      console.error('❌ FAL Image Edit Failed:', error);
      return {
        id: Date.now().toString(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async imageToImage(options: FalImageToImageOptions): Promise<FalImageGenerationResult> {
    this.ensureConfigured();

    try {
      const model = 'fal-ai/nano-banana/edit';

      // Map image size to aspect ratio for nano banana
      const mapImageSizeToAspectRatio = (
        imageSize?: string | { width: number; height: number }
      ): string | undefined => {
        if (!imageSize || typeof imageSize === 'object') return undefined;

        const mapping: Record<string, string> = {
          landscape_16_9: '16:9',
          portrait_16_9: '9:16',
          landscape_4_3: '4:3',
          portrait_4_3: '3:4',
          landscape_2_3: '2:3',
          portrait_2_3: '3:2',
          square: '1:1',
          square_hd: '1:1',
        };

        return mapping[imageSize];
      };

      // Validate and process image URLs
      const validImageUrls: string[] = [];

      for (const url of options.imageUrls) {
        if (!url || typeof url !== 'string' || url.trim() === '') {
          continue;
        }

        const trimmedUrl = url.trim();

        // Check if it's a data URI (base64)
        if (trimmedUrl.startsWith('data:')) {
          validImageUrls.push(trimmedUrl);
          continue;
        }

        // Check if it's a valid URL
        try {
          new URL(trimmedUrl);
          validImageUrls.push(trimmedUrl);
        } catch {
          /* invalid URL, skip */
        }
      }

      if (validImageUrls.length === 0) {
        throw new Error('No valid image URLs provided');
      }

      // Map aspect ratio if provided
      const aspectRatio = mapImageSizeToAspectRatio(options.imageSize);

      const input: any = {
        prompt: options.prompt,
        image_urls: validImageUrls,
        num_images: options.numImages || 1,
        output_format: 'jpeg',
      };

      // Only add aspect_ratio if it's provided (as per API docs)
      if (aspectRatio) {
        input.aspect_ratio = aspectRatio;
      }

      const result = await fal.subscribe(model, {
        input,
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === 'IN_PROGRESS') {
            // queue progress
          }
        },
      });

      // Parse response using same strategy as generateImage (which works!)
      let data: any;
      if ((result as any).data) {
        data = (result as any).data;
      } else if ((result as any).images) {
        data = result;
      } else {
        throw new Error(
          `No data in FAL response. Available keys: ${Object.keys(result as any).join(', ')}`
        );
      }

      // Extract images using same strategy as generateImage
      let images: Array<{ url: string; width?: number; height?: number; content_type?: string }> =
        [];
      if (data.images && Array.isArray(data.images)) {
        images = data.images;
      } else if (data.image) {
        images = [{ url: data.image }];
      } else if (typeof data === 'string') {
        images = [{ url: data }];
      } else if (data.url) {
        images = [{ url: data.url }];
      }

      if (images.length === 0 || !images[0]?.url) {
        throw new Error(`No image URLs found. Response keys: ${Object.keys(data).join(', ')}`);
      }

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        imageUrl: images[0].url,
        images,
        seed: data.seed,
      };
    } catch (error) {
      console.error('❌ Nano Banana Edit Failed:', error);
      return {
        id: Date.now().toString(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async generateVideo(options: FalVideoGenerationOptions): Promise<FalVideoGenerationResult> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/ltx-video';
      const input: any = { prompt: options.prompt };

      if (model === 'fal-ai/veo3.1/fast') {
        // Text-to-video model (no image required)

        // Veo3.1 only supports 8s duration
        input.duration = '8s';

        // Aspect ratio
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        }

        // Resolution
        if (options.resolution) {
          input.resolution = options.resolution;
        }

        // Generate audio (optional)
        if (options.generateAudio === true) {
          input.generate_audio = true;
        }
      } else if (model === 'fal-ai/veo3.1/fast/image-to-video') {
        // Image-to-video model (image required)
        if (!options.imageUrl)
          throw new Error('Image URL is required for Veo3.1 image-to-video model');

        input.image_url = options.imageUrl;

        // Veo3.1 only supports 8s duration
        input.duration = '8s';

        // If aspect_ratio is provided and NOT "auto", use it
        // Otherwise let Veo3.1 auto-detect from image
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        } else {
          // For veo3.1, omit aspect_ratio to let it auto-detect
          // or explicitly set to "auto"
          input.aspect_ratio = 'auto';
        }

        // Resolution for veo3.1 - defaults to 720p
        // Only include if specified
        if (options.resolution) {
          input.resolution = options.resolution;
        }

        // Generate audio (optional) - only include if explicitly set
        if (options.generateAudio === true) {
          input.generate_audio = true;
        }
      } else if (model === 'fal-ai/wan-25-preview/image-to-video') {
        if (!options.imageUrl)
          throw new Error('Image URL is required for wan25 image-to-video model');
        input.image_url = options.imageUrl;
        input.duration = String(options.duration || 5);
        input.resolution = options.resolution || '1080p';
        if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
        if (options.enablePromptExpansion !== undefined)
          input.enable_prompt_expansion = options.enablePromptExpansion;
      } else if (model === 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video') {
        if (!options.imageUrl) throw new Error('Image URL is required for kling v2.5 turbo model');
        input.image_url = options.imageUrl;
        input.duration = String(options.duration || 5);
        input.aspect_ratio = options.aspectRatio || '16:9';
        if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
        if (options.cfgScale !== undefined) input.cfg_scale = options.cfgScale;
      } else if (model === 'fal-ai/sora-2/image-to-video') {
        if (!options.imageUrl)
          throw new Error('Image URL is required for Sora 2 image-to-video model');
        input.image_url = options.imageUrl;

        // Sora-specific parameters
        input.duration = options.duration || 4; // Default to 4 seconds as shown in docs
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        } else {
          input.aspect_ratio = 'auto';
        }
        if (options.resolution && options.resolution !== 'auto') {
          input.resolution = options.resolution;
        } else {
          input.resolution = 'auto';
        }
        // Sora can generate audio naturally from prompts if needed
      } else if (model === 'fal-ai/sora-2/text-to-video') {
        // Sora 2 text-to-video (no image required)

        // Duration: 4, 8, or 12 seconds (as number)
        const validDurations = [4, 8, 12];
        input.duration = validDurations.includes(options.duration || 0) ? options.duration : 4;

        // Aspect ratio: Only "16:9" or "9:16" supported (NOT "1:1" or "auto")
        if (options.aspectRatio === '9:16' || options.aspectRatio === '16:9') {
          input.aspect_ratio = options.aspectRatio;
        } else {
          input.aspect_ratio = '16:9'; // Default to 16:9 if invalid
        }

        // Resolution: Only "720p" supported
        input.resolution = '720p';
      } else if (model === 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video') {
        // Kling text-to-video (no image required)
        input.duration = String(options.duration || 5); // 5 or 10 seconds
        input.aspect_ratio = options.aspectRatio || '16:9';
        if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
        if (options.cfgScale !== undefined) input.cfg_scale = options.cfgScale;
      } else if (model === 'fal-ai/wan-25-preview/text-to-video') {
        // Wan 2.5 text-to-video (no image required)
        input.duration = String(options.duration || 5); // 5 or 10 seconds
        input.resolution = options.resolution || '1080p';
        if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
        if (options.enablePromptExpansion !== undefined)
          input.enable_prompt_expansion = options.enablePromptExpansion;
      } else if (
        model === 'bytedance/seedance-2.0/text-to-video' ||
        model === 'bytedance/seedance-2.0/fast/text-to-video'
      ) {
        // Seedance 2.0 text-to-video
        input.duration = String(options.duration || 'auto');
        input.resolution = options.resolution === '1080p' ? '720p' : options.resolution || '720p';
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        }
        input.generate_audio = options.generateAudio ?? true;
        if (options.seed) input.seed = options.seed;
      } else if (
        model === 'bytedance/seedance-2.0/image-to-video' ||
        model === 'bytedance/seedance-2.0/fast/image-to-video'
      ) {
        // Seedance 2.0 image-to-video
        if (!options.imageUrl)
          throw new Error('Image URL is required for Seedance 2.0 image-to-video');
        input.image_url = options.imageUrl;
        if (options.endImageUrl) input.end_image_url = options.endImageUrl;
        input.duration = String(options.duration || 'auto');
        input.resolution = options.resolution === '1080p' ? '720p' : options.resolution || '720p';
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        }
        input.generate_audio = options.generateAudio ?? true;
        if (options.seed) input.seed = options.seed;
      } else if (
        model === 'bytedance/seedance-2.0/reference-to-video' ||
        model === 'bytedance/seedance-2.0/fast/reference-to-video'
      ) {
        // Seedance 2.0 reference-to-video (character-consistent)
        if (!options.imageUrl)
          throw new Error('Image URL is required for Seedance 2.0 reference-to-video');
        input.image_url = options.imageUrl;
        input.duration = String(options.duration || 'auto');
        input.resolution = options.resolution === '1080p' ? '720p' : options.resolution || '720p';
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        }
        input.generate_audio = options.generateAudio ?? true;
        if (options.seed) input.seed = options.seed;
      } else if (model === 'fal-ai/veo3.1' || model === 'fal-ai/veo3.1/lite') {
        // Veo 3.1 standard/lite text-to-video (same API as fast)
        input.duration = '8s';
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        }
        if (options.resolution) input.resolution = options.resolution;
        if (options.generateAudio === true) input.generate_audio = true;
      } else if (
        model === 'fal-ai/veo3.1/image-to-video' ||
        model === 'fal-ai/veo3.1/lite/image-to-video'
      ) {
        // Veo 3.1 standard/lite image-to-video
        if (!options.imageUrl) throw new Error('Image URL is required for Veo 3.1 image-to-video');
        input.image_url = options.imageUrl;
        input.duration = '8s';
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        } else {
          input.aspect_ratio = 'auto';
        }
        if (options.resolution) input.resolution = options.resolution;
        if (options.generateAudio === true) input.generate_audio = true;
      } else if (model === 'fal-ai/sora-2/text-to-video/pro') {
        // Sora 2 Pro text-to-video
        const validDurations = [4, 8, 12];
        input.duration = validDurations.includes(options.duration || 0) ? options.duration : 4;
        if (options.aspectRatio === '9:16' || options.aspectRatio === '16:9') {
          input.aspect_ratio = options.aspectRatio;
        } else {
          input.aspect_ratio = '16:9';
        }
        input.resolution = '720p';
      } else if (model === 'fal-ai/sora-2/image-to-video/pro') {
        // Sora 2 Pro image-to-video
        if (!options.imageUrl)
          throw new Error('Image URL is required for Sora 2 Pro image-to-video');
        input.image_url = options.imageUrl;
        input.duration = options.duration || 4;
        if (options.aspectRatio && options.aspectRatio !== 'auto') {
          input.aspect_ratio = options.aspectRatio;
        } else {
          input.aspect_ratio = 'auto';
        }
        if (options.resolution && options.resolution !== 'auto') {
          input.resolution = options.resolution;
        } else {
          input.resolution = 'auto';
        }
      } else if (model === 'fal-ai/kling-video/v3/pro/image-to-video') {
        // Kling 3.0 Pro image-to-video
        if (!options.imageUrl) throw new Error('Image URL is required for Kling 3.0 Pro');
        input.image_url = options.imageUrl;
        input.duration = String(options.duration || 5);
        input.aspect_ratio = options.aspectRatio || '16:9';
        if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
        if (options.cfgScale !== undefined) input.cfg_scale = options.cfgScale;
      } else if (model === 'fal-ai/pixverse/v6/text-to-video') {
        // PixVerse V6 text-to-video
        input.duration = options.duration || 4;
        if (options.aspectRatio) input.aspect_ratio = options.aspectRatio;
        if (options.resolution) input.resolution = options.resolution;
      } else if (model === 'fal-ai/pixverse/v6/image-to-video') {
        // PixVerse V6 image-to-video
        if (!options.imageUrl) throw new Error('Image URL is required for PixVerse V6 i2v');
        input.image_url = options.imageUrl;
        input.duration = options.duration || 4;
        if (options.aspectRatio) input.aspect_ratio = options.aspectRatio;
        if (options.resolution) input.resolution = options.resolution;
      } else if (model === 'fal-ai/wan/v2.7/text-to-video') {
        // WAN 2.7 text-to-video
        input.duration = String(options.duration || 5);
        input.resolution = options.resolution || '1080p';
        if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
        if (options.enablePromptExpansion !== undefined)
          input.enable_prompt_expansion = options.enablePromptExpansion;
      } else if (model === 'fal-ai/wan/v2.7/image-to-video') {
        // WAN 2.7 image-to-video
        if (!options.imageUrl) throw new Error('Image URL is required for WAN 2.7 i2v');
        input.image_url = options.imageUrl;
        input.duration = String(options.duration || 5);
        input.resolution = options.resolution || '1080p';
        if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
        if (options.enablePromptExpansion !== undefined)
          input.enable_prompt_expansion = options.enablePromptExpansion;
      } else {
        input.duration = options.duration || 5;
        input.fps = options.fps || 25;
        input.width = options.width || 768;
        input.height = options.height || 512;
        input.guidance_scale = options.guidanceScale || 3;
        input.num_inference_steps = options.numInferenceSteps || 30;
        if (options.imageUrl) input.image_url = options.imageUrl;
      }

      let result;
      try {
        result = await fal.subscribe(model, {
          input,
          logs: true,
          onQueueUpdate: (update) => {
            if (update.status === 'IN_PROGRESS' && update.logs) {
              // queue progress
            }
          },
        });
      } catch (subscribeError: any) {
        console.error('❌ Subscribe error:', subscribeError.constructor.name);
        console.error('Status:', subscribeError.status, subscribeError.statusText);

        // Helper to check for binary data
        const hasBinaryData = (str: string): boolean => {
          if (str.length > 500) return true;
          const binaryIndicators = ['iVBOR', 'base64', '/9j/', 'data:image'];
          return binaryIndicators.some((ind) => str.includes(ind));
        };

        // Extract clean message from detail
        let cleanMessage = '';
        if (subscribeError.body?.detail) {
          if (Array.isArray(subscribeError.body.detail)) {
            // Extract messages from validation error array, filtering out binary data
            const messages = subscribeError.body.detail
              .map((err: any) => {
                if (err.msg && typeof err.msg === 'string' && !hasBinaryData(err.msg)) {
                  return err.msg;
                }
                if (err.loc && Array.isArray(err.loc)) {
                  return `Validation error in ${err.loc.join('.')}`;
                }
                return null;
              })
              .filter(Boolean);

            if (messages.length > 0) {
              cleanMessage = messages.join('; ');
            }
          } else if (
            typeof subscribeError.body.detail === 'string' &&
            !hasBinaryData(subscribeError.body.detail)
          ) {
            cleanMessage = subscribeError.body.detail;
          }
        }

        // Build enhanced error
        const enhancedError = new Error();
        if (cleanMessage) {
          enhancedError.message = cleanMessage;
          console.error('Clean error message:', cleanMessage);
        } else if (subscribeError.statusText) {
          enhancedError.message = `${subscribeError.statusText}: Request failed`;
          console.error('Using statusText:', enhancedError.message);
        } else {
          enhancedError.message = subscribeError.message || 'Video generation request failed';
          console.error('Using original message');
        }

        // Preserve other error properties
        Object.assign(enhancedError, {
          status: subscribeError.status,
          statusText: subscribeError.statusText,
          body: subscribeError.body,
        });

        throw enhancedError;
      }

      // Parse response - FAL returns result.data
      const resultAny = result as any;
      const data = resultAny.data || resultAny;

      // Try different possible video URL locations
      let videoUrl: string | undefined;

      if (data.video?.url) {
        videoUrl = data.video.url;
      } else if (data.video_url) {
        videoUrl = data.video_url;
      } else if (data.url) {
        videoUrl = data.url;
      } else if (typeof data.video === 'string') {
        videoUrl = data.video;
      }

      if (!videoUrl) {
        console.error('❌ No video URL in response');
        console.error('Available data:', JSON.stringify(data, null, 2));
        throw new Error(`No video URL found. Response keys: ${Object.keys(data).join(', ')}`);
      }

      return {
        id: resultAny.requestId || Date.now().toString(),
        status: 'completed',
        videoUrl: videoUrl,
      };
    } catch (error: any) {
      console.error('❌ Video generation failed');
      console.error('Error type:', error.constructor.name);

      // Helper function to check if a string contains base64 or binary data
      const containsBinaryData = (str: string): boolean => {
        if (str.length > 500) return true;
        // Check for common base64/binary indicators
        const binaryIndicators = ['iVBOR', 'base64', '/9j/', 'data:image', 'AAAABmJLR0Q'];
        return binaryIndicators.some((indicator) => str.includes(indicator));
      };

      // Helper function to extract clean error message from validation error object
      const extractCleanMessage = (err: any): string => {
        // Try to get the message field
        if (err.msg && typeof err.msg === 'string' && !containsBinaryData(err.msg)) {
          return err.msg;
        }
        if (err.message && typeof err.message === 'string' && !containsBinaryData(err.message)) {
          return err.message;
        }
        // If the error has a loc (location) field, it's a validation error
        if (err.loc && Array.isArray(err.loc)) {
          return `Validation error in ${err.loc.join('.')}`;
        }
        return 'Invalid input data';
      };

      // Extract meaningful error message
      let errorMessage = 'Video generation failed';

      // Check for validation errors in error.body.detail
      if (error.body?.detail) {
        console.error('API returned detail field');

        // FAL API returns validation errors in various formats
        if (Array.isArray(error.body.detail)) {
          // Array of validation errors - extract clean messages only
          const cleanMessages = error.body.detail
            .map((err: any) => extractCleanMessage(err))
            .filter((msg: string) => msg && msg !== 'Invalid input data');

          if (cleanMessages.length > 0) {
            errorMessage = cleanMessages.join('; ');
          } else {
            errorMessage = 'Invalid input data provided to video generation API';
          }
        } else if (typeof error.body.detail === 'string') {
          // String detail - check if it contains binary data
          if (!containsBinaryData(error.body.detail)) {
            errorMessage = error.body.detail;
          } else {
            errorMessage = 'Invalid input data provided to video generation API';
          }
        } else if (typeof error.body.detail === 'object') {
          // Object detail - try to extract useful info
          const msg = extractCleanMessage(error.body.detail);
          if (msg !== 'Invalid input data') {
            errorMessage = msg;
          } else {
            errorMessage = 'Invalid input data provided to video generation API';
          }
        }
      } else if (error.message && typeof error.message === 'string') {
        if (!containsBinaryData(error.message)) {
          errorMessage = error.message;
        }
      }

      // Final check - if error message still contains binary data or is too long, use generic message
      if (containsBinaryData(errorMessage)) {
        console.error('⚠️ Filtered out binary/base64 data from error message');
        errorMessage =
          'Video generation failed due to invalid input data. This may be caused by unlicensed characters, invalid image format, or API limitations. Please verify your inputs and try again.';
      }

      // Check for common error patterns and make them user-friendly
      if (errorMessage.toLowerCase().includes('unprocessable entity')) {
        errorMessage =
          'The video generation request could not be processed. This may be due to unlicensed characters, invalid image format, or API limitations. Please check your inputs and try again.';
      } else if (
        errorMessage.toLowerCase().includes('unlicensed') ||
        errorMessage.toLowerCase().includes('license')
      ) {
        errorMessage =
          'Video generation failed: The request includes unlicensed characters or content. Please ensure all characters are properly licensed.';
      } else if (
        errorMessage.toLowerCase().includes('image') &&
        errorMessage.toLowerCase().includes('url')
      ) {
        errorMessage =
          'Invalid image URL provided. Please check that the image is accessible and in a supported format.';
      }

      // Truncate very long error messages as a final safeguard
      if (errorMessage.length > 300) {
        errorMessage = errorMessage.substring(0, 297) + '...';
      }

      // Log clean error for debugging
      console.error('📤 Returning error to client:', errorMessage);

      return {
        id: '',
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  async generateAudio(options: FalAudioGenerationOptions): Promise<FalAudioGenerationResult> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/stable-audio';
      const input: any = { prompt: options.prompt };

      if (model === 'fal-ai/stable-audio') {
        // Stable Audio: duration in seconds (float), steps for quality
        input.seconds_total = options.durationSec || 30;
        input.steps = options.steps || 100;
      } else if (model === 'fal-ai/musicgen/large' || model === 'fal-ai/musicgen/stereo-large') {
        // MusicGen: duration in seconds
        input.duration = options.durationSec || 15;
      }

      const result = await fal.subscribe(model, {
        input,
        logs: true,
      });

      const resultAny = result as any;
      const data = resultAny.data || resultAny;

      // Extract audio URL from various response shapes
      let audioUrl: string | undefined;
      if (data.audio_file?.url) {
        audioUrl = data.audio_file.url;
      } else if (data.audio?.url) {
        audioUrl = data.audio.url;
      } else if (data.audio_url) {
        audioUrl = data.audio_url;
      } else if (data.url) {
        audioUrl = data.url;
      } else if (typeof data.audio === 'string') {
        audioUrl = data.audio;
      }

      if (!audioUrl) {
        throw new Error(`No audio URL found. Response keys: ${Object.keys(data).join(', ')}`);
      }

      return {
        id: resultAny.requestId || Date.now().toString(),
        status: 'completed',
        audioUrl,
      };
    } catch (error: any) {
      console.error('❌ Audio generation failed:', error.message || error);
      return {
        id: Date.now().toString(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Audio generation failed',
      };
    }
  }

  async getGenerationStatus(id: string): Promise<FalVideoGenerationResult> {
    this.ensureConfigured();
    try {
      const result = await fal.queue.status(id, { requestId: id, logs: true });

      return {
        id,
        status: this.mapStatus((result as any).status),
        videoUrl: (result as any).response_url,
        error: (result as any).status === 'FAILED' ? 'Generation failed' : undefined,
      };
    } catch (error) {
      console.error('Failed to get Fal AI generation status:', error);
      return {
        id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ── Video Editing Operations ──────────────────────────────────────────

  /** Upscale an image using Real-ESRGAN, Clarity, or Creative upscaler */
  async upscaleImage(options: {
    imageUrl: string;
    model?: string;
    prompt?: string;
    scale?: number;
  }): Promise<{ id: string; status: string; imageUrl?: string; error?: string }> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/real-esrgan';
      const input: any = { image_url: options.imageUrl };

      if (model === 'fal-ai/creative-upscaler' && options.prompt) {
        input.prompt = options.prompt;
      }
      if (options.scale) {
        input.scale = options.scale;
      }

      const result = await fal.subscribe(model, { input, logs: true });
      const data = (result as any).data || result;
      const imageUrl = data.image?.url || data.images?.[0]?.url || data.url;

      if (!imageUrl)
        throw new Error(`No image URL in response. Keys: ${Object.keys(data).join(', ')}`);

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        imageUrl,
      };
    } catch (error: any) {
      console.error('Upscale failed:', error.message);
      return { id: '', status: 'failed', error: error.message || 'Upscale failed' };
    }
  }

  /** Interpolate frames for slow-motion effect */
  async interpolateFrames(options: {
    videoUrl: string;
    model?: string;
    multiplier?: number;
  }): Promise<{ id: string; status: string; videoUrl?: string; error?: string }> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/frame-interpolation';
      const input: any = {
        video_url: options.videoUrl,
        multiplier: options.multiplier || 2,
      };

      const result = await fal.subscribe(model, { input, logs: true });
      const data = (result as any).data || result;
      const videoUrl = data.video?.url || data.video_url || data.url;

      if (!videoUrl)
        throw new Error(`No video URL in response. Keys: ${Object.keys(data).join(', ')}`);

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        videoUrl,
      };
    } catch (error: any) {
      console.error('Frame interpolation failed:', error.message);
      return { id: '', status: 'failed', error: error.message || 'Interpolation failed' };
    }
  }

  /** Video-to-video restyle: apply a new prompt while preserving motion */
  async restyleVideo(options: {
    videoUrl: string;
    prompt: string;
    model?: string;
    strength?: number;
    negativePrompt?: string;
  }): Promise<{ id: string; status: string; videoUrl?: string; error?: string }> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/wan/v2.1/video-to-video';
      const input: any = {
        video_url: options.videoUrl,
        prompt: options.prompt,
      };

      if (options.strength !== undefined) input.strength = options.strength;
      if (options.negativePrompt) input.negative_prompt = options.negativePrompt;

      const result = await fal.subscribe(model, { input, logs: true });
      const data = (result as any).data || result;
      const videoUrl = data.video?.url || data.video_url || data.url;

      if (!videoUrl)
        throw new Error(`No video URL in response. Keys: ${Object.keys(data).join(', ')}`);

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        videoUrl,
      };
    } catch (error: any) {
      console.error('Video restyle failed:', error.message);
      return { id: '', status: 'failed', error: error.message || 'Restyle failed' };
    }
  }

  /** Inpaint a region of an image using a mask */
  async inpaintImage(options: {
    imageUrl: string;
    maskUrl: string;
    prompt: string;
    model?: string;
    negativePrompt?: string;
    seed?: number;
    strength?: number;
    guidanceScale?: number;
    numInferenceSteps?: number;
  }): Promise<{
    id: string;
    status: string;
    imageUrl?: string;
    seed?: number;
    error?: string;
  }> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/flux/dev/inpainting';
      const input: any = {
        image_url: options.imageUrl,
        mask_url: options.maskUrl,
        prompt: options.prompt,
      };

      if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
      if (typeof options.seed === 'number') input.seed = options.seed;
      if (typeof options.strength === 'number') input.strength = options.strength;
      if (typeof options.guidanceScale === 'number') input.guidance_scale = options.guidanceScale;
      if (typeof options.numInferenceSteps === 'number')
        input.num_inference_steps = options.numInferenceSteps;

      const result = await fal.subscribe(model, { input, logs: true });
      const data = (result as any).data || result;
      const imageUrl = data.images?.[0]?.url || data.image?.url || data.url;
      const seed = typeof data.seed === 'number' ? data.seed : options.seed;

      if (!imageUrl)
        throw new Error(`No image URL in response. Keys: ${Object.keys(data).join(', ')}`);

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        imageUrl,
        seed,
      };
    } catch (error: any) {
      console.error('Inpaint failed:', error.message);
      return { id: '', status: 'failed', error: error.message || 'Inpaint failed' };
    }
  }

  /** Erase a masked region — prompt-free, fills with plausible surroundings (lama) */
  async eraseRegion(options: { imageUrl: string; maskUrl: string; model?: string }): Promise<{
    id: string;
    status: string;
    imageUrl?: string;
    seed?: number;
    error?: string;
  }> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/lama';
      const input = {
        image_url: options.imageUrl,
        mask_url: options.maskUrl,
      };

      const result = await fal.subscribe(model, { input, logs: true });
      const data = (result as any).data || result;
      const imageUrl = data.image?.url || data.images?.[0]?.url || data.url;

      if (!imageUrl)
        throw new Error(`No image URL in response. Keys: ${Object.keys(data).join(', ')}`);

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        imageUrl,
      };
    } catch (error: any) {
      console.error('Erase failed:', error.message);
      return { id: '', status: 'failed', error: error.message || 'Erase failed' };
    }
  }

  /** Remove background from an image */
  async removeBackground(options: {
    imageUrl: string;
    model?: string;
  }): Promise<{ id: string; status: string; imageUrl?: string; error?: string }> {
    this.ensureConfigured();
    try {
      const model = options.model || 'fal-ai/birefnet';
      const input: any = { image_url: options.imageUrl };

      const result = await fal.subscribe(model, { input, logs: true });
      const data = (result as any).data || result;
      const imageUrl = data.image?.url || data.images?.[0]?.url || data.url;

      if (!imageUrl)
        throw new Error(`No image URL in response. Keys: ${Object.keys(data).join(', ')}`);

      return {
        id: (result as any).requestId || Date.now().toString(),
        status: 'completed',
        imageUrl,
      };
    } catch (error: any) {
      console.error('Background removal failed:', error.message);
      return { id: '', status: 'failed', error: error.message || 'Background removal failed' };
    }
  }

  private mapStatus(falStatus: string): FalVideoGenerationResult['status'] {
    switch (falStatus) {
      case 'COMPLETED':
        return 'completed';
      case 'FAILED':
        return 'failed';
      case 'IN_PROGRESS':
        return 'in_progress';
      case 'IN_QUEUE':
      default:
        return 'pending';
    }
  }
}

export const falService = new FalService();
