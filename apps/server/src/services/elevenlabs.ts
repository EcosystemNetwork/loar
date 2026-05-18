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

export type ElevenLabsStsModel = 'eleven_multilingual_sts_v2' | 'eleven_english_sts_v2';

export interface TTSOptions {
  text: string;
  voiceId: string; // ElevenLabs voice ID
  modelId?: ElevenLabsVoiceModel;
  stability?: number; // 0–1, default 0.5
  similarityBoost?: number; // 0–1, default 0.75
  style?: number; // 0–1 (v3+ only), default 0
  useSpeakerBoost?: boolean;
  outputFormat?: 'mp3_44100_128' | 'mp3_44100_64' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000';
  /** BYOK override — user-supplied ElevenLabs key. Falls back to ELEVENLABS_API_KEY env. */
  apiKey?: string;
}

export interface SoundEffectOptions {
  text: string; // Description of the sound
  durationSeconds?: number; // optional target duration (0.5–22)
  promptInfluence?: number; // 0–1, higher = more faithful to prompt
  /** BYOK override — user-supplied ElevenLabs key. */
  apiKey?: string;
}

/** Section of a structured ElevenLabs music composition plan. */
export interface MusicSection {
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles?: string[];
  duration_ms: number; // 3,000 to 120,000
  lines?: Array<{ role?: string; text: string }>;
}

export interface MusicComposeOptions {
  /** Simple-mode prompt. Mutually exclusive with `compositionPlan`. */
  prompt?: string;
  /** Length in ms when using `prompt` mode (3,000 to 600,000). */
  musicLengthMs?: number;
  /** Structured plan. Mutually exclusive with `prompt`. */
  compositionPlan?: {
    positive_global_styles: string[];
    negative_global_styles?: string[];
    sections: MusicSection[];
  };
  forceInstrumental?: boolean;
  seed?: number;
  /** e.g. `mp3_44100_128`, `pcm_44100`, `opus_48000_128`. */
  outputFormat?: string;
  /** BYOK override — user-supplied ElevenLabs key. */
  apiKey?: string;
}

export interface MusicResult {
  audioBuffer: Buffer;
  contentType: string;
}

export interface VoiceDesignOptions {
  name: string;
  description: string;
  text: string; // preview text to speak
  gender?: 'male' | 'female' | 'neutral';
  age?: 'young' | 'middle_aged' | 'old';
  accent?: string;
  accentStrength?: number; // 0.3–2.0
  /** BYOK override — user-supplied ElevenLabs key. */
  apiKey?: string;
}

export interface VoiceChangerOptions {
  audioBuffer: Buffer;
  voiceId: string;
  modelId?: ElevenLabsStsModel;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  removeBackgroundNoise?: boolean;
  outputFormat?: 'mp3_44100_128' | 'mp3_44100_64' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000';
  /** BYOK override — user-supplied ElevenLabs key. */
  apiKey?: string;
}

export interface VoiceChangerResult {
  audioBuffer: Buffer;
  contentType: string;
}

export interface InstantCloneOptions {
  name: string;
  description?: string;
  audioBuffers: Buffer[]; // 1–25 audio samples, <10MB each
  labels?: Record<string, string>;
  /** BYOK override — user-supplied ElevenLabs key. */
  apiKey?: string;
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

export interface DubbingCreateOptions {
  /** Public URL of the source audio/video. ElevenLabs fetches it server-side. */
  sourceUrl?: string;
  /** Inline file upload (mutually exclusive with sourceUrl). */
  file?: { buffer: Buffer; filename: string; contentType: string };
  /** ISO 639-1 source language code. If omitted, ElevenLabs detects. */
  sourceLang?: string;
  /** ISO 639-1 target language code (e.g., "es", "ja"). */
  targetLang: string;
  /** Display name for the dubbing project. */
  name?: string;
  /** Number of distinct speakers in the source (improves diarization). */
  numSpeakers?: number;
  /** Whether to watermark output (free tier may force true). */
  watermark?: boolean;
  /** Start time in seconds (clip a region of the source). */
  startTime?: number;
  /** End time in seconds. */
  endTime?: number;
  /** Render output as video (true) or audio-only (false). */
  highestResolution?: boolean;
  /** BYOK override. */
  apiKey?: string;
}

export interface DubbingCreateResult {
  dubbingId: string;
  expectedDurationSec?: number;
}

export interface DubbingStatus {
  dubbingId: string;
  status: 'dubbing' | 'dubbed' | 'failed';
  targetLanguages?: string[];
  error?: string;
}

export interface ForcedAlignmentWord {
  word: string;
  start: number; // seconds
  end: number; // seconds
}

export interface ForcedAlignmentResult {
  words: ForcedAlignmentWord[];
  characters?: Array<{ char: string; start: number; end: number }>;
  loss?: number;
}

export interface ScribeOptions {
  audioBuffer: Buffer;
  contentType?: string; // e.g., 'audio/mpeg', 'audio/wav'
  modelId?: 'scribe_v1';
  languageCode?: string; // ISO 639-1 hint
  diarize?: boolean;
  numSpeakers?: number;
  tagAudioEvents?: boolean;
  apiKey?: string;
}

export interface ScribeWord {
  text: string;
  start: number;
  end: number;
  type?: 'word' | 'spacing' | 'audio_event';
  speakerId?: string;
}

export interface ScribeResult {
  text: string;
  languageCode?: string;
  languageProbability?: number;
  words: ScribeWord[];
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

