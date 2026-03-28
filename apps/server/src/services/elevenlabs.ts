/**
 * ElevenLabs Service — Voice, Sound Effects, Voice Design, Voice Cloning
 *
 * Covers all voice/audio modalities in the LOAR Studio OS.
 *
 * Models:
 *   eleven_flash_v2_5        — fastest, low latency (~$0.000024/char)
 *   eleven_multilingual_v2   — stable long-form, 29 languages (~$0.000030/char)
 *   eleven_turbo_v2          — turbo quality
 *   eleven_v3                — expressive, best emotion/style control (~$0.000040/char)
 *
 * Required env var: ELEVENLABS_API_KEY
 */

const BASE_URL = 'https://api.elevenlabs.io/v1';

export type ElevenLabsVoiceModel =
  | 'eleven_flash_v2_5'
  | 'eleven_multilingual_v2'
  | 'eleven_turbo_v2'
  | 'eleven_v3';

export interface TTSOptions {
  text: string;
  voiceId: string; // ElevenLabs voice ID
  modelId?: ElevenLabsVoiceModel;
  stability?: number; // 0–1, default 0.5
  similarityBoost?: number; // 0–1, default 0.75
  style?: number; // 0–1 (v3+ only), default 0
  useSpeakerBoost?: boolean;
  outputFormat?: 'mp3_44100_128' | 'mp3_44100_64' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000';
}

export interface SoundEffectOptions {
  text: string; // Description of the sound
  durationSeconds?: number; // optional target duration (0.5–22)
  promptInfluence?: number; // 0–1, higher = more faithful to prompt
}

export interface VoiceDesignOptions {
  name: string;
  description: string;
  text: string; // preview text to speak
  gender?: 'male' | 'female' | 'neutral';
  age?: 'young' | 'middle_aged' | 'old';
  accent?: string;
  accentStrength?: number; // 0.3–2.0
}

export interface InstantCloneOptions {
  name: string;
  description?: string;
  audioBuffers: Buffer[]; // 1–25 audio samples, <10MB each
  labels?: Record<string, string>;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels?: Record<string, string>;
  description?: string;
  preview_url?: string;
  available_for_tiers?: string[];
}

export interface TTSResult {
  audioBuffer: Buffer;
  contentType: string;
  characterCount: number;
}

export interface SoundEffectResult {
  audioBuffer: Buffer;
  contentType: string;
}

export interface VoiceDesignResult {
  voiceId: string;
  generatedVoiceId: string;
  audioBuffer: Buffer;
  contentType: string;
}

export interface CloneVoiceResult {
  voiceId: string;
  name: string;
}

class ElevenLabsService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
  }

  private get headers(): Record<string, string> {
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');
    return {
      'xi-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async fetchBuffer(
    path: string,
    body: Record<string, unknown>,
    method = 'POST'
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs API error ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  // ── Text to Speech ────────────────────────────────────────────────────

  async textToSpeech(options: TTSOptions): Promise<TTSResult> {
    const {
      text,
      voiceId,
      modelId = 'eleven_flash_v2_5',
      stability = 0.5,
      similarityBoost = 0.75,
      style = 0,
      useSpeakerBoost = true,
      outputFormat = 'mp3_44100_128',
    } = options;

    const { buffer, contentType } = await this.fetchBuffer(
      `/text-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: useSpeakerBoost,
        },
      }
    );

    return { audioBuffer: buffer, contentType, characterCount: text.length };
  }

  // ── Sound Effects ─────────────────────────────────────────────────────

  async soundEffect(options: SoundEffectOptions): Promise<SoundEffectResult> {
    const { text, durationSeconds, promptInfluence = 0.3 } = options;

    const body: Record<string, unknown> = { text, prompt_influence: promptInfluence };
    if (durationSeconds !== undefined) body.duration_seconds = durationSeconds;

    const { buffer, contentType } = await this.fetchBuffer('/sound-generation', body);
    return { audioBuffer: buffer, contentType };
  }

  // ── Voice Design ──────────────────────────────────────────────────────

  async designVoice(options: VoiceDesignOptions): Promise<VoiceDesignResult> {
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

    // Step 1: generate voice previews
    const genResponse = await fetch(`${BASE_URL}/voice-generation/generate-voice`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        gender: options.gender || 'neutral',
        age: options.age || 'middle_aged',
        accent: options.accent || 'american',
        accent_strength: options.accentStrength ?? 1.0,
        text: options.text,
      }),
    });

    if (!genResponse.ok) {
      const text = await genResponse.text().catch(() => genResponse.statusText);
      throw new Error(`ElevenLabs voice design error ${genResponse.status}: ${text}`);
    }

    const genData = await genResponse.json();
    const generatedVoiceId = genData.generated_voice_id;

    // Step 2: save the designed voice
    const saveResponse = await fetch(`${BASE_URL}/voice-generation/create-voice`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        voice_name: options.name,
        voice_description: options.description,
        generated_voice_id: generatedVoiceId,
        labels: {},
      }),
    });

    if (!saveResponse.ok) {
      const text = await saveResponse.text().catch(() => saveResponse.statusText);
      throw new Error(`ElevenLabs save voice error ${saveResponse.status}: ${text}`);
    }

    const saveData = await saveResponse.json();

    // Return the audio preview buffer from the generation step
    const previewBuffer = Buffer.from(genData.audio || '', 'base64');

    return {
      voiceId: saveData.voice_id,
      generatedVoiceId,
      audioBuffer: previewBuffer,
      contentType: 'audio/mpeg',
    };
  }

  // ── Instant Voice Clone ───────────────────────────────────────────────

  async instantCloneVoice(options: InstantCloneOptions): Promise<CloneVoiceResult> {
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

    const formData = new FormData();
    formData.append('name', options.name);
    if (options.description) formData.append('description', options.description);
    if (options.labels) formData.append('labels', JSON.stringify(options.labels));

    for (let i = 0; i < options.audioBuffers.length; i++) {
      const blob = new Blob([new Uint8Array(options.audioBuffers[i])], { type: 'audio/mpeg' });
      formData.append('files', blob, `sample_${i + 1}.mp3`);
    }

    const response = await fetch(`${BASE_URL}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs clone voice error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return { voiceId: data.voice_id, name: options.name };
  }

  // ── Voice Library ─────────────────────────────────────────────────────

  async listVoices(): Promise<ElevenLabsVoice[]> {
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

    const response = await fetch(`${BASE_URL}/voices`, {
      headers: { 'xi-api-key': this.apiKey },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs list voices error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.voices || [];
  }

  // ── Health check ──────────────────────────────────────────────────────

  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

export const elevenLabsService = new ElevenLabsService();
