/**
 * Tests for the `likenessMarketplace` tRPC router.
 *
 * Focused on the validation gates a regression would silently bypass:
 *   - createListing: pricing + permit-flag consistency, splits sum + max count
 *   - recordDeal: use-case scope must be in the consent's allowed set
 *   - on-chain availability probe is honest
 *
 * Uses tRPC's `createCaller` against a Firestore mock that lets us pre-seed
 * the entity / consent / listing state each test relies on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createAuthCaller } from './helpers';

const SELLER = '0x1234567890abcdef1234567890abcdef12345678'; // matches createAuthCaller default

interface DocStore {
  // path -> data; supports `col/docId` keys
  [path: string]: Record<string, unknown>;
}

// Mutable per-test state — populated in beforeEach + tests
const state = vi.hoisted(() => ({
  docs: {} as Record<string, Record<string, unknown>>,
  subcollections: {} as Record<string, Record<string, Record<string, unknown>>>,
}));

// Hoisted firebase mock. Supports:
//   - db.collection(name).doc(id).get()/set()/update()
//   - db.collection(name).doc(id).collection(sub).doc(id2).get()/set()
//   - db.collection(name).add(data)
//   - db.batch() with chained set/update + commit
vi.mock('../lib/firebase', () => {
  function buildDocRef(path: string) {
    return {
      id: path.split('/').slice(-1)[0],
      get: async () => {
        const data = state.docs[path];
        return {
          exists: data !== undefined,
          id: path.split('/').slice(-1)[0],
          data: () => data,
        };
      },
      set: async (data: Record<string, unknown>) => {
        state.docs[path] = data;
      },
      update: async (patch: Record<string, unknown>) => {
        state.docs[path] = { ...(state.docs[path] ?? {}), ...patch };
      },
      delete: async () => {
        delete state.docs[path];
      },
      collection: (sub: string) => buildCollectionRef(`${path}/${sub}`),
    };
  }

  function buildCollectionRef(prefix: string) {
    const q = makeQuery(prefix);
    return {
      ...q,
      doc: (id: string) => buildDocRef(`${prefix}/${id}`),
      add: async (data: Record<string, unknown>) => {
        const id = `mock-${Math.random().toString(36).slice(2, 10)}`;
        state.docs[`${prefix}/${id}`] = data;
        return { id };
      },
    };
  }

  function makeQuery(prefix: string) {
    const filters: Array<{ field: string; value: unknown }> = [];
    const q: any = {};
    q.where = (field: string, _op: string, value: unknown) => {
      filters.push({ field, value });
      return q;
    };
    q.orderBy = () => q;
    q.limit = () => q;
    q.startAfter = () => q;
    q.get = async () => {
      function get(obj: unknown, path: string): unknown {
        return path.split('.').reduce<unknown>((acc, key) => {
          if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
          return undefined;
        }, obj);
      }
      const docs = Object.entries(state.docs)
        .filter(([path]) => {
          const segs = path.split('/');
          return path.startsWith(prefix + '/') && segs.length === prefix.split('/').length + 1;
        })
        .filter(([, data]) => filters.every((f) => get(data, f.field) === f.value))
        .map(([path, data]) => ({
          id: path.split('/').slice(-1)[0],
          data: () => data,
          ref: buildDocRef(path),
        }));
      return { docs, empty: docs.length === 0, size: docs.length };
    };
    return q;
  }

  const db = {
    collection: (name: string) => buildCollectionRef(name),
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      return {
        set: (ref: any, data: Record<string, unknown>) => {
          ops.push(async () => ref.set(data));
        },
        update: (ref: any, patch: Record<string, unknown>) => {
          ops.push(async () => ref.update(patch));
        },
        commit: async () => {
          for (const op of ops) await op();
        },
      };
    },
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      return fn({
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, unknown>) => ref.set(data),
        update: (ref: any, patch: Record<string, unknown>) => ref.update(patch),
      });
    },
  };

  return { db, firebaseAvailable: true };
});

// On-chain availability — pretend the marketplace is NOT on-chain so we
// hit the Firestore-only paths the validation tests care about.
vi.mock('../services/likeness-onchain', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isOnChainAvailable: () => false,
    defaultOnChainChainId: () => null,
    getOnChainEnv: () => null,
  };
});

// Silence the revenue-recorder side effect (it does its own Firestore writes).
vi.mock('../services/revenue-recorder', () => ({
  recordRevenueEvent: vi.fn().mockResolvedValue(undefined),
}));

// Skip on-chain tx verification — we only test the validation gates here.
vi.mock('../services/tx-verify', () => ({
  verifyAndClaimTx: vi.fn().mockResolvedValue({ receipt: {}, tx: {} }),
}));

beforeEach(() => {
  state.docs = {};
  state.subcollections = {};
});

// ── Helpers ──────────────────────────────────────────────────────────────

function stageVoiceEntity(opts?: { creator?: string; entityId?: string }) {
  const id = opts?.entityId ?? 'entity-voice-1';
  state.docs[`entities/${id}`] = {
    id,
    name: 'My Voice',
    description: '',
    kind: 'voice',
    universeAddress: null,
    parentId: null,
    nodeIds: [],
    imageUrl: null,
    metadata: { elevenLabsVoiceId: 'el_voice_xyz' },
    creator: (opts?.creator ?? SELLER).toLowerCase(),
    monetized: false,
    rightsDeclaration: null,
    unstoppableDomain: null,
    referenceBundle: null,
    visualDescriptor: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return id;
}

function stageConsent(entityId: string, overrides?: Record<string, unknown>) {
  const consentId = 'consent-1';
  state.docs[`likenessConsents/${entityId}/revisions/${consentId}`] = {
    id: consentId,
    entityId,
    rightsHolderAddress: SELLER.toLowerCase(),
    rightsHolderUid: 'test-uid',
    modalities: ['full'],
    allowedUseCases: ['narrative_film', 'audiobook'],
    prohibitions: [],
    permitSale: true,
    permitLease: true,
    permitLicense: true,
    realPerson: true,
    verified: false,
    attestationText: 'placeholder',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  state.docs[`likenessConsents/${entityId}`] = {
    latestRevisionId: consentId,
    rightsHolderUid: 'test-uid',
    rightsHolderAddress: SELLER.toLowerCase(),
    updatedAt: new Date(),
  };
  return consentId;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('onChainAvailability', () => {
  it('reports unavailable when no contract addresses are configured', async () => {
    const caller = createAuthCaller();
    const result = await caller.likenessMarketplace.onChainAvailability();
    expect(result.available).toBe(false);
    expect(result.chainId).toBeNull();
    expect(result.chainLabel).toBeNull();
  });
});

describe('createListing', () => {
  it('rejects when consent has not been recorded for the entity', async () => {
    const entityId = stageVoiceEntity();
    const caller = createAuthCaller();
    await expect(
      caller.likenessMarketplace.createListing({
        entityId,
        title: 'My Voice',
        description: '',
        buyPriceWei: '1000000000000000000',
        leasePricePerDayWei: '0',
        licenseFeeWei: '0',
        licenseRoyaltyBps: 0,
        maxDurationDays: 30,
      })
    ).rejects.toThrow(/must record consent before listing/);
  });

  it('rejects when caller is not the entity creator', async () => {
    const entityId = stageVoiceEntity({ creator: '0xdead000000000000000000000000000000000bad' });
    stageConsent(entityId);
    const caller = createAuthCaller();
    await expect(
      caller.likenessMarketplace.createListing({
        entityId,
        title: 'X',
        description: '',
        buyPriceWei: '1000',
        leasePricePerDayWei: '0',
        licenseFeeWei: '0',
        licenseRoyaltyBps: 0,
        maxDurationDays: 30,
      })
    ).rejects.toThrow(/not the rights holder/i);
  });

  it('rejects when consent forbids sale but a buyPrice is set', async () => {
    const entityId = stageVoiceEntity();
    stageConsent(entityId, { permitSale: false });
    const caller = createAuthCaller();
    await expect(
      caller.likenessMarketplace.createListing({
        entityId,
        title: 'X',
        description: '',
        buyPriceWei: '1000',
        leasePricePerDayWei: '0',
        licenseFeeWei: '0',
        licenseRoyaltyBps: 0,
        maxDurationDays: 30,
      })
    ).rejects.toThrow(/does not authorize sale/);
  });

  it('rejects when no deal type has a non-zero price', async () => {
    const entityId = stageVoiceEntity();
    stageConsent(entityId);
    const caller = createAuthCaller();
    await expect(
      caller.likenessMarketplace.createListing({
        entityId,
        title: 'X',
        description: '',
        buyPriceWei: '0',
        leasePricePerDayWei: '0',
        licenseFeeWei: '0',
        licenseRoyaltyBps: 0,
        maxDurationDays: 30,
      })
    ).rejects.toThrow(/at least one of buyPrice/i);
  });

  it('rejects lease price above the 1000 ETH/day on-chain cap', async () => {
    const entityId = stageVoiceEntity();
    stageConsent(entityId);
    const caller = createAuthCaller();
    const tooHigh = (1001n * 10n ** 18n).toString();
    await expect(
      caller.likenessMarketplace.createListing({
        entityId,
        title: 'X',
        description: '',
        buyPriceWei: '0',
        leasePricePerDayWei: tooHigh,
        licenseFeeWei: '0',
        licenseRoyaltyBps: 0,
        maxDurationDays: 30,
      })
    ).rejects.toThrow(/exceeds the on-chain cap/);
  });

  it('rejects splits that do not sum to 10000 bps', async () => {
    const entityId = stageVoiceEntity();
    stageConsent(entityId);
    const caller = createAuthCaller();
    await expect(
      caller.likenessMarketplace.createListing({
        entityId,
        title: 'X',
        description: '',
        buyPriceWei: '1000',
        leasePricePerDayWei: '0',
        licenseFeeWei: '0',
        licenseRoyaltyBps: 0,
        maxDurationDays: 30,
        splitRecipients: [
          { recipient: '0x1111111111111111111111111111111111111111', bps: 5000 },
          { recipient: '0x2222222222222222222222222222222222222222', bps: 3000 }, // 80% total
        ],
      })
    ).rejects.toThrow(/sum to exactly 10000/);
  });

  it('rejects more than 10 split recipients (zod max validator)', async () => {
    const entityId = stageVoiceEntity();
    stageConsent(entityId);
    const caller = createAuthCaller();
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      recipient: `0x${(i + 1).toString().padStart(40, '0')}`,
      bps: 909,
    }));
    await expect(
      caller.likenessMarketplace.createListing({
        entityId,
        title: 'X',
        description: '',
        buyPriceWei: '1000',
        leasePricePerDayWei: '0',
        licenseFeeWei: '0',
        licenseRoyaltyBps: 0,
        maxDurationDays: 30,
        splitRecipients: eleven,
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('persists the listing + splits when the inputs are valid', async () => {
    const entityId = stageVoiceEntity();
    stageConsent(entityId);
    const caller = createAuthCaller();
    const listing = await caller.likenessMarketplace.createListing({
      entityId,
      title: 'My voice',
      description: 'Cinematic narration',
      buyPriceWei: '500000000000000000', // 0.5 ETH
      leasePricePerDayWei: '10000000000000000', // 0.01 ETH/day
      licenseFeeWei: '50000000000000000', // 0.05 ETH
      licenseRoyaltyBps: 500,
      maxDurationDays: 30,
      splitRecipients: [
        { recipient: '0x1111111111111111111111111111111111111111', bps: 7000 },
        { recipient: '0x2222222222222222222222222222222222222222', bps: 3000 },
      ],
    });
    expect(listing.sellerAddress).toBe(SELLER.toLowerCase());
    expect(listing.active).toBe(true);
    expect(listing.splitRecipients).toHaveLength(2);
    expect(listing.splitRecipients?.[0]).toEqual({
      recipient: '0x1111111111111111111111111111111111111111',
      bps: 7000,
    });
    expect(listing.onChainContentHash).toBeNull();
  });
});

describe('recordDeal', () => {
  async function stageListing(opts?: { allowedUseCases?: string[] }): Promise<string> {
    const entityId = stageVoiceEntity({ creator: SELLER });
    stageConsent(entityId, opts?.allowedUseCases ? { allowedUseCases: opts.allowedUseCases } : {});
    const seller = createAuthCaller();
    const listing = await seller.likenessMarketplace.createListing({
      entityId,
      title: 'X',
      description: '',
      buyPriceWei: '1000',
      leasePricePerDayWei: '0',
      licenseFeeWei: '0',
      licenseRoyaltyBps: 0,
      maxDurationDays: 30,
    });
    return listing.id;
  }

  it('blocks self-purchase (seller cannot buy own listing)', async () => {
    const listingId = await stageListing();
    const seller = createAuthCaller(); // same uid + address as the listing seller
    await expect(
      seller.likenessMarketplace.recordDeal({
        listingId,
        dealType: 'BUY',
        pricePaidWei: '1000',
        declaredUseCase: 'narrative_film',
        txHash: '0x' + 'a'.repeat(64),
      })
    ).rejects.toThrow(/cannot buy from your own listing/i);
  });

  it('blocks BUY when the declared use case is not in consent.allowedUseCases', async () => {
    const listingId = await stageListing({ allowedUseCases: ['narrative_film'] });
    const buyer = createAuthCaller({
      uid: 'buyer-uid',
      address: '0xbbb1111111111111111111111111111111111111',
    });
    await expect(
      buyer.likenessMarketplace.recordDeal({
        listingId,
        dealType: 'BUY',
        pricePaidWei: '1000',
        declaredUseCase: 'advertising', // not allowed
        txHash: '0x' + 'b'.repeat(64),
      })
    ).rejects.toThrow(/use case "advertising" is not authorized/);
  });

  it('rejects price below the listed buyPrice', async () => {
    const listingId = await stageListing();
    const buyer = createAuthCaller({
      uid: 'buyer-uid',
      address: '0xbbb1111111111111111111111111111111111111',
    });
    await expect(
      buyer.likenessMarketplace.recordDeal({
        listingId,
        dealType: 'BUY',
        pricePaidWei: '500', // half the asking price
        declaredUseCase: 'narrative_film',
        txHash: '0x' + 'c'.repeat(64),
      })
    ).rejects.toThrow(/below the listing requirement/);
  });

  it('rejects LEASE without durationDays', async () => {
    const entityId = stageVoiceEntity({ creator: SELLER });
    stageConsent(entityId);
    const seller = createAuthCaller();
    const listing = await seller.likenessMarketplace.createListing({
      entityId,
      title: 'X',
      description: '',
      buyPriceWei: '0',
      leasePricePerDayWei: '1000',
      licenseFeeWei: '0',
      licenseRoyaltyBps: 0,
      maxDurationDays: 30,
    });
    const buyer = createAuthCaller({
      uid: 'buyer-uid',
      address: '0xbbb1111111111111111111111111111111111111',
    });
    await expect(
      buyer.likenessMarketplace.recordDeal({
        listingId: listing.id,
        dealType: 'LEASE',
        pricePaidWei: '7000',
        declaredUseCase: 'narrative_film',
        txHash: '0x' + 'd'.repeat(64),
        // intentionally no durationDays
      })
    ).rejects.toThrow(/durationDays required/i);
  });
});

describe('submitConsent', () => {
  it('rejects when no deal type is permitted', async () => {
    const entityId = stageVoiceEntity();
    const caller = createAuthCaller();
    const { LIKENESS_ATTESTATION_TEXT_V1 } = await import('../routers/entities/entities.types');
    await expect(
      caller.likenessMarketplace.submitConsent({
        entityId,
        modalities: ['full'],
        allowedUseCases: ['narrative_film'],
        prohibitions: [],
        permitSale: false,
        permitLease: false,
        permitLicense: false,
        realPerson: true,
        attestationText: LIKENESS_ATTESTATION_TEXT_V1,
      })
    ).rejects.toThrow(/at least one of sale.*lease.*license/i);
  });

  it('rejects when the attestation text drifts from the canonical v1 string', async () => {
    const entityId = stageVoiceEntity();
    const caller = createAuthCaller();
    await expect(
      caller.likenessMarketplace.submitConsent({
        entityId,
        modalities: ['full'],
        allowedUseCases: ['narrative_film'],
        prohibitions: [],
        permitSale: true,
        permitLease: true,
        permitLicense: true,
        realPerson: true,
        attestationText: 'I am the rights holder.', // wrong text → zod literal mismatch
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
