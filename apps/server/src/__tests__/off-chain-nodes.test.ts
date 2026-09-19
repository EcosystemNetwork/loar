/**
 * Tests for the `offChainNodes` tRPC router — the create / list / get /
 * update / delete lifecycle of Firestore-backed timeline nodes.
 *
 * NO MOCKS: real Firestore emulator + the real router (same approach as
 * likeness-marketplace.test.ts). Prereq:
 *   firebase emulators:start --only firestore --project loar-db
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { keccak256, toBytes } from 'viem';
import './_real-firebase';

const ALICE = '0x1234567890abcdef1234567890abcdef12345678';
const BOB = '0x2222222222222222222222222222222222222222';
const TEST_CLIENT_IP = '127.0.0.1';

let universeId: string;

beforeEach(() => {
  universeId = `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)}`;
});

async function mount() {
  const { router } = await import('../lib/trpc');
  const { offChainNodesRouter } = await import('../routers/offChainNodes/offChainNodes.routes');
  return router({ offChainNodes: offChainNodesRouter });
}

async function callerFor(user: { uid: string; address?: string } | null) {
  const app = await mount();
  return app.createCaller({
    user: user ? { email: 't@example.com', address: '', ...user } : null,
    clientIp: TEST_CLIENT_IP,
  } as never).offChainNodes;
}

const alice = () => callerFor({ uid: 'alice-uid', address: ALICE });
const bob = () => callerFor({ uid: 'bob-uid', address: BOB });
const anon = () => callerFor(null);

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe(code);
}

describe('offChainNodes.create', () => {
  it('rejects unauthenticated callers', async () => {
    await expectCode((await anon()).create({ universeId, plot: 'x' }), 'UNAUTHORIZED');
  });

  it('creates a root node: nodeId 1, canon, empty children, hashes derived', async () => {
    const a = await alice();
    const n = await a.create({
      universeId,
      videoUrl: 'https://example.com/v.mp4',
      plot: 'Opening',
      title: 'Ep 1',
    });
    expect(n.nodeId).toBe(1);
    expect(n.canon).toBe(true);
    expect(n.previousNodeId).toBe(0);
    expect(n.children).toEqual([]);
    expect(n.title).toBe('Ep 1');
    expect(n.creator).toBe(ALICE);
    expect(n.contentHash).toBe(keccak256(toBytes('https://example.com/v.mp4')));
    expect(n.plotHash).toBe(keccak256(toBytes('Opening')));
    expect(n.id).toBeTruthy();
  });

  it('allows a node with no media or plot (voice-director plot point)', async () => {
    const n = await (await alice()).create({ universeId });
    expect(n.videoUrl).toBe('');
    expect(n.plot).toBe('');
    expect(n.sceneId).toBeNull();
  });

  it('honours contentHash / plotHash overrides', async () => {
    const n = await (await alice()).create({ universeId, contentHash: '0xabc', plotHash: '0xdef' });
    expect(n.contentHash).toBe('0xabc');
    expect(n.plotHash).toBe('0xdef');
  });

  it('stores the caller as creator (lowercased), falling back to uid', async () => {
    const mixed = await callerFor({
      uid: 'u1',
      address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
    });
    const n1 = await mixed.create({ universeId });
    expect(n1.creator).toBe('0xabcdef1234567890abcdef1234567890abcdef12');

    const noAddr = await callerFor({ uid: 'UID-Only' });
    const n2 = await noAddr.create({ universeId });
    expect(n2.creator).toBe('uid-only');
  });

  it('assigns sequential ids per universe, independently across universes', async () => {
    const a = await alice();
    const other = `${universeId.slice(0, -1)}f`;
    const n1 = await a.create({ universeId });
    const n2 = await a.create({ universeId, previousNodeId: 1 });
    const o1 = await a.create({ universeId: other });
    expect([n1.nodeId, n2.nodeId, o1.nodeId]).toEqual([1, 2, 1]);
  });

  it('assigns unique ids under concurrent creation', async () => {
    const a = await alice();
    const created = await Promise.all(Array.from({ length: 8 }, () => a.create({ universeId })));
    const ids = created.map((n) => n.nodeId).sort((x, y) => x - y);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('links a child to its parent and marks it non-canon', async () => {
    const a = await alice();
    await a.create({ universeId });
    const child = await a.create({ universeId, previousNodeId: 1 });
    expect(child.canon).toBe(false);
    expect(child.previousNodeId).toBe(1);
    const parent = await a.get({ universeId, nodeId: 1 });
    expect(parent?.children).toEqual([2]);
  });

  it('keeps every sibling when branches are created concurrently', async () => {
    const a = await alice();
    await a.create({ universeId });
    const kids = await Promise.all(
      Array.from({ length: 6 }, () => a.create({ universeId, previousNodeId: 1 }))
    );
    const parent = await a.get({ universeId, nodeId: 1 });
    expect([...(parent?.children as number[])].sort((x, y) => x - y)).toEqual(
      kids.map((k) => k.nodeId).sort((x, y) => x - y)
    );
  });

  it('rejects a parent that does not exist', async () => {
    await expectCode((await alice()).create({ universeId, previousNodeId: 42 }), 'NOT_FOUND');
  });

  it('does not burn a node id when the parent is missing', async () => {
    const a = await alice();
    await a.create({ universeId, previousNodeId: 42 }).catch(() => null);
    const n = await a.create({ universeId });
    expect(n.nodeId).toBe(1);
  });

  it('canonicalises an EVM universeId so mixed-case ids land where readers look', async () => {
    const a = await alice();
    const checksummed = `0x${universeId.slice(2).toUpperCase()}`;
    const n = await a.create({ universeId: checksummed });
    expect(n.universeId).toBe(universeId.toLowerCase());
    const listed = await a.list({ universeId: universeId.toLowerCase() });
    expect(listed.total).toBe(1);
  });

  it('keeps a Solana base58 universeId verbatim (case-sensitive)', async () => {
    const pda = `Sol${Math.random().toString(36).slice(2)}PdaAbCdEf1234567890`;
    const a = await alice();
    const n = await a.create({ universeId: pda });
    expect(n.universeId).toBe(pda);
    expect((await a.list({ universeId: pda })).total).toBe(1);
  });

  describe('input validation', () => {
    it.each([
      ['empty universeId', { universeId: '' }],
      ['non-url videoUrl', { videoUrl: 'not a url' }],
      ['oversized plot', { plot: 'x'.repeat(20001) }],
      ['oversized title', { title: 'x'.repeat(301) }],
      ['negative previousNodeId', { previousNodeId: -1 }],
      ['fractional previousNodeId', { previousNodeId: 1.5 }],
      ['fractional sceneId', { sceneId: 0.5 }],
    ])('rejects %s', async (_label, patch) => {
      await expect(
        (await alice()).create({ universeId, ...(patch as object) } as never)
      ).rejects.toThrow();
    });

    it('accepts a plot at exactly the limit', async () => {
      const n = await (await alice()).create({ universeId, plot: 'x'.repeat(20000) });
      expect(n.plot).toHaveLength(20000);
    });

    it('persists sceneId when given', async () => {
      const n = await (await alice()).create({ universeId, sceneId: 7 });
      expect(n.sceneId).toBe(7);
    });
  });
});

describe('offChainNodes.list / get', () => {
  it('list is public and returns an empty set for an unknown universe', async () => {
    expect(await (await anon()).list({ universeId })).toEqual({ nodes: [], total: 0 });
  });

  it('lists nodes in ascending nodeId order, scoped to the universe', async () => {
    const a = await alice();
    await a.create({ universeId, title: 'one' });
    await a.create({ universeId, title: 'two', previousNodeId: 1 });
    await a.create({ universeId, title: 'three', previousNodeId: 2 });
    await a.create({ universeId: `${universeId.slice(0, -1)}e`, title: 'elsewhere' });
    const res = await (await anon()).list({ universeId });
    expect(res.total).toBe(3);
    expect(res.nodes.map((n) => n.title)).toEqual(['one', 'two', 'three']);
  });

  it('get returns the node, or null when missing', async () => {
    const a = await alice();
    await a.create({ universeId, title: 'one' });
    expect((await (await anon()).get({ universeId, nodeId: 1 }))?.title).toBe('one');
    expect(await (await anon()).get({ universeId, nodeId: 99 })).toBeNull();
  });

  it('get rejects a non-integer nodeId', async () => {
    await expect((await anon()).get({ universeId, nodeId: 1.5 })).rejects.toThrow();
  });
});

describe('offChainNodes.update', () => {
  it('rejects unauthenticated callers', async () => {
    await expectCode((await anon()).update({ universeId, nodeId: 1, title: 'x' }), 'UNAUTHORIZED');
  });

  it('updates title, plot (re-hashing it) and canon for the creator', async () => {
    const a = await alice();
    await a.create({ universeId, plot: 'old' });
    const u = await a.update({
      universeId,
      nodeId: 1,
      title: 'New',
      plot: 'new plot',
      canon: false,
    });
    expect(u.title).toBe('New');
    expect(u.plot).toBe('new plot');
    expect(u.plotHash).toBe(keccak256(toBytes('new plot')));
    expect(u.canon).toBe(false);
    const stored = await a.get({ universeId, nodeId: 1 });
    expect(stored?.plot).toBe('new plot');
    expect(stored?.plotHash).toBe(keccak256(toBytes('new plot')));
    expect(stored?.canon).toBe(false);
  });

  it('leaves untouched fields alone', async () => {
    const a = await alice();
    await a.create({ universeId, plot: 'keep', title: 'keep-title' });
    await a.update({ universeId, nodeId: 1, canon: false });
    const stored = await a.get({ universeId, nodeId: 1 });
    expect(stored?.plot).toBe('keep');
    expect(stored?.title).toBe('keep-title');
  });

  it('can clear a title with an empty string', async () => {
    const a = await alice();
    await a.create({ universeId, title: 'gone' });
    await a.update({ universeId, nodeId: 1, title: '' });
    expect((await a.get({ universeId, nodeId: 1 }))?.title).toBe('');
  });

  it('bumps updatedAt', async () => {
    const a = await alice();
    const created = await a.create({ universeId });
    await new Promise((r) => setTimeout(r, 5));
    await a.update({ universeId, nodeId: 1, title: 't' });
    const stored = (await a.get({ universeId, nodeId: 1 })) as { updatedAt: { toDate(): Date } };
    expect(stored.updatedAt.toDate().getTime()).toBeGreaterThan(
      (created.updatedAt as Date).getTime()
    );
  });

  it('forbids anyone but the creator', async () => {
    await (await alice()).create({ universeId, plot: 'mine' });
    await expectCode((await bob()).update({ universeId, nodeId: 1, plot: 'hijack' }), 'FORBIDDEN');
    expect((await (await alice()).get({ universeId, nodeId: 1 }))?.plot).toBe('mine');
  });

  it('matches the creator case-insensitively', async () => {
    await (await alice()).create({ universeId });
    const shouty = await callerFor({ uid: 'x', address: ALICE.toUpperCase().replace('0X', '0x') });
    await expect(shouty.update({ universeId, nodeId: 1, title: 'ok' })).resolves.toBeTruthy();
  });

  it('returns NOT_FOUND (not a bare 500) for a missing node', async () => {
    await expectCode((await alice()).update({ universeId, nodeId: 9, title: 'x' }), 'NOT_FOUND');
  });

  it('rejects oversized plot / title', async () => {
    const a = await alice();
    await a.create({ universeId });
    await expect(a.update({ universeId, nodeId: 1, plot: 'x'.repeat(20001) })).rejects.toThrow();
    await expect(a.update({ universeId, nodeId: 1, title: 'x'.repeat(301) })).rejects.toThrow();
  });

  it('finds a node via a mixed-case EVM universeId', async () => {
    const a = await alice();
    await a.create({ universeId });
    const shouty = `0x${universeId.slice(2).toUpperCase()}`;
    await expect(a.update({ universeId: shouty, nodeId: 1, title: 'x' })).resolves.toBeTruthy();
  });
});

describe('offChainNodes.delete', () => {
  it('rejects unauthenticated callers', async () => {
    await expectCode((await anon()).delete({ universeId, nodeId: 1 }), 'UNAUTHORIZED');
  });

  it('deletes the node and unlinks it from the parent', async () => {
    const a = await alice();
    await a.create({ universeId });
    await a.create({ universeId, previousNodeId: 1 });
    await a.create({ universeId, previousNodeId: 1 });
    expect(await a.delete({ universeId, nodeId: 2 })).toEqual({ deleted: true });
    expect(await a.get({ universeId, nodeId: 2 })).toBeNull();
    expect((await a.get({ universeId, nodeId: 1 }))?.children).toEqual([3]);
    expect((await a.list({ universeId })).total).toBe(2);
  });

  it('deleting a root node needs no parent', async () => {
    const a = await alice();
    await a.create({ universeId });
    expect(await a.delete({ universeId, nodeId: 1 })).toEqual({ deleted: true });
  });

  it('is idempotent: deleting a missing node reports deleted:false', async () => {
    expect(await (await alice()).delete({ universeId, nodeId: 5 })).toEqual({ deleted: false });
  });

  it('forbids anyone but the creator, and leaves the node intact', async () => {
    await (await alice()).create({ universeId });
    await expectCode((await bob()).delete({ universeId, nodeId: 1 }), 'FORBIDDEN');
    expect(await (await alice()).get({ universeId, nodeId: 1 })).not.toBeNull();
  });

  it('never reuses a deleted node id', async () => {
    const a = await alice();
    await a.create({ universeId });
    await a.create({ universeId, previousNodeId: 1 });
    await a.delete({ universeId, nodeId: 2 });
    const n = await a.create({ universeId, previousNodeId: 1 });
    expect(n.nodeId).toBe(3);
  });
});
