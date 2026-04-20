/**
 * Unit tests for entities.visual-descriptor.ts.
 *
 * Covers the tricky paths that types can't catch:
 *   - version bump + history archive on every write
 *   - creator-pinned assets survive VLM auto-refresh
 *   - MAX_DESCRIPTOR_REFERENCES cap prefers pinned, then highest priority
 *   - sanitizer rejects invalid roles / non-string attributes / duplicate CIDs
 *   - revert round-trip (current → history → restore bumps version)
 *   - pinReferenceAsset toggles flag and errors on missing descriptor / cid
 *
 * Uses a local in-memory Firestore mock so transactions + subcollections
 * behave realistically; overrides the global stub in __tests__/setup.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Entity, EntityVisualDescriptor } from './entities.types';
import { MAX_DESCRIPTOR_REFERENCES } from './entities.types';

// ── In-memory Firestore facsimile ────────────────────────────────────

interface DocSnap {
  exists: boolean;
  data: () => any;
  id: string;
}

type Store = Map<string, any>; // path -> doc data

function makeInMemoryDb() {
  const store: Store = new Map();

  function docRef(path: string) {
    return {
      _path: path,
      async get(): Promise<DocSnap> {
        const data = store.get(path);
        return {
          exists: data !== undefined,
          data: () => data,
          id: path.split('/').pop()!,
        };
      },
      async set(data: any) {
        store.set(path, { ...data });
      },
      async update(patch: any) {
        const existing = store.get(path);
        if (existing === undefined) throw new Error(`update() on missing doc: ${path}`);
        store.set(path, { ...existing, ...patch });
      },
      async delete() {
        store.delete(path);
      },
      collection(name: string) {
        return collectionRef(`${path}/${name}`);
      },
    };
  }

  function collectionRef(path: string) {
    return {
      _path: path,
      doc(id: string) {
        return docRef(`${path}/${id}`);
      },
      async get() {
        const prefix = `${path}/`;
        const docs = [...store.entries()]
          .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .map(([p, data]) => ({
            id: p.split('/').pop()!,
            exists: true,
            data: () => data,
          }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
      // Minimal query builder — only covers what getDescriptorHistory uses.
      orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return {
          limit(n: number) {
            return {
              async get() {
                const snap = await self.get();
                const sorted = [...snap.docs].sort((a, b) => {
                  const av = (a.data() as any)[field];
                  const bv = (b.data() as any)[field];
                  return direction === 'desc' ? bv - av : av - bv;
                });
                const sliced = sorted.slice(0, n);
                return { docs: sliced, empty: sliced.length === 0, size: sliced.length };
              },
            };
          },
        };
      },
    };
  }

  const db = {
    _store: store,
    collection(name: string) {
      return collectionRef(name);
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      // Simplified: no isolation; executes reads + writes inline. Good
      // enough for single-actor unit tests of our logic paths.
      const tx = {
        async get(ref: any): Promise<DocSnap> {
          return ref.get();
        },
        set(ref: any, data: any) {
          store.set(ref._path, { ...data });
        },
        update(ref: any, patch: any) {
          const existing = store.get(ref._path);
          if (existing === undefined) throw new Error(`tx.update on missing doc: ${ref._path}`);
          store.set(ref._path, { ...existing, ...patch });
        },
      };
      return fn(tx);
    },
  };

  return { db, store };
}

const inMem = makeInMemoryDb();

vi.mock('../../lib/firebase', () => ({
  db: inMem.db,
  firebaseAvailable: true,
}));

// Import AFTER the mock so the module binds to our in-memory db.
const {
  getVisualDescriptor,
  writeVisualDescriptor,
  pinReferenceAsset,
  revertVisualDescriptor,
  getDescriptorHistory,
} = await import('./entities.visual-descriptor');

// ── Helpers ──────────────────────────────────────────────────────────

function seedEntity(id: string, descriptor: EntityVisualDescriptor | null = null): Entity {
  const entity: Entity = {
    id,
    name: `Entity ${id}`,
    description: '',
    kind: 'person',
    universeAddress: null,
    parentId: null,
    nodeIds: [],
    imageUrl: null,
    metadata: {},
    creator: '0xabc',
    monetized: false,
    rightsDeclaration: null,
    unstoppableDomain: null,
    referenceBundle: null,
    visualDescriptor: descriptor,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  inMem.store.set(`entities/${id}`, entity);
  return entity;
}

const ASSET = (overrides: Partial<any> = {}) => ({
  cid: 'cid-1',
  mediaUrl: 'https://gw/cid-1',
  role: 'identity' as const,
  priority: 0,
  ...overrides,
});

beforeEach(() => {
  inMem.store.clear();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('getVisualDescriptor', () => {
  it('returns null when the entity has no descriptor', async () => {
    seedEntity('e1', null);
    expect(await getVisualDescriptor('e1')).toBeNull();
  });

  it('returns null when the entity does not exist', async () => {
    expect(await getVisualDescriptor('missing')).toBeNull();
  });

  it('returns the descriptor when present', async () => {
    const desc: EntityVisualDescriptor = {
      version: 3,
      canonicalDescription: 'A hero',
      attributes: { build: 'lean' },
      referenceAssets: [],
      lastUpdatedBy: 'vlm',
      updatedAt: new Date(),
    };
    seedEntity('e1', desc);
    const got = await getVisualDescriptor('e1');
    expect(got?.version).toBe(3);
    expect(got?.canonicalDescription).toBe('A hero');
  });
});

describe('writeVisualDescriptor', () => {
  it('creates v1 when no prior descriptor exists', async () => {
    seedEntity('e1', null);
    const next = await writeVisualDescriptor('e1', {
      canonicalDescription: 'v1',
      attributes: { hair: 'black' },
      referenceAssets: [ASSET()],
    });
    expect(next.version).toBe(1);
    expect(next.canonicalDescription).toBe('v1');
    expect(next.attributes.hair).toBe('black');
    expect(next.referenceAssets).toHaveLength(1);
  });

  it('bumps version and archives the prior on subsequent writes', async () => {
    seedEntity('e1', null);
    await writeVisualDescriptor('e1', { canonicalDescription: 'v1' });
    const v2 = await writeVisualDescriptor('e1', { canonicalDescription: 'v2' });
    expect(v2.version).toBe(2);

    const history = await getDescriptorHistory('e1');
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].canonicalDescription).toBe('v1');
  });

  it('preserves creator-pinned assets across VLM rewrites', async () => {
    seedEntity('e1', null);
    // v1 with a creator-pinned identity ref
    await writeVisualDescriptor('e1', {
      canonicalDescription: 'v1',
      referenceAssets: [ASSET({ cid: 'pinned-cid', pinnedByCreator: true, priority: 10 })],
      lastUpdatedBy: 'creator',
    });

    // v2: VLM rewrites with a totally different asset set (no pinned cid mentioned)
    const v2 = await writeVisualDescriptor('e1', {
      canonicalDescription: 'v2',
      referenceAssets: [
        ASSET({ cid: 'vlm-new-1', priority: 5 }),
        ASSET({ cid: 'vlm-new-2', priority: 3 }),
      ],
      lastUpdatedBy: 'vlm',
    });

    const cids = v2.referenceAssets.map((a) => a.cid);
    expect(cids).toContain('pinned-cid');
    expect(cids).toContain('vlm-new-1');
    expect(cids).toContain('vlm-new-2');
    expect(v2.referenceAssets.find((a) => a.cid === 'pinned-cid')?.pinnedByCreator).toBe(true);
  });

  it('enforces MAX_DESCRIPTOR_REFERENCES cap, keeping pinned + highest-priority first', async () => {
    seedEntity('e1', null);
    const many = Array.from({ length: MAX_DESCRIPTOR_REFERENCES + 4 }, (_, i) =>
      ASSET({
        cid: `cid-${i}`,
        priority: i,
        pinnedByCreator: i < 2, // first two pinned, rest unpinned with ascending priority
      })
    );
    const next = await writeVisualDescriptor('e1', { referenceAssets: many });
    expect(next.referenceAssets).toHaveLength(MAX_DESCRIPTOR_REFERENCES);
    // Both pinned items must survive
    const pinned = next.referenceAssets.filter((a) => a.pinnedByCreator);
    expect(pinned).toHaveLength(2);
    // Highest priority unpinned should survive; lowest should be dropped
    const unpinnedCids = next.referenceAssets.filter((a) => !a.pinnedByCreator).map((a) => a.cid);
    expect(unpinnedCids).not.toContain('cid-2'); // lowest-priority unpinned dropped
    expect(unpinnedCids).toContain(`cid-${MAX_DESCRIPTOR_REFERENCES + 3}`); // highest survived
  });

  it('sanitizer strips invalid roles, non-string attributes, and duplicate CIDs', async () => {
    seedEntity('e1', null);
    const next = await writeVisualDescriptor('e1', {
      canonicalDescription: 'x',
      attributes: {
        good: 'yes',
        alsoGood: ['a', 'b'],
        badNumber: 42 as unknown as string,
        badObject: { nested: true } as unknown as string,
      },
      referenceAssets: [
        ASSET({ cid: 'dup', role: 'identity' }),
        ASSET({ cid: 'dup', role: 'outfit' }), // duplicate CID — dropped
        ASSET({ cid: 'bad-role', role: 'not-a-role' as any }), // invalid role — dropped
        ASSET({ cid: 'ok', role: 'prop' }),
      ],
    });
    expect(next.attributes).toEqual({ good: 'yes', alsoGood: ['a', 'b'] });
    const cids = next.referenceAssets.map((a) => a.cid);
    expect(cids).toEqual(expect.arrayContaining(['dup', 'ok']));
    expect(cids).not.toContain('bad-role');
    // Only one "dup" — the first occurrence wins
    expect(cids.filter((c) => c === 'dup')).toHaveLength(1);
  });

  it('throws when the entity does not exist', async () => {
    await expect(writeVisualDescriptor('missing', {})).rejects.toThrow(/Entity not found/);
  });
});

describe('pinReferenceAsset', () => {
  it('flips the pinned flag on the matching asset', async () => {
    seedEntity('e1', null);
    await writeVisualDescriptor('e1', {
      referenceAssets: [ASSET({ cid: 'c1' }), ASSET({ cid: 'c2' })],
    });
    const next = await pinReferenceAsset('e1', 'c2', true);
    expect(next.referenceAssets.find((a) => a.cid === 'c2')?.pinnedByCreator).toBe(true);
    expect(next.referenceAssets.find((a) => a.cid === 'c1')?.pinnedByCreator).toBe(false);
    expect(next.lastUpdatedBy).toBe('creator');
  });

  it('throws when the entity has no descriptor yet', async () => {
    seedEntity('e1', null);
    await expect(pinReferenceAsset('e1', 'c1', true)).rejects.toThrow(/no visual descriptor/);
  });

  it('throws when the cid is not on the descriptor', async () => {
    seedEntity('e1', null);
    await writeVisualDescriptor('e1', { referenceAssets: [ASSET({ cid: 'real' })] });
    await expect(pinReferenceAsset('e1', 'missing', true)).rejects.toThrow(/not found/);
  });
});

describe('revertVisualDescriptor', () => {
  it('restores a prior version and bumps the version number', async () => {
    seedEntity('e1', null);
    await writeVisualDescriptor('e1', { canonicalDescription: 'v1' });
    await writeVisualDescriptor('e1', { canonicalDescription: 'v2' });
    await writeVisualDescriptor('e1', { canonicalDescription: 'v3' });

    const reverted = await revertVisualDescriptor('e1', 1);
    expect(reverted.canonicalDescription).toBe('v1');
    expect(reverted.version).toBe(4); // v3 was 3; revert bumps to 4
    expect(reverted.lastUpdatedBy).toBe('creator');

    const current = await getVisualDescriptor('e1');
    expect(current?.canonicalDescription).toBe('v1');
    expect(current?.version).toBe(4);
  });

  it('archives the current version before reverting (revert-then-forward is possible)', async () => {
    seedEntity('e1', null);
    await writeVisualDescriptor('e1', { canonicalDescription: 'v1' });
    await writeVisualDescriptor('e1', { canonicalDescription: 'v2' });
    await revertVisualDescriptor('e1', 1);

    const history = await getDescriptorHistory('e1', 50);
    const versions = history.map((h) => h.version).sort((a, b) => a - b);
    // v1 was archived on the write of v2; v2 was archived on the revert.
    expect(versions).toContain(1);
    expect(versions).toContain(2);
  });

  it('throws when the target version does not exist', async () => {
    seedEntity('e1', null);
    await writeVisualDescriptor('e1', { canonicalDescription: 'v1' });
    await expect(revertVisualDescriptor('e1', 99)).rejects.toThrow(/version 99 not found/);
  });
});

describe('getDescriptorHistory', () => {
  it('returns archived versions newest-first', async () => {
    seedEntity('e1', null);
    await writeVisualDescriptor('e1', { canonicalDescription: 'v1' });
    await writeVisualDescriptor('e1', { canonicalDescription: 'v2' });
    await writeVisualDescriptor('e1', { canonicalDescription: 'v3' });
    const history = await getDescriptorHistory('e1', 10);
    const versions = history.map((h) => h.version);
    expect(versions).toEqual([2, 1]); // v3 is still current, not archived
  });

  it('respects the limit argument', async () => {
    seedEntity('e1', null);
    for (let i = 1; i <= 5; i++) {
      await writeVisualDescriptor('e1', { canonicalDescription: `v${i}` });
    }
    const history = await getDescriptorHistory('e1', 2);
    expect(history).toHaveLength(2);
  });
});
