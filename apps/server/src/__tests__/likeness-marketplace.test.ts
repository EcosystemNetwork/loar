/**
 * Tests for the `likenessMarketplace` tRPC router.
 *
 * NO MOCKS: uses the REAL Firestore emulator + the REAL tRPC router. The
 * only signal we control is the env (`getOnChainEnv` returns null because
 * we don't set the address vars in test mode), which forces the Firestore-
 * only validation paths — exactly the gates we want to lock down.
 *
 * Every test case in this file fails BEFORE `verifyAndClaimTx` is called,
 * so no on-chain RPC happens and no real txHashes are needed.
 *
 * Prereq: firebase emulator running.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
// Side-effect import — routes `../lib/firebase` to the real emulator-backed
// client. Must come BEFORE any code that imports firebase so the hoisted
// `vi.mock` factory registers in time.
import './_real-firebase';

const SELLER = '0x1234567890abcdef1234567890abcdef12345678';
const TEST_CLIENT_IP = '127.0.0.1';

let entityId: string;

beforeEach(() => {
  entityId = `entity-mkt-${Math.random().toString(36).slice(2, 10)}`;
});

/**
 * Mount JUST `likenessMarketplaceRouter` (the full appRouter trips a
 * Vitest 4 + tRPC 11 hoisting bug on a procedure name in another router
 * that isn't related to this work).
 */
async function createTestCaller(overrides?: { uid?: string; address?: string }) {
  const { router } = await import('../lib/trpc');
  const { likenessMarketplaceRouter } =
    await import('../routers/likenessMarketplace/likenessMarketplace.routes');
  const appRouter = router({ likenessMarketplace: likenessMarketplaceRouter });
  return appRouter.createCaller({
    user: {
      uid: overrides?.uid ?? 'test-uid',
      address: overrides?.address ?? SELLER,
      email: 'test@example.com',
    },
    clientIp: TEST_CLIENT_IP,
  });
}

