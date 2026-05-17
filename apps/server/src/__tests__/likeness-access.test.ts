/**
 * Tests for `assertVoiceUsageAllowed` — the gate that runs before any
 * `voice.synthesize` / `dubbing.generateLine` call.
 *
 * NO MOCKS: uses the REAL firebase-admin SDK against a local Firestore
 * Emulator (see `_real-firebase.ts`). Documents are staged via real
 * `db.collection().doc().set()` calls, the helper runs against real query
 * semantics (including the dot-path `metadata.elevenLabsVoiceId` filter),
 * and afterEach deletes everything the test wrote.
 *
 * Prereq: firebase emulator running:
 *   firebase emulators:start --only firestore --project loar-db
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
// Side-effect import — routes `../lib/firebase` to the real emulator-backed
// client. Must come BEFORE any code that imports firebase so the hoisted
// `vi.mock` factory registers in time.
import './_real-firebase';

const ELEVEN_VOICE_BASE = 'el_voice_access_test'; // suffixed per-test to avoid collisions
const SELLER = '0x1111111111111111111111111111111111111111';
const BUYER_UID = 'buyer-uid-access-test';
const BUYER_ADDR = '0x2222222222222222222222222222222222222222';

// Each test gets a fresh entity id so concurrent test runs don't fight over
// the same key. Firestore filters by metadata.elevenLabsVoiceId so we also
// scope that per test.
let entityId: string;
let elevenVoiceId: string;

beforeEach(() => {
  const tag = Math.random().toString(36).slice(2, 10);
  entityId = `entity-access-${tag}`;
  elevenVoiceId = `${ELEVEN_VOICE_BASE}_${tag}`;
});

// ── Helpers (real Firestore writes) ──────────────────────────────────────

async function writeVoiceEntity(opts?: { creator?: string }): Promise<void> {
  const { db } = await import('../lib/firebase');
  await db
    .collection('entities')
    .doc(entityId)
    .set({
      id: entityId,
      name: 'Test Voice',
      description: '',
      kind: 'voice',
      universeAddress: null,
      parentId: null,
      nodeIds: [],
      imageUrl: null,
      metadata: { elevenLabsVoiceId: elevenVoiceId },
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

async function writeListing(opts: { active: boolean }): Promise<string> {
  const { db } = await import('../lib/firebase');
  const listingId = `listing-access-${Math.random().toString(36).slice(2, 10)}`;
  await db.collection('likenessListings').doc(listingId).set({
    id: listingId,
    entityId,
    active: opts.active,
    sellerUid: 'test-uid',
    sellerAddress: SELLER.toLowerCase(),
    title: 'X',
    description: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return listingId;
}

async function writeDeal(opts: {
  buyerUid: string;
  dealType: 'BUY' | 'LEASE' | 'LICENSE';
  declaredUseCase?: string;
  endTime?: Date | null;
}): Promise<string> {
  const { db } = await import('../lib/firebase');
  const dealId = `deal-access-${Math.random().toString(36).slice(2, 10)}`;
  await db
    .collection('likenessDeals')
    .doc(dealId)
    .set({
      id: dealId,
      entityId,
      buyerUid: opts.buyerUid,
      status: 'ACTIVE',
      dealType: opts.dealType,
      declaredUseCase: opts.declaredUseCase ?? 'narrative_film',
      endTime: opts.endTime ?? null,
      startTime: new Date(),
    });
  return dealId;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('assertVoiceUsageAllowed (real Firestore)', () => {
  it('allows usage when the voice is not a marketplace entity (no constraint)', async () => {
    // No entity staged — lookup returns null → no constraint.
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).resolves.toBeUndefined();
  });

  it('allows the entity creator to use their own voice unconditionally', async () => {
    await writeVoiceEntity({ creator: SELLER });
    // No listing staged — creator path takes precedence.
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: SELLER,
      })
    ).resolves.toBeUndefined();
  });

  it('blocks a non-creator when the entity is not yet listed (creator-private)', async () => {
    await writeVoiceEntity({ creator: SELLER });
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('blocks when the listing exists but the buyer has no active deal', async () => {
    await writeVoiceEntity({ creator: SELLER });
    await writeListing({ active: true });
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).rejects.toThrow(/purchase, lease, or license/);
  });

  it('allows when the buyer holds an active BUY deal (perpetual)', async () => {
    await writeVoiceEntity({ creator: SELLER });
    await writeListing({ active: true });
    await writeDeal({ buyerUid: BUYER_UID, dealType: 'BUY' });
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).resolves.toBeUndefined();
  });

  it('blocks when the use case is outside the deal scope', async () => {
    await writeVoiceEntity({ creator: SELLER });
    await writeListing({ active: true });
    await writeDeal({
      buyerUid: BUYER_UID,
      dealType: 'LICENSE',
      declaredUseCase: 'narrative_film',
    });
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
        useCase: 'advertising',
      })
    ).rejects.toThrow(/active marketplace deal scoped to "advertising"/);
  });

  it('treats an inactive listing as creator-private (new third-party access blocked)', async () => {
    await writeVoiceEntity({ creator: SELLER });
    await writeListing({ active: false });
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('case-insensitively matches the caller address against the creator', async () => {
    // Write entity with uppercase creator; the helper normalises both sides.
    await writeVoiceEntity({ creator: SELLER.toUpperCase() });
    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: SELLER.toLowerCase(),
      })
    ).resolves.toBeUndefined();
  });

  it('expired LEASE deal is swept to EXPIRED and access denied', async () => {
    // Stage an active-status row whose endTime is in the past — checkAccess
    // (and assertVoiceUsageAllowed via findActiveDeal) should auto-expire it
    // and deny access.
    await writeVoiceEntity({ creator: SELLER });
    await writeListing({ active: true });
    const dealId = await writeDeal({
      buyerUid: BUYER_UID,
      dealType: 'LEASE',
      endTime: new Date(Date.now() - 60_000), // 1 minute ago
    });

    const { assertVoiceUsageAllowed } = await import('../lib/likeness-access');
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: elevenVoiceId,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).rejects.toBeInstanceOf(TRPCError);

    // Verify the helper actually wrote the sweep — status should now be EXPIRED.
    const { db } = await import('../lib/firebase');
    const snap = await db.collection('likenessDeals').doc(dealId).get();
    expect(snap.data()?.status).toBe('EXPIRED');
  });
});
