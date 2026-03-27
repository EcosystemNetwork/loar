/**
 * Revenue-critical module integration tests.
 * These routers handle money flows and must be tested thoroughly:
 * marketplace, subscriptions, credits, licensing, analytics, ads.
 */
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createPublicCaller, createAuthCaller } from './helpers';

// ---------------------------------------------------------------------------
// marketplace (canon submissions & voting)
// ---------------------------------------------------------------------------
describe('marketplace router', () => {
  it('getByUniverse is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.marketplace.getByUniverse({
      universeId: 'test-universe',
      status: 'ALL',
    });
    expect(result).toBeDefined();
  });

  it('getCanon is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.marketplace.getCanon({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('submit rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.marketplace.submit({
        universeId: 'u1',
        universeToken: '0x1234567890abcdef1234567890abcdef12345678',
        submissionType: 'CHARACTER',
        title: 'New character',
        description: 'A test character submission for canon voting',
        contentHash: 'hash123',
        metadataURI: 'ipfs://meta',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('vote rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.marketplace.vote({
        submissionId: 'sub1',
        support: true,
        weight: '100',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('mySubmissions rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.marketplace.mySubmissions()).rejects.toThrow(TRPCError);
  });

  it('submit validates input schema', async () => {
    const caller = createAuthCaller();
    await expect(
      caller.marketplace.submit({
        universeId: 'u1',
        universeToken: '0x1234567890abcdef1234567890abcdef12345678',
        submissionType: 'CHARACTER',
        title: '',
        description: 'short',
        contentHash: 'hash',
        metadataURI: 'ipfs://meta',
      })
    ).rejects.toThrow(); // title too short / description too short
  });
});

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------
describe('subscriptions router', () => {
  it('getTiers is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.subscriptions.getTiers({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('hasAccess is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.subscriptions.hasAccess({
      uid: 'user1',
      universeId: 'test-universe',
    });
    expect(result).toHaveProperty('hasAccess');
  });

  it('getUniverseStats is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.subscriptions.getUniverseStats({ universeId: 'test-universe' });
    expect(result).toBeDefined();
  });

  it('subscribe rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.subscriptions.subscribe({
        universeId: 'u1',
        tier: 'BASIC',
        months: 1,
        txHash: '0xabc',
        amount: '10',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('configureTier rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.subscriptions.configureTier({
        universeId: 'u1',
        tier: 'BASIC',
        pricePerMonth: '5',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('mySubscriptions rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.subscriptions.mySubscriptions()).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// credits
// ---------------------------------------------------------------------------
describe('credits router', () => {
  it('getTiers is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.credits.getTiers();
    expect(Array.isArray(result)).toBe(true);
  });

  it('getCosts is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.credits.getCosts();
    expect(result).toBeDefined();
  });

  it('getBalance rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.credits.getBalance()).rejects.toThrow(TRPCError);
  });

  it('purchase rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.credits.purchase({
        tierId: 'starter',
        txHash: '0xabc',
        amount: '10',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('spend rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.credits.spend({
        generationType: 'image',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('grant rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.credits.grant({
        targetUid: 'user2',
        credits: 100,
        reason: 'beta reward',
      })
    ).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// licensing
// ---------------------------------------------------------------------------
describe('licensing router', () => {
  it('getLicenses is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.licensing.getLicenses({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('getMerch is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.licensing.getMerch({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('createLicense rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.licensing.createLicense({
        universeId: 'u1',
        licenseType: 'STREAMING',
        licensee: 'Netflix',
        upfrontFee: '1000',
        royaltyBps: 500,
        durationDays: 365,
        terms: 'Standard license terms',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('purchaseMerch rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.licensing.purchaseMerch({
        merchId: 'merch1',
        txHash: '0xabc',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('myMerch rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.licensing.myMerch()).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// analytics
// ---------------------------------------------------------------------------
describe('analytics router', () => {
  it('recordView is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.analytics.recordView({
      universeId: 'u1',
      episodeId: 'ep1',
    });
    expect(result).toHaveProperty('ok', true);
  });

  it('recordEngagement is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.analytics.recordEngagement({
      universeId: 'u1',
      episodeId: 'ep1',
      type: 'like',
    });
    expect(result).toHaveProperty('ok', true);
  });

  it('getTrending is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.analytics.getTrending({ limit: 5 });
    expect(Array.isArray(result)).toBe(true);
  });

  it('getPlatformStats is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.analytics.getPlatformStats();
    expect(result).toBeDefined();
  });

  it('exportUniverseData rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.analytics.exportUniverseData({ universeId: 'u1' })).rejects.toThrow(
      TRPCError
    );
  });
});

// ---------------------------------------------------------------------------
// ads
// ---------------------------------------------------------------------------
describe('ads router', () => {
  it('getSlotsByUniverse is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.ads.getSlotsByUniverse({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('getSponsorships is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.ads.getSponsorships({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('createSlot rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.ads.createSlot({
        universeId: 'u1',
        placementType: 'BILLBOARD',
        minBid: '100',
        episodes: 5,
        description: 'Prime placement',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('mySponsorships rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.ads.mySponsorships()).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// collabs
// ---------------------------------------------------------------------------
describe('collabs router', () => {
  it('getByUniverse is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.collabs.getByUniverse({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('propose rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.collabs.propose({
        universeA: 'u1',
        universeB: 'u2',
        revenueShareBps: 5000,
        durationDays: 30,
        title: 'Crossover',
        description: 'A crossover event',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('myCollabs rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.collabs.myCollabs()).rejects.toThrow(TRPCError);
  });
});
