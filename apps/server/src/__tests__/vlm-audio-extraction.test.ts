import { describe, it, expect, vi, beforeEach } from 'vitest';

const callJson = vi.fn();
const mediaPartFromUrl = vi.fn();

// Only the Gemini boundary is replaced; prompt building, schema validation and
// result assembly in runExtraction run for real.
vi.mock('../services/vlm/gemini-client', () => ({
  callJson: (...a: unknown[]) => callJson(...a),
  mediaPartFromUrl: (...a: unknown[]) => mediaPartFromUrl(...a),
}));

const persisted: Array<Record<string, unknown>> = [];
vi.mock('../lib/firebase', () => ({
  firebaseAvailable: true,
  db: {
    collection: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      doc: () => ({
        get: async () => ({ exists: false }),
        set: async (v: Record<string, unknown>) => {
          persisted.push(v);
        },
      }),
    }),
  },
}));

import { buildExtractionPrompt } from '../services/vlm/prompts';
import { runExtraction } from '../services/vlm/extractor';

describe('buildExtractionPrompt', () => {
  it('keeps the video/image framing by default', () => {
    const p = buildExtractionPrompt({});
    expect(p).toContain('video/image analyst');
    expect(p).toContain('watch the asset');
    expect(p).not.toContain('AUDIO-ONLY');
  });

  it('switches to audio rules for audio assets', () => {
    const p = buildExtractionPrompt({ assetType: 'audio' });
    expect(p).toContain('audio analyst');
    expect(p).toContain('listen to the asset');
    expect(p).toContain('AUDIO-ONLY ASSET');
    expect(p).toContain('Never guess a speaker');
  });
});

describe('runExtraction with audio', () => {
  beforeEach(() => {
    persisted.length = 0;
    callJson.mockReset();
    mediaPartFromUrl.mockReset();
    mediaPartFromUrl.mockResolvedValue({ fileData: { mimeType: 'audio/mpeg', fileUri: 'x' } });
    callJson.mockResolvedValue({
      data: {
        summary: 'Two voices argue about a treaty.',
        scenes: [
          {
            index: 0,
            startSec: 0,
            endSec: 6,
            description: 'A council member objects.',
            subjects: ['Council member'],
            actions: ['objects to the treaty'],
          },
        ],
        entities: [],
        relationships: [],
        timelineEvents: [],
        chapterMarkers: [],
        risks: [],
      },
      cost: { tokensUsed: 10, inputTokens: 8, outputTokens: 2, costUsd: 0.001, model: 'x' },
    });
  });

  it('no longer throws; sends the audio to Gemini with the audio prompt', async () => {
    const { extraction, sceneIndexRows } = await runExtraction({
      input: {
        assetType: 'audio',
        mediaUrl: 'https://cdn.example.com/a.mp3',
        options: { force: true },
      } as any,
      creatorUid: 'u1',
    });

    expect(mediaPartFromUrl).toHaveBeenCalledWith(
      'https://cdn.example.com/a.mp3',
      'audio',
      undefined
    );
    expect(callJson.mock.calls[0][0].prompt).toContain('AUDIO-ONLY ASSET');
    expect(extraction.summary).toBe('Two voices argue about a treaty.');
    expect(sceneIndexRows).toHaveLength(1);
    expect(persisted).toHaveLength(1);
  });
});
