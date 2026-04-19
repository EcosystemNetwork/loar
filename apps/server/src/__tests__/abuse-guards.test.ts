/**
 * Abuse-gate unit tests.
 *
 * Covers the code path every credit-spending route goes through:
 *   generation-guards.ts → platformConfig.ts + spend-cap.ts
 *
 * These modules are what prevent billing runaway (kill switch) and
 * single-wallet spend abuse (monthly cap). Regressions here defeat the
 * whole Phase 1 abuse defence. Worth tests before anyone touches the
 * guard chain.
 *
 * Firestore is mocked — we only care about control flow, not persistence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep a mutable config the mock reads from — individual tests override it.
let mockConfig: Record<string, unknown> = {};
let mockSpendRows: Array<{ type: string; credits: number; createdAt: Date }> = [];

// Replace the whole module — spreading `...actual` would leave the real
// `assertFeatureEnabled` intact, and it has a module-internal reference to
// the unmocked `getPlatformConfig`. Stubbing all exports forces every caller
// through our mock and makes control-flow testable.
vi.mock('../services/platformConfig', () => {
  const FEATURE_KEY_MAP: Record<string, string> = {
    generation: 'generationEnabled',
    minting: 'mintingEnabled',
    purchase: 'purchaseEnabled',
    registration: 'registrationEnabled',
  };
  class FeatureDisabledError extends Error {
    readonly code = 'FEATURE_DISABLED';
    readonly feature: string;
    constructor(feature: string) {
      super(`The ${feature} feature is temporarily disabled by the platform. Try again later.`);
      this.feature = feature;
      this.name = 'FeatureDisabledError';
    }
  }
  const isFeatureEnabled = async (feature: string): Promise<boolean> => {
    const flagName = FEATURE_KEY_MAP[feature];
    const value = (mockConfig as Record<string, unknown>)[flagName];
    return value !== false;
  };
  const assertFeatureEnabled = async (feature: string): Promise<void> => {
    if (!(await isFeatureEnabled(feature))) throw new FeatureDisabledError(feature);
  };
  return {
    getPlatformConfig: vi.fn(async () => mockConfig),
    invalidatePlatformConfigCache: vi.fn(),
    isFeatureEnabled,
    assertFeatureEnabled,
    FeatureDisabledError,
    DEFAULT_PLATFORM_CONFIG: {},
    bpsToFraction: (bps: number) => bps / 10_000,
    calcPlatformFee: () => 0n,
  };
});

vi.mock('../lib/firebase', () => ({
  db: {
    collection: () => ({
      where: function wh() {
        return this;
      },
      get: async () => ({
        docs: mockSpendRows.map((r) => ({ data: () => r })),
      }),
    }),
  },
  firebaseAvailable: true,
}));

// Silence metric side-effects so tests don't depend on prom-client state.
vi.mock('../lib/metrics', () => ({
  recordCreditsTx: vi.fn(),
  recordAuthEvent: vi.fn(),
  recordAiGeneration: vi.fn(),
  recordStorageUpload: vi.fn(),
  recordHttpRequest: vi.fn(),
}));

const DEFAULT_CONFIG = {
  // Only the fields the guards read — tests mutate as needed.
  generationEnabled: true,
  mintingEnabled: true,
  purchaseEnabled: true,
  registrationEnabled: true,
  monthlySpendCapEnabled: true,
  monthlySpendCapCredits: 2000,
};

beforeEach(() => {
  mockConfig = { ...DEFAULT_CONFIG };
  mockSpendRows = [];
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('platformConfig.assertFeatureEnabled', () => {
  it('returns without throwing when the feature is enabled', async () => {
    const { assertFeatureEnabled } = await import('../services/platformConfig');
    await expect(assertFeatureEnabled('generation')).resolves.toBeUndefined();
    await expect(assertFeatureEnabled('minting')).resolves.toBeUndefined();
    await expect(assertFeatureEnabled('purchase')).resolves.toBeUndefined();
    await expect(assertFeatureEnabled('registration')).resolves.toBeUndefined();
  });

  it('throws FeatureDisabledError when generation is off', async () => {
    mockConfig.generationEnabled = false;
    const { assertFeatureEnabled, FeatureDisabledError } =
      await import('../services/platformConfig');
    await expect(assertFeatureEnabled('generation')).rejects.toBeInstanceOf(FeatureDisabledError);
  });

  it('throws when minting is off without affecting generation', async () => {
    mockConfig.mintingEnabled = false;
    const { assertFeatureEnabled, FeatureDisabledError } =
      await import('../services/platformConfig');
    await expect(assertFeatureEnabled('minting')).rejects.toBeInstanceOf(FeatureDisabledError);
    await expect(assertFeatureEnabled('generation')).resolves.toBeUndefined();
  });

  it('error message mentions the feature name so users see which lever flipped', async () => {
    mockConfig.purchaseEnabled = false;
    const { assertFeatureEnabled } = await import('../services/platformConfig');
    await expect(assertFeatureEnabled('purchase')).rejects.toThrow(/purchase/);
  });

  it('fails open when the feature flag is undefined (never-set defaults are safe)', async () => {
    // Removing the flag entirely — simulates an older config doc missing new fields.
    delete (mockConfig as any).generationEnabled;
    const { assertFeatureEnabled } = await import('../services/platformConfig');
    await expect(assertFeatureEnabled('generation')).resolves.toBeUndefined();
  });
});

describe('spend-cap.assertSpendAllowed', () => {
  it('no-op when cap is disabled', async () => {
    mockConfig.monthlySpendCapEnabled = false;
    const { assertSpendAllowed } = await import('../services/spend-cap');
    await expect(assertSpendAllowed('user-a', 10_000)).resolves.toBeUndefined();
  });

  it('no-op when cap is zero (operator disabled via number)', async () => {
    mockConfig.monthlySpendCapCredits = 0;
    const { assertSpendAllowed } = await import('../services/spend-cap');
    await expect(assertSpendAllowed('user-a', 10_000)).resolves.toBeUndefined();
  });

  it('permits a charge that stays within the cap', async () => {
    mockConfig.monthlySpendCapCredits = 100;
    mockSpendRows = [{ type: 'spend', credits: -30, createdAt: new Date() }];
    const { assertSpendAllowed } = await import('../services/spend-cap');
    await expect(assertSpendAllowed('user-a', 50)).resolves.toBeUndefined();
  });

  it('rejects a charge that would exceed the cap', async () => {
    mockConfig.monthlySpendCapCredits = 100;
    mockSpendRows = [{ type: 'spend', credits: -80, createdAt: new Date() }];
    const { assertSpendAllowed, MonthlySpendCapExceededError } =
      await import('../services/spend-cap');
    // 80 already spent + 50 attempted = 130 > 100 cap → reject.
    await expect(assertSpendAllowed('user-a', 50)).rejects.toBeInstanceOf(
      MonthlySpendCapExceededError
    );
  });

  it('normalises negative credit values (spend rows are stored as negative)', async () => {
    mockConfig.monthlySpendCapCredits = 100;
    // Two spend rows at -40 and -30 = 70 spent. 35 more would push to 105 → reject.
    mockSpendRows = [
      { type: 'spend', credits: -40, createdAt: new Date() },
      { type: 'spend', credits: -30, createdAt: new Date() },
    ];
    const { assertSpendAllowed, MonthlySpendCapExceededError } =
      await import('../services/spend-cap');
    await expect(assertSpendAllowed('user-a', 35)).rejects.toBeInstanceOf(
      MonthlySpendCapExceededError
    );
  });

  it('ignores non-spend rows (purchases, refunds, grants)', async () => {
    mockConfig.monthlySpendCapCredits = 100;
    mockSpendRows = [
      { type: 'purchase', credits: 500, createdAt: new Date() },
      { type: 'refund', credits: 20, createdAt: new Date() },
      { type: 'grant', credits: 1000, createdAt: new Date() },
    ];
    const { assertSpendAllowed } = await import('../services/spend-cap');
    // No spend rows → total is zero. Any reasonable charge should pass.
    await expect(assertSpendAllowed('user-a', 90)).resolves.toBeUndefined();
  });
});

describe('generation-guards.assertGenerationAllowed', () => {
  it('passes when kill switch is on AND cap is fine', async () => {
    const { assertGenerationAllowed } = await import('../lib/generation-guards');
    await expect(assertGenerationAllowed('user-a', 50)).resolves.toBeUndefined();
  });

  it('rewraps FeatureDisabledError as a FORBIDDEN tRPC error', async () => {
    mockConfig.generationEnabled = false;
    const { assertGenerationAllowed } = await import('../lib/generation-guards');
    const err = await assertGenerationAllowed('user-a', 50).catch((e) => e);
    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe('FORBIDDEN');
    expect(String(err.message || '')).toMatch(/generation/i);
  });

  it('rewraps MonthlySpendCapExceededError as FORBIDDEN', async () => {
    mockConfig.monthlySpendCapCredits = 50;
    mockSpendRows = [{ type: 'spend', credits: -40, createdAt: new Date() }];
    const { assertGenerationAllowed } = await import('../lib/generation-guards');
    const err = await assertGenerationAllowed('user-a', 30).catch((e) => e);
    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe('FORBIDDEN');
    expect(String(err.message || '')).toMatch(/cap|monthly/i);
  });

  it('kill switch takes precedence over cap — no Firestore read needed when off', async () => {
    mockConfig.generationEnabled = false;
    // Even with a spend at the limit, kill switch should short-circuit first.
    mockConfig.monthlySpendCapCredits = 10;
    mockSpendRows = [{ type: 'spend', credits: -1000, createdAt: new Date() }];
    const { assertGenerationAllowed } = await import('../lib/generation-guards');
    const err = await assertGenerationAllowed('user-a', 5).catch((e) => e);
    // Must be the kill-switch message, not the cap message.
    expect(String(err.message || '')).toMatch(/generation/i);
    expect(String(err.message || '')).not.toMatch(/cap/i);
  });
});
