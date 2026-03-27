/**
 * Test setup — runs before all test files.
 * Stubs external services so router tests can run without Firebase, FAL, etc.
 */
import { vi } from 'vitest';

// Stub Firebase Admin before anything imports it
vi.mock('../lib/firebase', () => ({
  db: {
    collection: () => ({
      add: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      doc: (id: string) => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => null, id }),
        set: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
      }),
      get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
      where: () => ({
        get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
        orderBy: () => ({
          get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
          limit: () => ({
            get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
          }),
        }),
        limit: () => ({
          get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
        }),
      }),
      orderBy: () => ({
        get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
        limit: () => ({
          get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
        }),
      }),
    }),
  },
  firebaseAvailable: true,
}));

// Stub firebase-storage service
vi.mock('../services/firebase-storage', () => ({
  firebaseStorageService: {
    upload: vi.fn().mockResolvedValue('videos/test.mp4'),
    uploadFromUrl: vi.fn().mockResolvedValue('videos/test.mp4'),
    download: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    getPublicUrl: vi.fn().mockReturnValue('https://storage.googleapis.com/bucket/videos/test.mp4'),
    exists: vi.fn().mockResolvedValue(true),
  },
}));

// Stub FAL service
vi.mock('../services/fal', () => ({
  falService: {
    generateImage: vi
      .fn()
      .mockResolvedValue({
        id: 'test',
        imageUrl: 'https://example.com/img.png',
        status: 'completed',
      }),
    generateVideo: vi
      .fn()
      .mockResolvedValue({
        id: 'test',
        videoUrl: 'https://example.com/vid.mp4',
        status: 'completed',
      }),
    getStatus: vi.fn().mockResolvedValue({ status: 'completed' }),
  },
}));

// Stub Gemini service
vi.mock('../services/gemini', () => ({
  geminiService: {
    generateWikiFromVideo: vi
      .fn()
      .mockResolvedValue({
        wikiData: {},
        metadata: {
          generatedBy: 'test',
          tokensUsed: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        },
      }),
    improveVideoPrompt: vi.fn().mockResolvedValue({ improved: 'test prompt' }),
  },
}));

// Stub Wikia service
vi.mock('../services/wikia', () => ({
  wikiaService: {
    generateWikiaEntry: vi.fn().mockResolvedValue({ title: 'Test', content: 'Test content' }),
    generateStorylineFromPrompt: vi.fn().mockResolvedValue({ storyline: [] }),
  },
}));

// Stub Synapse service
vi.mock('../services/synapse', () => ({
  getSynapseService: vi.fn().mockResolvedValue({
    uploadFromUrl: vi.fn().mockResolvedValue({ pieceCid: 'test-cid' }),
    download: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  }),
}));

// Stub storage manager
vi.mock('../services/storage', () => ({
  getStorageManager: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue({ contentHash: 'abc123', providers: [] }),
    resolve: vi.fn().mockResolvedValue('https://example.com/file'),
  }),
}));
