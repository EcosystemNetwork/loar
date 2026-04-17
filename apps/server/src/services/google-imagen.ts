/**
 * Google Imagen Service — 2D Image Generation
 *
 * Uses Google's Imagen 3 model via the Generative AI SDK to generate
 * high-quality 2D character art, concept art, and illustrations.
 *
 * Pricing (approximate):
 *   imagen-3.0-generate-002  ~$0.04/image (standard), ~$0.08/image (high quality)
 *
 * Required env var: GOOGLE_API_KEY
 */

const IMAGEN_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type ImagenAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export interface ImagenGenerateOptions {
  prompt: string;
  negativePrompt?: string;
  numberOfImages?: number; // 1-4
  aspectRatio?: ImagenAspectRatio;
  /** Safety filter threshold: block_none, block_only_high, block_medium_and_above, block_low_and_above */
  safetyFilterLevel?: string;
  /** Person generation: dont_allow, allow_adult, allow_all */
  personGeneration?: string;
}

export interface ImagenImage {
  /** Base64-encoded PNG image data */
  base64: string;
  /** MIME type (always image/png) */
  mimeType: string;
}

export interface ImagenResult {
  images: ImagenImage[];
  /** URLs after uploading to temporary storage */
  imageUrls: string[];
}

// ── Service ─────────────────────────────────────────────────────────────

class GoogleImagenService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Generate images using Google Imagen 3.
   * Returns base64-encoded images that can be uploaded to storage.
   */
  async generate(options: ImagenGenerateOptions): Promise<ImagenResult> {
    if (!this.apiKey) throw new Error('GOOGLE_API_KEY is not configured');

    const model = 'imagen-3.0-generate-002';
    const url = `${IMAGEN_API_BASE}/models/${model}:predict?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      instances: [{ prompt: options.prompt }],
      parameters: {
        sampleCount: options.numberOfImages || 1,
        aspectRatio: options.aspectRatio || '1:1',
        safetyFilterLevel: options.safetyFilterLevel || 'block_only_high',
        personGeneration: options.personGeneration || 'allow_adult',
      },
    };

    if (options.negativePrompt) {
      (body.instances as any[])[0].negativePrompt = options.negativePrompt;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Google Imagen API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
    };

    if (!data.predictions || data.predictions.length === 0) {
      throw new Error(
        'Google Imagen returned no images — prompt may have been blocked by safety filters'
      );
    }

    const images: ImagenImage[] = data.predictions.map((p) => ({
      base64: p.bytesBase64Encoded,
      mimeType: p.mimeType || 'image/png',
    }));

    return { images, imageUrls: [] };
  }

  /**
   * Generate a character portrait optimized for subsequent 3D conversion.
   * Uses a prompt template that produces clean, well-lit character art
   * suitable for Meshy image-to-3D.
   */
  async generateCharacterPortrait(opts: {
    name: string;
    description: string;
    style?: 'realistic' | 'stylized' | 'anime' | 'fantasy' | 'sci-fi';
  }): Promise<ImagenResult> {
    const styleMap: Record<string, string> = {
      realistic: 'photorealistic, cinematic lighting, detailed textures, studio portrait',
      stylized: 'stylized 3D render, clean shapes, vibrant colors, Pixar-quality',
      anime: 'anime art style, cel-shaded, vibrant, detailed character design',
      fantasy: 'fantasy art, magical atmosphere, ethereal lighting, detailed armor and clothing',
      'sci-fi': 'sci-fi concept art, futuristic design, neon accents, detailed technology',
    };

    const style = opts.style || 'realistic';
    const stylePrompt = styleMap[style];

    // Prompt engineered for clean character art that converts well to 3D
    const prompt = [
      `Full-body character portrait of ${opts.name}`,
      opts.description,
      stylePrompt,
      'T-pose or neutral standing pose',
      'clean solid color background',
      'front-facing view',
      'high detail character design',
      'no text, no watermarks, no UI elements',
      'single character only',
      'well-lit, even lighting',
    ].join(', ');

    return this.generate({
      prompt,
      negativePrompt:
        'blurry, low quality, text, watermark, multiple characters, busy background, cropped',
      numberOfImages: 1,
      aspectRatio: '3:4', // portrait orientation for full-body
      personGeneration: 'allow_adult',
    });
  }
}

export const googleImagenService = new GoogleImagenService();
