/**
 * BYOK-only regression: lip-sync and transcription must never fall back to the
 * platform `FAL_KEY` — with no caller key they refuse before touching FAL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { subscribe, config } = vi.hoisted(() => ({ subscribe: vi.fn(), config: vi.fn() }));
vi.mock('@fal-ai/serverless-client', () => ({ subscribe, config }));

import { lipSyncService } from './lipsync';
import { transcriptionService } from './transcription';

describe('fal-backed services are BYOK-only', () => {
  const original = process.env.FAL_KEY;
  beforeEach(() => {
    process.env.FAL_KEY = 'platform-key-must-not-be-used';
    subscribe.mockReset();
    config.mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = original;
  });

  it('lip-sync rejects without an apiKey even when FAL_KEY is set', async () => {
    await expect(
      lipSyncService.sync({ videoUrl: 'https://x/v.mp4', audioUrl: 'https://x/a.mp3' })
    ).rejects.toThrow(/fal\.ai API key/);
    expect(subscribe).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
  });

  it('transcription rejects without an apiKey even when FAL_KEY is set', async () => {
    await expect(transcriptionService.transcribe({ audioUrl: 'https://x/a.mp3' })).rejects.toThrow(
      /fal\.ai API key/
    );
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('configures the client with the caller key, never the platform key', async () => {
    subscribe.mockResolvedValue({ data: { video: { url: 'https://out/v.mp4' } } });
    const res = await lipSyncService.sync({
      videoUrl: 'https://x/v.mp4',
      audioUrl: 'https://x/a.mp3',
      apiKey: 'user-key',
    });
    expect(res.status).toBe('completed');
    expect(config).toHaveBeenCalledWith({ credentials: 'user-key' });
  });
});

describe('Google-backed services are BYOK-only', () => {
  const original = process.env.GOOGLE_API_KEY;
  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'platform-google-key-must-not-be-used';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = original;
  });

  it('Gemini entity lore/profile/ad-decompose reject without a caller key', async () => {
    const g = await vi.importActual<typeof import('./gemini')>('./gemini');
    await expect(g.generateEntityLore('A', 'character', 'd')).rejects.toThrow(/Google AI API key/);
    await expect(g.generateEntityProfile('A', 'character', 'h')).rejects.toThrow(
      /Google AI API key/
    );
    await expect(g.decomposeAdVideo('https://x/v.mp4')).rejects.toThrow(/Google AI API key/);
  });

  it('caption translation rejects without a caller key', async () => {
    const { translateCaptions } =
      await vi.importActual<typeof import('./caption-translate')>('./caption-translate');
    await expect(
      translateCaptions({ segments: [], sourceLanguage: 'en', targetLanguage: 'es' })
    ).rejects.toThrow(/Google AI API key/);
  });
});
