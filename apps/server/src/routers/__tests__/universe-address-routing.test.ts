/**
 * Integration tests: physics / entities / curation / notebook routers must
 * accept a Solana universeAddress end-to-end (input parsing → handler →
 * Firestore call), and must never silently mangle its case.
 *
 * Regression coverage for two bugs fixed in the same incident:
 *
 *  1. Input validation (82897e88, following physics's 7313fae7): all four
 *     routers validated `universeAddress` against the EVM-only
 *     `/^0x[a-fA-F0-9]{40}$/` regex, so every query/mutation 400'd for a
 *     Solana universe before the handler ever ran.
 *
 *  2. Case handling: entities/curation/notebook handlers unconditionally
 *     `.toLowerCase()`d `universeAddress` before every Firestore read/write.
 *     Solana base58 addresses are case-sensitive (see lib/universe-id.ts) —
 *     that silently mangled the stored/queried value so it could never
 *     match the real on-chain PDA again, even after fix (1) let the
 *     request through. Fixed by routing every handler through
 *     `normalizeUniverseId()` instead.
 *
 * Uses the global empty-Firestore mock's shape (setup.ts) but replaces it
 * with a spy-able version local to this file so call args can be inspected,
 * per the `_real-firebase.ts` pattern of opting a test file out of the
 * shared fixture via its own top-level `vi.mock`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

// The exact PDA from the reported incident (loar.fun/universe/H9E6T6...).
const SOLANA_PDA = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
const MIXED_CASE_EVM = '0x89669812f850f34F907ee9e9009f501d1B008420';
const LOWER_EVM = MIXED_CASE_EVM.toLowerCase();
const CREATOR = '0x1111111111111111111111111111111111111111';

// ── Spy-able Firestore facsimile ─────────────────────────────────────────

interface WhereCall {
  collection: string;
  field: string;
  op: string;
  value: unknown;
}
interface WriteCall {
  collection: string;
  docId: string;
  data: Record<string, unknown>;
}

const { db, whereCalls, setCalls, docStore } = vi.hoisted(() => {
  const whereCalls: WhereCall[] = [];
  const setCalls: WriteCall[] = [];
  const docStore = new Map<string, Record<string, unknown>>();
  let autoIdCounter = 0;

  function makeQuery(collectionName: string): any {
    const query: any = {
      where: vi.fn((field: string, op: string, value: unknown) => {
        whereCalls.push({ collection: collectionName, field, op, value });
        return query;
      }),
      select: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      offset: vi.fn(() => query),
      startAfter: vi.fn(() => query),
      get: vi.fn(async () => ({ docs: [], empty: true, size: 0 })),
    };
    return query;
  }

  function makeDoc(collectionName: string, docId: string) {
    const key = `${collectionName}/${docId}`;
    return {
      id: docId,
      get: vi.fn(async () => {
        const data = docStore.get(key);
        return { exists: data !== undefined, data: () => data, id: docId };
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        docStore.set(key, data);
        setCalls.push({ collection: collectionName, docId, data });
      }),
      update: vi.fn(async (data: Record<string, unknown>) => {
        const prev = docStore.get(key) ?? {};
        docStore.set(key, { ...prev, ...data });
      }),
      delete: vi.fn(async () => {
        docStore.delete(key);
      }),
    };
  }

  const db = {
    collection: vi.fn((name: string) => {
      const query = makeQuery(name);
      return {
        ...query,
        add: vi.fn(async () => ({ id: `auto-${++autoIdCounter}` })),
        doc: vi.fn((id?: string) => makeDoc(name, id ?? `auto-${++autoIdCounter}`)),
      };
    }),
    runTransaction: vi.fn(async (fn: any) =>
      fn({
        get: vi.fn(async () => ({ exists: false, data: () => null })),
        set: vi.fn(),
        update: vi.fn(),
      })
    ),
  };

  return { db, whereCalls, setCalls, docStore };
});

vi.mock('../../lib/firebase', () => ({ db, firebaseAvailable: true }));

function resetSpyDb() {
  whereCalls.length = 0;
  setCalls.length = 0;
  docStore.clear();
}

async function makeCaller() {
  const { router } = await import('../../lib/trpc');
  const { physicsRouter } = await import('../physics/physics.routes');
  const { entitiesRouter } = await import('../entities/entities.routes');
  const { curationRouter } = await import('../curation/curation.routes');
  const { notebookRouter } = await import('../notebook/notebook.routes');
  const appRouter = router({
    physics: physicsRouter,
    entities: entitiesRouter,
    curation: curationRouter,
    notebook: notebookRouter,
  });
  return appRouter.createCaller({
    user: { uid: 'test-uid', address: CREATOR, email: 'test@example.com' },
  } as any);
}

/** Asserts the call did NOT fail input validation (the old regex bug). */
function expectNotAValidationError(err: unknown) {
  if (err instanceof TRPCError) {
    expect(err.code).not.toBe('BAD_REQUEST');
  }
}

beforeEach(() => {
  resetSpyDb();
});

// ── physics router ───────────────────────────────────────────────────────