  private resolveKey(override?: string): string {
    const key = override?.trim() || this.apiKey;
    if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');
    return key;
  }

  private headersFor(apiKey: string): Record<string, string> {
    return {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async fetchBuffer(
    path: string,
    body: Record<string, unknown>,
    apiKey: string,
    method = 'POST'
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: this.headersFor(apiKey),
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
    const apiKey = this.resolveKey(options.apiKey);

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
      },
      apiKey
    );

    return { audioBuffer: buffer, contentType, characterCount: text.length };
  }

  // ── Speech to Speech (Voice Changer) ──────────────────────────────────

  async voiceChanger(options: VoiceChangerOptions): Promise<VoiceChangerResult> {
    const apiKey = this.resolveKey(options.apiKey);

    const {
      audioBuffer,
      voiceId,
      modelId = 'eleven_multilingual_sts_v2',
      stability = 0.5,
      similarityBoost = 0.75,
      style = 0,
      useSpeakerBoost = true,
      removeBackgroundNoise = false,
      outputFormat = 'mp3_44100_128',
    } = options;

    const formData = new FormData();
    formData.append(
      'audio',
      new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }),
      'input.mp3'
    );
    formData.append('model_id', modelId);
    formData.append('remove_background_noise', String(removeBackgroundNoise));
    formData.append(
      'voice_settings',
      JSON.stringify({
        stability,
        similarity_boost: similarityBoost,
        style,
        use_speaker_boost: useSpeakerBoost,
      })
    );

