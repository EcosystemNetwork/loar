/**
 * Tests for `assertVoiceUsageAllowed` — the gate that runs before any
 * `voice.synthesize` / `dubbing.generateLine` call. A bug here either:
 *   - over-blocks (the seller can't use their own voice), OR
 *   - under-blocks (a non-buyer uses a listed voice without paying).
 *
 * We mock Firestore directly (not via setup.ts's default mock) so we can
 * stage entities, listings, and deals per test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

interface MockEntityDoc {
  id: string;
  data: () => { kind: string; creator: string; metadata: Record<string, unknown> };
}
interface MockListingDoc {
  id: string;
  data: () => { entityId: string; active: boolean };
}
interface MockDealDoc {
  id: string;
  data: () => {
    entityId: string;
    buyerUid: string;
    status: 'ACTIVE' | 'EXPIRED';
    dealType: 'BUY' | 'LEASE' | 'LICENSE';
    declaredUseCase?: string;
    endTime?: Date | null;
  };
  ref: { update: ReturnType<typeof vi.fn> };
}

// Mutable state injected by tests, exposed via vi.hoisted so the hoisted
// `vi.mock` factory below can reach it.
const state = vi.hoisted(() => ({
  entities: [] as Array<{
    id: string;
    data: () => { kind: string; creator: string; metadata: Record<string, unknown> };
  }>,
  listings: [] as Array<{ id: string; data: () => { entityId: string; active: boolean } }>,
  deals: [] as Array<{
    id: string;
    data: () => {
      entityId: string;
      buyerUid: string;
      status: 'ACTIVE' | 'EXPIRED';
      dealType: 'BUY' | 'LEASE' | 'LICENSE';
      declaredUseCase?: string;
      endTime?: Date | null;
    };
    ref: { update: ReturnType<typeof vi.fn> };
  }>,
}));

// Hoisted mock — shadows `__tests__/setup.ts`'s `../lib/firebase` mock so we
// can stage per-test Firestore data instead of always reading empty.
vi.mock('../lib/firebase', () => {
  function makeQuery(collection: 'entities' | 'likenessListings' | 'likenessDeals') {
    const filters: Array<{ field: string; value: unknown }> = [];
    const q: any = {};
    q.where = (field: string, _op: string, value: unknown) => {
      filters.push({ field, value });
      return q;
    };
    q.orderBy = () => q;
    q.limit = () => q;
    q.get = async () => {
      // Mirror Firestore semantics: `field` may be a dot path like
      // 'metadata.elevenLabsVoiceId'. We walk the path against the doc data
      // so the mock matches the same set of records the real Firestore would.
      function get(obj: unknown, path: string): unknown {
        return path.split('.').reduce<unknown>((acc, key) => {
          if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
          return undefined;
        }, obj);
      }
      const apply = <T>(arr: T[], view: (x: T) => Record<string, unknown>): T[] =>
        arr.filter((doc) => filters.every((f) => get(view(doc), f.field) === f.value));
      let docs: any[] = [];
      if (collection === 'entities') {
        docs = apply(state.entities, (d) => d.data());
      } else if (collection === 'likenessListings') {
        docs = apply(state.listings, (d) => d.data());
      } else {
        docs = apply(state.deals, (d) => d.data());
      }
      return { docs, empty: docs.length === 0, size: docs.length };
    };
    return q;
  }

  return {
    db: {
      collection: (name: string) => {
        const q = makeQuery(name as 'entities' | 'likenessListings' | 'likenessDeals');
        return {
          ...q,
          doc: (id: string) => ({
            update: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue({ exists: false }),
            id,
          }),
        };
      },
    },
    firebaseAvailable: true,
  };
});

const ELEVEN_VOICE = 'el_voice_abc';
const CREATOR = '0x1111111111111111111111111111111111111111';
const BUYER_UID = 'buyer-uid-1';
const BUYER_ADDR = '0x2222222222222222222222222222222222222222';

beforeEach(() => {
  state.entities = [];
  state.listings = [];
  state.deals = [];
});

async function importAccess() {
  return import('../lib/likeness-access');
}

describe('assertVoiceUsageAllowed', () => {
  it('allows usage when the voice is not a marketplace entity (no constraint)', async () => {
    // No entities staged — the helper should return without throwing.
    const { assertVoiceUsageAllowed } = await importAccess();
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).resolves.toBeUndefined();
  });

  it('allows the entity creator to use their own voice unconditionally', async () => {
    state.entities = [
      {
        id: 'entity-1',
        data: () => ({
          kind: 'voice',
          creator: CREATOR,
          metadata: { elevenLabsVoiceId: ELEVEN_VOICE },
        }),
      },
    ];
    // No listing required — creator owns the entity.
    const { assertVoiceUsageAllowed } = await importAccess();
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: CREATOR,
      })
    ).resolves.toBeUndefined();
  });

  it('blocks a non-creator when the entity is not yet listed (creator-private)', async () => {
    state.entities = [
      {
        id: 'entity-1',
        data: () => ({
          kind: 'voice',
          creator: CREATOR,
          metadata: { elevenLabsVoiceId: ELEVEN_VOICE },
        }),
      },
    ];
    // listings + deals deliberately empty
    const { assertVoiceUsageAllowed } = await importAccess();
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('blocks when the listing exists but the buyer has no active deal', async () => {
    state.entities = [
      {
        id: 'entity-1',
        data: () => ({
          kind: 'voice',
          creator: CREATOR,
          metadata: { elevenLabsVoiceId: ELEVEN_VOICE },
        }),
      },
    ];
    state.listings = [
      {
        id: 'list-1',
        data: () => ({ entityId: 'entity-1', active: true }),
      },
    ];
    const { assertVoiceUsageAllowed } = await importAccess();
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).rejects.toThrow(/purchase, lease, or license/);
  });

  it('allows when the buyer holds an active BUY deal (perpetual)', async () => {
    state.entities = [
      {
        id: 'entity-1',
        data: () => ({
          kind: 'voice',
          creator: CREATOR,
          metadata: { elevenLabsVoiceId: ELEVEN_VOICE },
        }),
      },
    ];
    state.listings = [
      {
        id: 'list-1',
        data: () => ({ entityId: 'entity-1', active: true }),
      },
    ];
    state.deals = [
      {
        id: 'deal-1',
        ref: { update: vi.fn() },
        data: () => ({
          entityId: 'entity-1',
          buyerUid: BUYER_UID,
          status: 'ACTIVE',
          dealType: 'BUY',
          declaredUseCase: 'narrative_film',
          endTime: null,
        }),
      },
    ];
    const { assertVoiceUsageAllowed } = await importAccess();
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).resolves.toBeUndefined();
  });

  it('blocks when the use case is outside the deal scope', async () => {
    state.entities = [
      {
        id: 'entity-1',
        data: () => ({
          kind: 'voice',
          creator: CREATOR,
          metadata: { elevenLabsVoiceId: ELEVEN_VOICE },
        }),
      },
    ];
    state.listings = [
      {
        id: 'list-1',
        data: () => ({ entityId: 'entity-1', active: true }),
      },
    ];
    state.deals = [
      {
        id: 'deal-1',
        ref: { update: vi.fn() },
        data: () => ({
          entityId: 'entity-1',
          buyerUid: BUYER_UID,
          status: 'ACTIVE',
          dealType: 'LICENSE',
          declaredUseCase: 'narrative_film',
          endTime: null,
        }),
      },
    ];
    const { assertVoiceUsageAllowed } = await importAccess();
    // Caller declares 'advertising' but the deal was for 'narrative_film'
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
        useCase: 'advertising',
      })
    ).rejects.toThrow(/active marketplace deal scoped to "advertising"/);
  });

  it('treats an inactive listing as creator-private (new third-party access blocked)', async () => {
    // Listing was once active but now deactivated. Existing deals stay valid
    // by virtue of the deals query, but a buyer WITHOUT a deal can't use the
    // voice just because it was listed at some point.
    state.entities = [
      {
        id: 'entity-1',
        data: () => ({
          kind: 'voice',
          creator: CREATOR,
          metadata: { elevenLabsVoiceId: ELEVEN_VOICE },
        }),
      },
    ];
    state.listings = [
      {
        id: 'list-1',
        data: () => ({ entityId: 'entity-1', active: false }),
      },
    ];
    const { assertVoiceUsageAllowed } = await importAccess();
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: BUYER_ADDR,
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('case-insensitively matches the caller address against the creator', async () => {
    state.entities = [
      {
        id: 'entity-1',
        data: () => ({
          kind: 'voice',
          creator: CREATOR.toUpperCase(), // entity stored uppercase
          metadata: { elevenLabsVoiceId: ELEVEN_VOICE },
        }),
      },
    ];
    const { assertVoiceUsageAllowed } = await importAccess();
    // Caller passes lowercase — should still match
    await expect(
      assertVoiceUsageAllowed({
        elevenLabsVoiceId: ELEVEN_VOICE,
        callerUid: BUYER_UID,
        callerAddress: CREATOR.toLowerCase(),
      })
    ).resolves.toBeUndefined();
  });
});