describe('physicsRouter accepts a Solana universeAddress', () => {
  it('get: passes validation and returns laws keyed by the verbatim-case PDA (no doc yet → emptyLaws)', async () => {
    const caller = await makeCaller();
    const result = await caller.physics.get({ universeAddress: SOLANA_PDA });
    // emptyLaws() used to re-lowercase this, mangling the case-sensitive PDA.
    expect(result.laws.universeAddress).toBe(SOLANA_PDA);
  });

  it('get: rejects an empty universeAddress with the required-field message, not a 500', async () => {
    const caller = await makeCaller();
    await expect(caller.physics.get({ universeAddress: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('set: gets past input validation for a Solana PDA (fails later on business logic, not on the address format)', async () => {
    const caller = await makeCaller();
    let caught: unknown;
    try {
      await caller.physics.set({ universeAddress: SOLANA_PDA, invariants: [] });
    } catch (err) {
      caught = err;
    }
    // With the empty-Firestore mock, getUniverse() finds nothing, so this
    // throws "Universe not found" from inside the handler — proof the
    // request got past zod validation instead of 400ing on address format.
    expect(caught).toBeDefined();
    expectNotAValidationError(caught);
  });
});

// ── entities router ───────────────────────────────────────────────────────

describe('entitiesRouter accepts a Solana universeAddress', () => {
  it('list: required universeAddress accepts a Solana PDA and queries Firestore with it verbatim', async () => {
    const caller = await makeCaller();
    const result = await caller.entities.list({ universeAddress: SOLANA_PDA });
    expect(result).toEqual({ entities: [], total: 0, nextCursor: null });

    const entityWhereCall = whereCalls.find(
      (c) => c.collection === 'entities' && c.field === 'universeAddress'
    );
    expect(entityWhereCall).toBeDefined();
    // Must be the exact-case PDA — NOT lowercased (bug #2 above).
    expect(entityWhereCall!.value).toBe(SOLANA_PDA);
  });

  it('list: rejects an empty universeAddress (still required) rather than 500ing', async () => {
    const caller = await makeCaller();
    await expect(caller.entities.list({ universeAddress: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('list: still lowercases an EVM universeAddress (unchanged existing behavior)', async () => {
    const caller = await makeCaller();
    await caller.entities.list({ universeAddress: MIXED_CASE_EVM });

    const entityWhereCall = whereCalls.find(
      (c) => c.collection === 'entities' && c.field === 'universeAddress'
    );
    expect(entityWhereCall!.value).toBe(LOWER_EVM);
  });

  it('create: stores a Solana universeAddress verbatim, not lowercased', async () => {
    const caller = await makeCaller();
    const result = await caller.entities.create({
      name: 'Test Character',
      description: '',
      kind: 'person',
      universeAddress: SOLANA_PDA,
    });
    expect(result.success).toBe(true);

    const entityWrite = setCalls.find((c) => c.collection === 'entities');
    expect(entityWrite).toBeDefined();
    expect(entityWrite!.data.universeAddress).toBe(SOLANA_PDA);
  });

  it('create: lowercases an EVM universeAddress on write (unchanged existing behavior)', async () => {
    const caller = await makeCaller();
    await caller.entities.create({
      name: 'Test Character',
      description: '',
      kind: 'person',
      universeAddress: MIXED_CASE_EVM,
    });

    const entityWrite = setCalls.find((c) => c.collection === 'entities');
    expect(entityWrite!.data.universeAddress).toBe(LOWER_EVM);
  });
});

// ── curation router ───────────────────────────────────────────────────────

describe('curationRouter accepts a Solana universeAddress', () => {
  it('endorse: stores a Solana universeAddress verbatim, not lowercased', async () => {
    const caller = await makeCaller();
    const result = await caller.curation.endorse({
      targetType: 'entity',
      targetId: 'test-entity-1',
      weight: 5,
      universeAddress: SOLANA_PDA,
    });
    expect(result.success).toBe(true);

    const endorsementWrite = setCalls.find((c) => c.collection === 'endorsements');
    expect(endorsementWrite).toBeDefined();
    expect(endorsementWrite!.data.universeAddress).toBe(SOLANA_PDA);
  });

  it('leaderboard: accepts a Solana universeAddress without a validation error', async () => {
    const caller = await makeCaller();
    const result = await caller.curation.leaderboard({ universeAddress: SOLANA_PDA });
    expect(result.leaderboard).toEqual([]);

    const endorsementWhereCall = whereCalls.find(
      (c) => c.collection === 'endorsements' && c.field === 'universeAddress'
    );
    expect(endorsementWhereCall!.value).toBe(SOLANA_PDA);
  });
});

// ── notebook router ───────────────────────────────────────────────────────

describe('notebookRouter accepts a Solana universeAddress', () => {
  it('create: stores a Solana universeAddress verbatim, not lowercased', async () => {
    const caller = await makeCaller();
    const result = await caller.notebook.create({
      title: 'Test Entry',
      body: 'Some notes',
      universeAddress: SOLANA_PDA,
    });
    expect(result.success).toBe(true);

    const entryWrite = setCalls.find((c) => c.collection === 'notebookEntries');
    expect(entryWrite).toBeDefined();
    expect(entryWrite!.data.universeAddress).toBe(SOLANA_PDA);
  });

  it('list: accepts a Solana universeAddress filter without a validation error', async () => {
    const caller = await makeCaller();
    const result = await caller.notebook.list({ universeAddress: SOLANA_PDA });
    expect(result).toEqual({ entries: [], total: 0 });

    const entryWhereCall = whereCalls.find(
      (c) => c.collection === 'notebookEntries' && c.field === 'universeAddress'
    );
    expect(entryWhereCall!.value).toBe(SOLANA_PDA);
  });
});