    const response = await fetch(
      `${BASE_URL}/speech-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData,
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs voice changer error ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const arrayBuffer = await response.arrayBuffer();
    return { audioBuffer: Buffer.from(arrayBuffer), contentType };
  }

  // ── Sound Effects ─────────────────────────────────────────────────────

  async soundEffect(options: SoundEffectOptions): Promise<SoundEffectResult> {
    const { text, durationSeconds, promptInfluence = 0.3 } = options;
    const apiKey = this.resolveKey(options.apiKey);

    const body: Record<string, unknown> = { text, prompt_influence: promptInfluence };
    if (durationSeconds !== undefined) body.duration_seconds = durationSeconds;

    const { buffer, contentType } = await this.fetchBuffer('/sound-generation', body, apiKey);
    return { audioBuffer: buffer, contentType };
  }

  // ── Music (compose) ───────────────────────────────────────────────────

  async composeMusic(options: MusicComposeOptions): Promise<MusicResult> {
    const apiKey = this.resolveKey(options.apiKey);
    const body: Record<string, unknown> = {};
    if (options.prompt) {
      body.prompt = options.prompt;
      if (options.musicLengthMs) body.music_length_ms = options.musicLengthMs;
    } else if (options.compositionPlan) {
      body.composition_plan = options.compositionPlan;
    } else {
      throw new Error('composeMusic requires either prompt or compositionPlan');
    }
    if (options.forceInstrumental != null) body.force_instrumental = options.forceInstrumental;
    if (options.seed != null) body.seed = options.seed;
    if (options.outputFormat) body.output_format = options.outputFormat;

    // ElevenLabs Music — the documented path is `/v1/music` (the older
    // `/v1/music/compose` 404s on current API). Body shape is unchanged.
    const { buffer, contentType } = await this.fetchBuffer('/music', body, apiKey);
    return { audioBuffer: buffer, contentType };
  }

  // ── Voice Design ──────────────────────────────────────────────────────

  async designVoice(options: VoiceDesignOptions): Promise<VoiceDesignResult> {
    const apiKey = this.resolveKey(options.apiKey);

    // Step 1: generate voice previews
    const genResponse = await fetch(`${BASE_URL}/voice-generation/generate-voice`, {
      method: 'POST',
      headers: this.headersFor(apiKey),
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
      headers: this.headersFor(apiKey),
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
    const apiKey = this.resolveKey(options.apiKey);

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
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs clone voice error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return { voiceId: data.voice_id, name: options.name };
  }

  // ── Dubbing (multilingual translation of audio/video) ────────────────

  async dubbing(options: DubbingCreateOptions): Promise<DubbingCreateResult> {
    const apiKey = this.resolveKey(options.apiKey);

    if (!options.sourceUrl && !options.file) {
      throw new Error('dubbing requires either sourceUrl or file');
    }

    const formData = new FormData();
    if (options.sourceUrl) formData.append('source_url', options.sourceUrl);
    if (options.file) {
      formData.append(
        'file',
        new Blob([new Uint8Array(options.file.buffer)], { type: options.file.contentType }),
        options.file.filename
      );
    }
    formData.append('target_lang', options.targetLang);
    if (options.sourceLang) formData.append('source_lang', options.sourceLang);
    if (options.name) formData.append('name', options.name);
    if (options.numSpeakers !== undefined)
      formData.append('num_speakers', String(options.numSpeakers));
    if (options.watermark !== undefined) formData.append('watermark', String(options.watermark));
    if (options.startTime !== undefined) formData.append('start_time', String(options.startTime));
    if (options.endTime !== undefined) formData.append('end_time', String(options.endTime));
    if (options.highestResolution !== undefined)
      formData.append('highest_resolution', String(options.highestResolution));

    const response = await fetch(`${BASE_URL}/dubbing`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs dubbing create error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return {
      dubbingId: data.dubbing_id,
      expectedDurationSec: data.expected_duration_sec,
    };
  }

  async getDubbingStatus(dubbingId: string, apiKey?: string): Promise<DubbingStatus> {
    const key = this.resolveKey(apiKey);
    const response = await fetch(`${BASE_URL}/dubbing/${dubbingId}`, {
      headers: { 'xi-api-key': key },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs dubbing status error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return {
      dubbingId: data.dubbing_id,
      status: data.status,
      targetLanguages: data.target_languages,
      error: data.error,
    };
  }

  async getDubbingAudio(
    dubbingId: string,
    langCode: string,
    apiKey?: string
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const key = this.resolveKey(apiKey);
    const response = await fetch(`${BASE_URL}/dubbing/${dubbingId}/audio/${langCode}`, {
      headers: { 'xi-api-key': key },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs dubbing audio fetch error ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  async getDubbingVideo(
    dubbingId: string,
    langCode: string,
    apiKey?: string
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const key = this.resolveKey(apiKey);
    const response = await fetch(`${BASE_URL}/dubbing/${dubbingId}/video/${langCode}`, {
      headers: { 'xi-api-key': key },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs dubbing video fetch error ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  // ── Forced Alignment (per-word/char timestamps for a known transcript) ─

  async forcedAlignment(
    audioBuffer: Buffer,
    text: string,
    options: { contentType?: string; apiKey?: string } = {}
  ): Promise<ForcedAlignmentResult> {
    const apiKey = this.resolveKey(options.apiKey);
    const contentType = options.contentType || 'audio/mpeg';

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(audioBuffer)], { type: contentType }),
      'audio'
    );
    formData.append('text', text);

    const response = await fetch(`${BASE_URL}/forced-alignment`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs forced alignment error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return {
      words: (data.words || []).map(
        (w: { text?: string; word?: string; start: number; end: number }) => ({
          word: w.text ?? w.word ?? '',
          start: w.start,
          end: w.end,
        })
      ),
      characters: data.characters,
      loss: data.loss,
    };
  }

  // ── Scribe (Speech-to-Text) — v1.1 video-first dub source ─────────────

  async scribe(options: ScribeOptions): Promise<ScribeResult> {
    const apiKey = this.resolveKey(options.apiKey);
    const {
      audioBuffer,
      contentType = 'audio/mpeg',
      modelId = 'scribe_v1',
      languageCode,
      diarize = false,
      numSpeakers,
      tagAudioEvents = false,
    } = options;

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(audioBuffer)], { type: contentType }),
      'audio'
    );
    formData.append('model_id', modelId);
    if (languageCode) formData.append('language_code', languageCode);
    formData.append('diarize', String(diarize));
    if (numSpeakers !== undefined) formData.append('num_speakers', String(numSpeakers));
    formData.append('tag_audio_events', String(tagAudioEvents));

    const response = await fetch(`${BASE_URL}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`ElevenLabs scribe error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      languageCode: data.language_code,
      languageProbability: data.language_probability,
      words: (data.words || []).map(
        (w: {
          text?: string;
          word?: string;
          start: number;
          end: number;
          type?: 'word' | 'spacing' | 'audio_event';
          speaker_id?: string;
        }) => ({
          text: w.text ?? w.word ?? '',
          start: w.start,
          end: w.end,
          type: w.type,
          speakerId: w.speaker_id,
        })
      ),
    };
  }

  // ── Voice Library ─────────────────────────────────────────────────────

  async listVoices(apiKey?: string): Promise<ElevenLabsVoice[]> {
    const key = this.resolveKey(apiKey);

    const response = await fetch(`${BASE_URL}/voices`, {
      headers: { 'xi-api-key': key },
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
