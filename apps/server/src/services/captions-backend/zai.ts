/**
 * Z.AI / Zhipu GLM-ASR transcription backend.
 *
 * Endpoint: `POST https://api.z.ai/api/paas/v4/audio/transcriptions`
 * (OpenAI-compatible multipart, Bearer auth). Supports Chinese dialects
 * (Sichuanese, Cantonese, Min Nan, Wu) + English.
 *
 * GLM-ASR does NOT expose per-word timestamps or speaker diarization in
 * its current form — we return segment-only captions and degrade the
 * capability flags accordingly.
 */
import type { CaptionSegment } from '../../lib/captions-format';
import type { CaptionBackend, CaptionBackendInput, CaptionBackendResult } from './types';
import { validateUploadUrl } from '../../lib/url-validator';
import { redactSecrets } from '../../lib/redact-secrets';

const ZAI_ENDPOINT = 'https://api.z.ai/api/paas/v4/audio/transcriptions';

interface ZaiSegment {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
}

interface ZaiResponse {
  text?: string;
  language?: string;
  segments?: ZaiSegment[];
  error?: { message?: string };
}

export const zaiGlmAsrBackend: CaptionBackend = {
  modelId: 'glm-asr-2512-zai',
  provider: 'zai',
  async transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult> {
    let audioBuf: ArrayBuffer;
    let mimeType: string;
    try {
      await validateUploadUrl(input.audioUrl);
      const audioRes = await fetch(input.audioUrl, { signal: AbortSignal.timeout(120_000) });
      if (!audioRes.ok) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Audio fetch failed (${audioRes.status})`,
        };
      }
      mimeType = audioRes.headers.get('content-type') ?? 'audio/mpeg';
      audioBuf = await audioRes.arrayBuffer();
    } catch (err) {
      return {
        status: 'failed',
        hasWordTimings: false,
        hasSpeakers: false,
        error: `Audio fetch failed: ${err instanceof Error ? err.message : 'network error'}`,
      };
    }

    const form = new FormData();
    form.append('file', new Blob([audioBuf], { type: mimeType }), 'audio');
    form.append('model', 'glm-asr-2512');
    form.append('response_format', 'verbose_json');
    if (input.language) form.append('language', input.language);

    let res: Response;
    try {
      res = await fetch(ZAI_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      return {
        status: 'failed',
        hasWordTimings: false,
        hasSpeakers: false,
        error: `Z.AI request failed: ${err instanceof Error ? err.message : 'network error'}`,
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        status: 'failed',
        hasWordTimings: false,
        hasSpeakers: false,
        error: `Z.AI rejected (${res.status}): ${redactSecrets(text).slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as ZaiResponse;
    if (json.error) {
      return {
        status: 'failed',
        hasWordTimings: false,
        hasSpeakers: false,
        error: `Z.AI error: ${json.error.message ?? 'unknown'}`,
      };
    }

    const segments: CaptionSegment[] = (json.segments ?? []).map((s) => ({
      start: s.start ?? 0,
      end: s.end ?? 0,
      text: (s.text ?? '').trim(),
      speaker: null,
    }));

    return {
      status: 'completed',
      text: json.text,
      segments,
      language: json.language,
      hasWordTimings: false,
      hasSpeakers: false,
    };
  },
};
