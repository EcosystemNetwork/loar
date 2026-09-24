/**
 * FAL MiniMax TTS passthrough (tts-models/dispatch.ts + falService.textToSpeech).
 *
 * Boundaries: `fal.subscribe` (third-party network) is stubbed; the generated
 * audio is downloaded from a REAL local HTTP server (safeFetch itself blocks
 * loopback by design, so it delegates to real fetch here). Not verified against
 * the live FAL API (no key available).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

const PORT = vi.hoisted(() => 40000 + Math.floor(Math.random() * 20000));

const subscribe = vi.hoisted(() => vi.fn());
// setup.ts stubs services/fal; this file needs the real service (only fal's network client is stubbed).
vi.unmock('../services/fal');
// fal.ts uses a namespace import (`import * as fal`), so config/subscribe are top-level exports.
vi.mock('@fal-ai/serverless-client', () => ({ config: vi.fn(), subscribe }));

vi.mock('../lib/url-validator', async (orig) => ({
  ...(await orig<typeof import('../lib/url-validator')>()),
  safeFetch: (url: string, init?: RequestInit) => fetch(url, init),
}));

let byokKey: string | undefined = 'fal-key';
vi.mock('../lib/byok', async (orig) => ({
  ...(await orig<typeof import('../lib/byok')>()),
  resolveProviderKey: async () => byokKey,
}));

const AUDIO = Buffer.from('ID3-fake-mp3-bytes-for-test');
let server: Server;
let audioStatus = 200;
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = audioStatus;
    res.setHeader('content-type', 'audio/mpeg');
    res.end(audioStatus === 200 ? AUDIO : 'nope');
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  subscribe.mockReset();
  byokKey = 'fal-key';
  audioStatus = 200;
  subscribe.mockResolvedValue({
    data: { audio: { url: `http://127.0.0.1:${PORT}/a.mp3` }, duration_ms: 1200 },
  });
});

const call = async (over: Record<string, unknown> = {}) => {
  const { dispatchTts } = await import('../services/tts-models');
  return dispatchTts({
    modelId: 'minimax-speech-28-hd-fal',
    text: 'Hello from the test suite.',
    userId: 'u1',
    ...over,
  } as any);
};

describe('dispatchTts — FAL MiniMax passthrough', () => {
  it('is wired: sends the documented FAL input and returns the downloaded mp3', async () => {
    const out = await call({ voiceId: 'Calm_Woman', speed: 1.25 });
    expect(subscribe).toHaveBeenCalledTimes(1);
    const [endpoint, opts] = subscribe.mock.calls[0];
    expect(endpoint).toBe('fal-ai/minimax/speech-2.8-hd');
    expect(opts.input).toEqual({
      prompt: 'Hello from the test suite.',
      output_format: 'url',
      voice_setting: { voice_id: 'Calm_Woman', speed: 1.25 },
    });
    expect(out.audioBuffer.equals(AUDIO)).toBe(true);
    expect(out.contentType).toBe('audio/mpeg');
    expect(out.provider).toBe('fal');
  });

  it("defaults the voice to FAL's Wise_Woman and omits speed when unset", async () => {
    await call();
    expect(subscribe.mock.calls[0][1].input.voice_setting).toEqual({ voice_id: 'Wise_Woman' });
  });

  it("clamps speed into FAL's 0.5–2.0 range", async () => {
    await call({ speed: 4 });
    expect(subscribe.mock.calls[0][1].input.voice_setting.speed).toBe(2);
    await call({ speed: 0.25 });
    expect(subscribe.mock.calls[1][1].input.voice_setting.speed).toBe(0.5);
  });

  it('wav: asks FAL for PCM and wraps it in a real RIFF/WAVE container', async () => {
    const out = await call({ format: 'wav' });
    expect(subscribe.mock.calls[0][1].input.audio_setting).toEqual({
      format: 'pcm',
      sample_rate: '32000',
      channel: '1',
    });
    expect(out.contentType).toBe('audio/wav');
    expect(out.audioBuffer.subarray(0, 4).toString()).toBe('RIFF');
    expect(out.audioBuffer.subarray(8, 12).toString()).toBe('WAVE');
    expect(out.audioBuffer.readUInt32LE(24)).toBe(32000); // sample rate in the header
    expect(out.audioBuffer.length).toBe(44 + AUDIO.length); // header + the PCM bytes
  });

  it('flac and pcm are passed through natively', async () => {
    await call({ format: 'flac' });
    expect(subscribe.mock.calls[0][1].input.audio_setting).toMatchObject({ format: 'flac' });
    const pcm = await call({ format: 'pcm' });
    expect(pcm.contentType).toBe('audio/pcm');
    expect(pcm.audioBuffer.equals(AUDIO)).toBe(true);
  });

  it('a missing BYOK key is a clean BAD_REQUEST and never calls FAL', async () => {
    byokKey = undefined;
    await expect(call()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('a FAL failure is BAD_GATEWAY (so the caller cancels the hold)', async () => {
    subscribe.mockRejectedValue(new Error('upstream 500'));
    await expect(call()).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });

  it('a response with no audio url is BAD_GATEWAY, not a fabricated success', async () => {
    subscribe.mockResolvedValue({ data: { something: 'else' } });
    await expect(call()).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });

  it('a failed audio download is BAD_GATEWAY', async () => {
    audioStatus = 500;
    await expect(call()).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});
