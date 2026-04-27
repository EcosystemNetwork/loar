/**
 * Google Image Generation Service
 *
 * Default model: nano-banana-pro-preview (Gemini-based image generation via generateContent)
 * Fallback model: imagen-4.0-generate-001 (Imagen 4 via predict endpoint)
 *
 * Required env var: GOOGLE_API_KEY
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Models using the predict endpoint (Imagen-style) */
const PREDICT_MODELS = new Set([
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
]);

export type GoogleImageModel =
  | 'nano-banana-pro-preview'
  | 'imagen-4.0-generate-001'
  | 'imagen-4.0-ultra-generate-001'
  | 'imagen-4.0-fast-generate-001';

export type ImagenAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export interface ImagenInputImage {
  /** Base64-encoded image bytes (no data URL prefix) */
  base64: string;
  /** MIME type: image/png or image/jpeg */
  mimeType: string;
}

export interface ImagenGenerateOptions {
  prompt: string;
  negativePrompt?: string;
  numberOfImages?: number; // 1-4
  aspectRatio?: ImagenAspectRatio;
  /** Model to use. Defaults to nano-banana-pro-preview */
  model?: GoogleImageModel;
  /** Safety filter threshold: BLOCK_NONE, BLOCK_ONLY_HIGH, BLOCK_MEDIUM_AND_ABOVE, BLOCK_LOW_AND_ABOVE */
  safetyFilterLevel?: string;
  /** Person generation: DONT_ALLOW, ALLOW_ADULT, ALLOW_ALL */
  personGeneration?: string;
  /**
   * Optional input images for image-to-image / outpainting / reframing on the
   * Gemini endpoint (nano-banana-pro-preview). Ignored by the predict endpoint.
   */
  inputImages?: ImagenInputImage[];
  /**
   * BYOK override — when provided, this user-supplied key is used instead of
   * the platform GOOGLE_API_KEY. Pass `resolveProviderKey(uid, 'google')`.
   */
  apiKey?: string;
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

  private resolveKey(override?: string): string {
    const key = override?.trim() || this.apiKey;
    if (!key) throw new Error('GOOGLE_API_KEY is not configured');
    return key;
  }

  /**
   * Generate images via Google API.
   * Routes to the correct endpoint based on model type:
   *   - nano-banana-pro-preview → generateContent (Gemini-style)
   *   - imagen-* → predict (Imagen-style)
   */
  async generate(options: ImagenGenerateOptions): Promise<ImagenResult> {
    const apiKey = this.resolveKey(options.apiKey);

    const model = options.model || 'nano-banana-pro-preview';

    if (PREDICT_MODELS.has(model)) {
      return this.generateViaPredictEndpoint(model, options, apiKey);
    }
    return this.generateViaGeminiEndpoint(model, options, apiKey);
  }

  /**
   * Gemini-style generateContent endpoint (nano-banana-pro-preview, gemini-*-image).
   * These models accept a text prompt and return inline image data.
   */
  private async generateViaGeminiEndpoint(
    model: string,
    options: ImagenGenerateOptions,
    apiKey: string
  ): Promise<ImagenResult> {
    const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    for (const img of options.inputImages ?? []) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
    parts.push({ text: options.prompt });

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Google API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    const images: ImagenImage[] = [];
    for (const candidate of data.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          images.push({
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          });
        }
      }
    }

    if (images.length === 0) {
      throw new Error(
        'Google API returned no images — prompt may have been blocked by safety filters'
      );
    }

    return { images, imageUrls: [] };
  }

  /**
   * Imagen-style predict endpoint (imagen-4.0-*).
   * Returns base64-encoded images via the predictions array.
   */
  private async generateViaPredictEndpoint(
    model: string,
    options: ImagenGenerateOptions,
    apiKey: string
  ): Promise<ImagenResult> {
    const url = `${API_BASE}/models/${model}:predict?key=${apiKey}`;

    const requestBody = {
      instances: [
        {
          prompt: options.prompt,
          ...(options.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
        },
      ],
      parameters: {
        sampleCount: options.numberOfImages || 1,
        aspectRatio: options.aspectRatio || '1:1',
        safetyFilterLevel: options.safetyFilterLevel || 'BLOCK_ONLY_HIGH',
        personGeneration: options.personGeneration || 'ALLOW_ADULT',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
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
    apiKey?: string;
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
      personGeneration: 'ALLOW_ADULT',
      apiKey: opts.apiKey,
    });
  }
}

export const googleImagenService = new GoogleImagenService();
