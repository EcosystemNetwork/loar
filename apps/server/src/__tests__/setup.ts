/**
 * Test setup — runs before all test files.
 * Stubs external services so router tests can run without Firebase, FAL, etc.
 */
import { vi } from 'vitest';

// Set required env vars before modules load
process.env.ADMIN_ADDRESSES = '0xad0000000000000000000000000000000000dead';
process.env.SIWE_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long-for-tests';

const emptySnapshot = { docs: [], empty: true, size: 0 };

/** Creates a chainable Firestore query mock that supports arbitrary .where().where().orderBy().limit() chains */
function createQueryMock(): any {
  const mock: any = {
    get: vi.fn().mockResolvedValue(emptySnapshot),
  };
  mock.where = vi.fn().mockReturnValue(mock);
  mock.orderBy = vi.fn().mockReturnValue(mock);
  mock.limit = vi.fn().mockReturnValue(mock);
  mock.offset = vi.fn().mockReturnValue(mock);
  mock.startAfter = vi.fn().mockReturnValue(mock);
  return mock;
}

function createCollectionMock() {
  const query = createQueryMock();
  return {
    add: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    doc: (id: string) => ({
      get: vi.fn().mockResolvedValue({ exists: false, data: () => null, id }),
      set: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }),
    get: query.get,
    where: query.where,
    orderBy: query.orderBy,
    limit: query.limit,
    offset: query.offset,
    startAfter: query.startAfter,
  };
}

// Stub Firebase Admin before anything imports it
vi.mock('../lib/firebase', () => ({
  db: {
    collection: () => createCollectionMock(),
    runTransaction: vi.fn().mockImplementation(async (fn: any) => {
      return fn({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        set: vi.fn(),
        update: vi.fn(),
      });
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
    generateImage: vi.fn().mockResolvedValue({
      id: 'test',
      imageUrl: 'https://example.com/img.png',
      status: 'completed',
    }),
    generateVideo: vi.fn().mockResolvedValue({
      id: 'test',
      videoUrl: 'https://example.com/vid.mp4',
      status: 'completed',
    }),
    getStatus: vi.fn().mockResolvedValue({ status: 'completed' }),
    getGenerationStatus: vi.fn().mockResolvedValue({ status: 'completed' }),
    checkConnection: vi.fn().mockResolvedValue({ connected: true }),
  },
}));

// Stub Gemini service
vi.mock('../services/gemini', () => ({
  geminiService: {
    generateWikiFromVideo: vi.fn().mockResolvedValue({
      wikiData: {},
      metadata: { generatedBy: 'test', tokensUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    }),
    improveVideoPrompt: vi.fn().mockResolvedValue({ improved: 'test prompt' }),
    analyzeCharacterImage: vi.fn().mockResolvedValue({ description: 'A character' }),
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
    getManifest: vi.fn().mockResolvedValue(null),
  }),
}));

// Stub safe-admin (universe admin checks)
vi.mock('../lib/safe-admin', () => ({
  isUniverseAdmin: vi.fn().mockResolvedValue(false),
  isUniverseAdminStrict: vi.fn().mockResolvedValue(false),
  isUniverseCollaborator: vi.fn().mockResolvedValue(false),
  getSafeInfo: vi.fn().mockResolvedValue(null),
  getUniverseAdminAddress: vi.fn().mockResolvedValue(null),
  getChainClient: vi.fn(),
}));

// Stub universeTeam getMembership (used by universeTreasury routes)
// Note: the universeTeam router itself still works normally via Firebase mocks.
// This only stubs the named export that treasury routes import directly.
vi.mock('../routers/universeTeam/universeTeam.routes', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getMembership: vi.fn().mockResolvedValue(null),
  };
});

// Stub Stripe
vi.mock('../routers/credits/stripe.routes', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    verifyStripePayment: vi.fn().mockRejectedValue(new Error('Stripe not configured in tests')),
    getStripe: vi.fn().mockReturnValue(null),
  };
});

// Stub viem createPublicClient (prevents real RPC calls in tests)
vi.mock('viem', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const mockClient = {
    getTransaction: vi.fn().mockRejectedValue(new Error('RPC not available in tests')),
    getTransactionReceipt: vi.fn().mockRejectedValue(new Error('RPC not available in tests')),
    readContract: vi.fn().mockRejectedValue(new Error('RPC not available in tests')),
  };
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue(mockClient),
  };
});

// Stub platformConfig
vi.mock('../services/platformConfig', () => ({
  getPlatformConfig: vi.fn().mockResolvedValue({
    fiatMargin: 1.35,
    loarMargin: 1.25,
    loarCreditBonusFraction: 0.1,
    baseCreditCostUsd: 0.008,
    ethPriceUsd: 3000,
  }),
}));

// Stub storage upload queue
const mockUploadQueue = {
  enqueue: vi.fn().mockReturnValue('job-123'),
  getStatus: vi.fn().mockReturnValue({ jobId: 'job-123', status: 'pending' }),
  getActiveJobs: vi.fn().mockReturnValue([]),
  getRecentJobs: vi.fn().mockReturnValue([]),
  retry: vi.fn().mockReturnValue(true),
};
vi.mock('../services/storage/upload-queue', () => ({
  uploadQueue: mockUploadQueue,
  getUploadQueue: vi.fn().mockReturnValue(mockUploadQueue),
}));
