/**
 * VLM subsystem unit tests.
 *
 * Covers the pure-logic pieces of the VLM pipeline: schemas, moderation risk
 * thresholds, multimodal search ranking, editing-graph judge decision, and
 * autoplay budget gate. Firestore is mocked in setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Schemas ───────────────────────────────────────────────────────────

describe('vlm schemas', () => {
  it('extractionOutputSchema accepts a full valid payload', async () => {
    const { extractionOutputSchema } = await import('../services/vlm/schemas');
    const r = extractionOutputSchema.safeParse({
      summary: 'Two people fight in a desert.',
      durationSec: 12,
      scenes: [
        {
          index: 0,
          startSec: 0,
          endSec: 6,
          shotType: 'wide',
          description: 'Two figures walk across dunes.',
          location: 'desert',
          mood: 'tense',
          subjects: ['hero', 'villain'],
          actions: ['walk'],
        },
      ],
      entities: [
        {
          kind: 'person',
          name: 'Hero',
          description: 'Wears a tattered cloak.',
          evidenceSceneIndexes: [0],
        },
      ],
      relationships: [
        {
          sourceName: 'Hero',
          targetName: 'Villain',
          type: 'enemy_of',
          evidenceSceneIndex: 0,
        },
      ],
      timelineEvents: [
        { name: 'Confrontation', description: 'first sighting', atSec: 3, confidence: 0.8 },
      ],
      chapterMarkers: [{ title: 'Act 1', startSec: 0, summary: 'opening' }],
      risks: [{ kind: 'violence', score: 0.4, evidence: 'weapons visible', sceneIndex: 0 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects out-of-range risk scores', async () => {
    const { extractionOutputSchema } = await import('../services/vlm/schemas');
    const r = extractionOutputSchema.safeParse({
      summary: 'x',
      scenes: [],
      entities: [],
      relationships: [],
      timelineEvents: [],
      chapterMarkers: [],
      risks: [{ kind: 'nsfw', score: 2.5, evidence: 'bad' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown relationship types', async () => {
    const { extractionOutputSchema } = await import('../services/vlm/schemas');
    const r = extractionOutputSchema.safeParse({
      summary: 'x',
      scenes: [],
      entities: [],
      relationships: [
        {
          sourceName: 'A',
          targetName: 'B',
          type: 'loves_passionately', // not in ENTITY_RELATION_TYPES
          evidenceSceneIndex: 0,
        },
      ],
      timelineEvents: [],
      chapterMarkers: [],
      risks: [],
    });
    expect(r.success).toBe(false);
  });

  it('canonCheckOutputSchema accepts empty conflicts', async () => {
    const { canonCheckOutputSchema } = await import('../services/vlm/schemas');
    const r = canonCheckOutputSchema.safeParse({ conflicts: [] });
    expect(r.success).toBe(true);
  });

  it('recapOutputSchema rejects invalid social cut platform', async () => {
    const { recapOutputSchema } = await import('../services/vlm/schemas');
    const r = recapOutputSchema.safeParse({
      socialCuts: [{ platform: 'facebook', startSec: 0, endSec: 5, caption: 'nope' }],
    });
    expect(r.success).toBe(false);
  });

  it('copilotScoreOutputSchema clamps scores at 0..1', async () => {
    const { copilotScoreOutputSchema } = await import('../services/vlm/schemas');
    const r = copilotScoreOutputSchema.safeParse({
      matchesIntent: 1.5, // > 1
      identityPreserved: 0.5,
      compositionMatch: 0.5,
      styleMatch: 0.5,
    });
    expect(r.success).toBe(false);
  });
});

// ── Moderation thresholds ────────────────────────────────────────────

describe('vlm moderation risk summary', () => {
  const baseExtraction = {
    id: 'vlmex_test',
    sourceMediaUrl: 'https://x/y',
    creatorUid: '0xabc',
    universeAddress: null,
    model: 'gemini-2.5-pro',
    summary: '',
    scenes: [],
    entities: [],
    relationships: [],
    timelineEvents: [],
    chapterMarkers: [],
    tokensUsed: 0,
    costUsd: 0,
    createdAt: new Date(),
  };

  it('writes autoAction=none for low-risk extractions', async () => {
    const setMock = vi.fn();
    const addMock = vi.fn();
    const getFlagsMock = vi.fn().mockResolvedValue({ empty: true });

    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: (name: string) => {
          if (name === 'vlmRiskScores') return { doc: () => ({ set: setMock }) };
          if (name === 'flags')
            return {
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              get: getFlagsMock,
              add: addMock,
            };
          return { doc: () => ({ set: vi.fn() }), add: vi.fn() };
        },
      },
      firebaseAvailable: true,
    }));

    vi.resetModules();
    const { runModerationScoring } = await import('../services/vlm/moderation');
    const res = await runModerationScoring({
      extraction: {
        ...baseExtraction,
        risks: [{ kind: 'violence' as const, score: 0.1, evidence: 'minor' }],
      } as any,
      contentId: 'content-1',
    });
    expect(res?.overallRisk).toBe('low');
    expect(res?.autoAction).toBe('none');
    expect(addMock).not.toHaveBeenCalled();
    vi.doUnmock('../lib/firebase');
  });

  it('escalates to high + files a VLM flag when any risk crosses 0.75', async () => {
    const setMock = vi.fn();
    const addMock = vi.fn();
    const getFlagsMock = vi.fn().mockResolvedValue({ empty: true });

    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: (name: string) => {
          if (name === 'vlmRiskScores') return { doc: () => ({ set: setMock }) };
          if (name === 'flags')
            return {
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              get: getFlagsMock,
              add: addMock,
            };
          if (name === 'content')
            return {
              doc: () => ({ set: vi.fn() }),
              add: vi.fn(),
            };
          return { doc: () => ({ set: vi.fn() }), add: vi.fn() };
        },
      },
      firebaseAvailable: true,
    }));

    vi.resetModules();
    const { runModerationScoring } = await import('../services/vlm/moderation');
    const res = await runModerationScoring({
      extraction: {
        ...baseExtraction,
        risks: [{ kind: 'copyright_logo' as const, score: 0.82, evidence: 'Disney logo' }],
      } as any,
      contentId: 'content-1',
    });
    expect(res?.overallRisk).toBe('high');
    expect(res?.autoAction).toBe('flag');
    expect(addMock).toHaveBeenCalledOnce();
    const flagRow = addMock.mock.calls[0][0];
    expect(flagRow.source).toBe('vlm');
    expect(flagRow.reason).toBe('copyright');
    vi.doUnmock('../lib/firebase');
  });

  it('dedupes VLM flags for the same contentId', async () => {
    const setMock = vi.fn();
    const addMock = vi.fn();
    const getFlagsMock = vi.fn().mockResolvedValue({ empty: false });

    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: (name: string) => {
          if (name === 'vlmRiskScores') return { doc: () => ({ set: setMock }) };
          if (name === 'flags')
            return {
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              get: getFlagsMock,
              add: addMock,
            };
          return { doc: () => ({ set: vi.fn() }), add: vi.fn() };
        },
      },
      firebaseAvailable: true,
    }));

    vi.resetModules();
    const { runModerationScoring } = await import('../services/vlm/moderation');
    await runModerationScoring({
      extraction: {
        ...baseExtraction,
        risks: [{ kind: 'nsfw' as const, score: 0.9, evidence: 'explicit' }],
      } as any,
      contentId: 'content-1',
    });
    expect(addMock).not.toHaveBeenCalled();
    vi.doUnmock('../lib/firebase');
  });
});

// ── Search ranking ───────────────────────────────────────────────────

describe('vlm search', () => {
  it('prioritises tag hits over caption hits', async () => {
    const docs = [
      {
        id: 'c1_0',
        contentId: 'c1',
        universeAddress: null,
        sceneIndex: 0,
        caption: 'A quiet forest.',
        tags: [],
        objects: [],
        faces: [],
        mood: '',
        startSec: 0,
        endSec: 5,
      },
      {
        id: 'c2_0',
        contentId: 'c2',
        universeAddress: null,
        sceneIndex: 0,
        caption: 'Unrelated shot.',
        tags: ['desert', 'sunset'],
        objects: [],
        faces: [],
        mood: '',
        startSec: 0,
        endSec: 5,
      },
    ];

    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: () => ({
          orderBy: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: docs.map((d) => ({
              id: d.id,
              data: () => d,
            })),
          }),
        }),
      },
      firebaseAvailable: true,
    }));

    vi.resetModules();
    const { searchScenes } = await import('../services/vlm/search');
    const hits = await searchScenes({ query: 'desert sunset', limit: 10 });
    expect(hits[0].contentId).toBe('c2');
    expect(hits[0].matchedBy).toBe('tag');
    // c1 has no matches at all so only c2 returns
    expect(hits.length).toBe(1);
    vi.doUnmock('../lib/firebase');
  });

  it('falls back to caption substring matches', async () => {
    const docs = [
      {
        id: 'c1_0',
        contentId: 'c1',
        universeAddress: null,
        sceneIndex: 0,
        caption: 'A betrayal unfolds at dawn.',
        tags: [],
        objects: [],
        faces: [],
        mood: 'melancholy',
        startSec: 0,
        endSec: 5,
      },
    ];
    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: () => ({
          orderBy: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: docs.map((d) => ({ id: d.id, data: () => d })),
          }),
        }),
      },
      firebaseAvailable: true,
    }));
    vi.resetModules();
    const { searchScenes } = await import('../services/vlm/search');
    const hits = await searchScenes({ query: 'betrayal', limit: 5 });
    expect(hits[0].contentId).toBe('c1');
    vi.doUnmock('../lib/firebase');
  });
});

// ── Editing-graph judge ──────────────────────────────────────────────

describe('vlm editing-graph judge', () => {
  it('returns keep when composite score >= threshold', async () => {
    vi.resetModules();
    vi.doMock('../services/vlm/copilot', () => ({
      scoreOutput: vi.fn().mockResolvedValue({
        score: {
          matchesIntent: 0.9,
          identityPreserved: 0.9,
          compositionMatch: 0.9,
          styleMatch: 0.9,
          issues: [],
          suggestions: [],
          rerollPrompt: '',
        },
        cost: [],
      }),
    }));
    const { executeJudgeNode } = await import('../services/vlm/editing-graph');
    const res = await executeJudgeNode({
      outputUrl: 'https://x',
      outputType: 'image',
      intent: 'moody',
      prompt: 'a moody forest',
      referenceUrls: [],
    });
    expect(res.decision).toBe('keep');
    vi.doUnmock('../services/vlm/copilot');
  });

  it('returns reroll when score is borderline and rerollPrompt is present', async () => {
    vi.resetModules();
    vi.doMock('../services/vlm/copilot', () => ({
      scoreOutput: vi.fn().mockResolvedValue({
        score: {
          matchesIntent: 0.55,
          identityPreserved: 0.55,
          compositionMatch: 0.55,
          styleMatch: 0.55,
          issues: ['drift'],
          suggestions: ['try again'],
          rerollPrompt: 'a better prompt',
        },
        cost: [],
      }),
    }));
    const { executeJudgeNode } = await import('../services/vlm/editing-graph');
    const res = await executeJudgeNode({
      outputUrl: 'https://x',
      outputType: 'image',
      intent: 'moody',
      prompt: 'a moody forest',
      referenceUrls: [],
      keepThreshold: 0.65,
    });
    expect(res.decision).toBe('reroll');
    expect(res.rerollPrompt).toBe('a better prompt');
    vi.doUnmock('../services/vlm/copilot');
  });

  it('returns reject when composite score is well below threshold', async () => {
    vi.resetModules();
    vi.doMock('../services/vlm/copilot', () => ({
      scoreOutput: vi.fn().mockResolvedValue({
        score: {
          matchesIntent: 0.1,
          identityPreserved: 0.1,
          compositionMatch: 0.1,
          styleMatch: 0.1,
          issues: ['nothing matches'],
          suggestions: [],
          rerollPrompt: '',
        },
        cost: [],
      }),
    }));
    const { executeJudgeNode } = await import('../services/vlm/editing-graph');
    const res = await executeJudgeNode({
      outputUrl: 'https://x',
      outputType: 'image',
      intent: 'moody',
      prompt: 'a moody forest',
      referenceUrls: [],
    });
    expect(res.decision).toBe('reject');
    vi.doUnmock('../services/vlm/copilot');
  });
});

// ── Autoplay budget gate ─────────────────────────────────────────────

describe('vlm autoplay gate', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('blocks when feature flag is disabled', async () => {
    process.env.VLM_CONTINUOUS_FILM = 'false';
    vi.resetModules();
    const { canTickAutoplay } = await import('../services/vlm/autoplay');
    const r = await canTickAutoplay('0xuniv');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/disabled/);
  });

  it('blocks when daily run cap reached', async () => {
    process.env.VLM_CONTINUOUS_FILM = 'true';
    process.env.VLM_AUTOPLAY_MAX_PER_DAY = '2';
    process.env.VLM_AUTOPLAY_BUDGET_USD = '100';

    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: () => ({
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ todaysRuns: 2, todaysCostUsd: 1, lastTickAt: null }),
            }),
          }),
        }),
      },
      firebaseAvailable: true,
    }));
    vi.resetModules();
    const { canTickAutoplay } = await import('../services/vlm/autoplay');
    const r = await canTickAutoplay('0xuniv');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/run cap/);
    vi.doUnmock('../lib/firebase');
  });

  it('blocks when daily budget exceeded', async () => {
    process.env.VLM_CONTINUOUS_FILM = 'true';
    process.env.VLM_AUTOPLAY_MAX_PER_DAY = '999';
    process.env.VLM_AUTOPLAY_BUDGET_USD = '5';
    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: () => ({
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ todaysRuns: 1, todaysCostUsd: 10 }),
            }),
          }),
        }),
      },
      firebaseAvailable: true,
    }));
    vi.resetModules();
    const { canTickAutoplay } = await import('../services/vlm/autoplay');
    const r = await canTickAutoplay('0xuniv');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/budget/);
    vi.doUnmock('../lib/firebase');
  });

  it('allows tick inside budget + below cap', async () => {
    process.env.VLM_CONTINUOUS_FILM = 'true';
    process.env.VLM_AUTOPLAY_MAX_PER_DAY = '10';
    process.env.VLM_AUTOPLAY_BUDGET_USD = '100';
    vi.doMock('../lib/firebase', () => ({
      db: {
        collection: () => ({
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: false,
              data: () => null,
            }),
          }),
        }),
      },
      firebaseAvailable: true,
    }));
    vi.resetModules();
    const { canTickAutoplay } = await import('../services/vlm/autoplay');
    const r = await canTickAutoplay('0xuniv');
    expect(r.ok).toBe(true);
    vi.doUnmock('../lib/firebase');
  });
});