async function writeVoiceEntity(opts?: { creator?: string }): Promise<void> {
  const { db } = await import('../lib/firebase');
  await db
    .collection('entities')
    .doc(entityId)
    .set({
      id: entityId,
      name: 'My Voice',
      description: '',
      kind: 'voice',
      universeAddress: null,
      parentId: null,
      nodeIds: [],
      imageUrl: null,
      metadata: { elevenLabsVoiceId: `el_voice_mkt_${entityId}` },
      creator: (opts?.creator ?? SELLER).toLowerCase(),
      monetized: false,
      rightsDeclaration: null,
      unstoppableDomain: null,
      referenceBundle: null,
      visualDescriptor: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

async function writeConsent(overrides?: Record<string, unknown>): Promise<void> {
  const { db } = await import('../lib/firebase');
  const consentId = `consent-mkt-${Math.random().toString(36).slice(2, 10)}`;
  await db
    .collection('likenessConsents')
    .doc(entityId)
    .collection('revisions')
    .doc(consentId)
    .set({
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
    });
  await db.collection('likenessConsents').doc(entityId).set({
    latestRevisionId: consentId,
    rightsHolderUid: 'test-uid',
    rightsHolderAddress: SELLER.toLowerCase(),
    updatedAt: new Date(),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('onChainAvailability (real env probe)', () => {
  it('reports unavailable when no contract addresses are configured in env', async () => {
    // Test env intentionally omits the CONTENT_LICENSING_ADDRESS_* vars
    // so the helper short-circuits to "not available". This is the real
    // env behaviour — no mocking of getOnChainEnv.
    delete process.env.CONTENT_LICENSING_ADDRESS_SEPOLIA;
    delete process.env.CONTENT_LICENSING_ADDRESS_BASE_SEPOLIA;
    const caller = await createTestCaller();
    const result = await caller.likenessMarketplace.onChainAvailability();
    expect(result.available).toBe(false);
    expect(result.chainId).toBeNull();
    expect(result.chainLabel).toBeNull();
  });
});

describe('createListing (real Firestore validation)', () => {
  it('rejects when consent has not been recorded for the entity', async () => {
    await writeVoiceEntity();
    const caller = await createTestCaller();
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
    await writeVoiceEntity({ creator: '0xdead000000000000000000000000000000000bad' });
    await writeConsent();
    const caller = await createTestCaller();
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
    await writeVoiceEntity();
    await writeConsent({ permitSale: false });
    const caller = await createTestCaller();
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
    await writeVoiceEntity();
    await writeConsent();
    const caller = await createTestCaller();
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
    await writeVoiceEntity();
    await writeConsent();
    const caller = await createTestCaller();
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
    await writeVoiceEntity();
    await writeConsent();
    const caller = await createTestCaller();
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
    await writeVoiceEntity();
    await writeConsent();
    const caller = await createTestCaller();
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

  it('persists the listing + splits when inputs are valid (real round-trip)', async () => {
    await writeVoiceEntity();
    await writeConsent();
    const caller = await createTestCaller();
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

    // Confirm the doc is actually in Firestore (not just returned in-memory).
    const { db } = await import('../lib/firebase');
    const snap = await db.collection('likenessListings').doc(listing.id).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.title).toBe('My voice');
    expect(snap.data()?.splitRecipients).toHaveLength(2);
  });
});

describe('recordDeal (real validation gates)', () => {
  async function makeListing(): Promise<string> {
    await writeVoiceEntity({ creator: SELLER });
    await writeConsent();
    const seller = await createTestCaller();
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
    const listingId = await makeListing();
    const seller = await createTestCaller(); // same uid + address as the listing seller
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
    await writeVoiceEntity({ creator: SELLER });
    await writeConsent({ allowedUseCases: ['narrative_film'] }); // not 'advertising'
    const seller = await createTestCaller();
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
    const buyer = await createTestCaller({
      uid: 'buyer-uid',
      address: '0xbbb1111111111111111111111111111111111111',
    });
    await expect(
      buyer.likenessMarketplace.recordDeal({
        listingId: listing.id,
        dealType: 'BUY',
        pricePaidWei: '1000',
        declaredUseCase: 'advertising',
        txHash: '0x' + 'b'.repeat(64),
      })
    ).rejects.toThrow(/use case "advertising" is not authorized/i);
  });

  it('rejects price below the listed buyPrice', async () => {
    const listingId = await makeListing();
    const buyer = await createTestCaller({
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
    await writeVoiceEntity({ creator: SELLER });
    await writeConsent();
    const seller = await createTestCaller();
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
    const buyer = await createTestCaller({
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

describe('submitConsent (real Zod + Firestore writes)', () => {
  it('rejects when no deal type is permitted', async () => {
    await writeVoiceEntity();
    const caller = await createTestCaller();
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
    await writeVoiceEntity();
    const caller = await createTestCaller();
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

  it('writes a consent revision + pointer doc + readable via getMyConsent', async () => {
    await writeVoiceEntity();
    const caller = await createTestCaller();
    const { LIKENESS_ATTESTATION_TEXT_V1 } = await import('../routers/entities/entities.types');
    const consent = await caller.likenessMarketplace.submitConsent({
      entityId,
      modalities: ['full'],
      allowedUseCases: ['narrative_film', 'documentary'],
      prohibitions: [],
      permitSale: false,
      permitLease: true,
      permitLicense: true,
      realPerson: true,
      attestationText: LIKENESS_ATTESTATION_TEXT_V1,
    });
    expect(consent.status).toBe('active');
    expect(consent.permitSale).toBe(false);
    expect(consent.permitLease).toBe(true);

    // Round-trip via getMyConsent (also a real Firestore read).
    const got = await caller.likenessMarketplace.getMyConsent({ entityId });
    expect(got).not.toBeNull();
    expect(got?.id).toBe(consent.id);
    expect(got?.allowedUseCases).toContain('documentary');
  });
});
