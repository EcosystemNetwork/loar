import { afterEach, vi } from 'vitest';

// Set required env before env.ts would otherwise load and call process.exit(1)
process.env.LISTENER_CHAIN = 'sepolia';
process.env.LISTENER_RPC_URL = 'http://localhost:8545';
process.env.LISTENER_FINALITY_DEPTH = '15';
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'loar-test',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
  client_email: 'test@loar-test.iam.gserviceaccount.com',
});
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

// Collect every mock batch so tests can inspect per-chunk operations
const allBatches: any[] = [];

function createMockBatch() {
  const ops = { set: [] as any[], update: [] as any[], delete: [] as any[] };
  const b = {
    set: vi.fn((ref: any, data: any, options?: any) => {
      ops.set.push({ ref, data, options });
      return b;
    }),
    update: vi.fn((ref: any, data: any) => {
      ops.update.push({ ref, data });
      return b;
    }),
    delete: vi.fn((ref: any) => {
      ops.delete.push(ref);
      return b;
    }),
    commit: vi.fn().mockResolvedValue(undefined),
    _ops: ops,
  };
  allBatches.push(b);
  return b;
}

function createMockDoc(id: string) {
  return {
    id,
    get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const mockDoc = vi.fn((id: string) => createMockDoc(id));

const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: mockDoc,
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    startAfter: vi.fn().mockReturnThis(),
  })),
  batch: vi.fn(createMockBatch),
  runTransaction: vi.fn(async (fn: any) =>
    fn({
      get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })
  ),
};

const mockReadContract = vi.fn();

// Stub Firebase before any source module imports it
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn().mockReturnValue({}),
  cert: vi.fn().mockReturnValue({}),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn().mockReturnValue(mockDb),
  FieldValue: {
    serverTimestamp: vi.fn().mockReturnValue({ _mock: 'serverTimestamp' }),
  },
}));

// Replace the event-listener modules that have top-level side effects
vi.mock('../firestore', () => ({
  db: mockDb,
}));

vi.mock('../env', () => ({
  env: {
    LISTENER_CHAIN: 'sepolia',
    LISTENER_RPC_URL: 'http://localhost:8545',
    LISTENER_RPC_FALLBACKS: [] as string[],
    LISTENER_BLOCK_RANGE: 500,
    LISTENER_POLL_INTERVAL_MS: 4000,
    LISTENER_FINALITY_DEPTH: 15,
    PORT: 3400,
    FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,
    FIREBASE_SERVICE_ACCOUNT_PATH: undefined,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  },
}));

vi.mock('../rpc', () => ({
  client: { readContract: mockReadContract },
  chainId: 11155111,
}));

vi.mock('../logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Keep viem helpers like getAddress / parseAbiItem; only intercept client creation
vi.mock('viem', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({ readContract: mockReadContract }),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  allBatches.length = 0;
});

export { mockDb, mockReadContract, allBatches, mockDoc };
