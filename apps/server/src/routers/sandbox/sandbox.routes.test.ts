/**
 * saveDraft / promoteToUniverse integration tests against a stateful in-memory
 * Firestore fake. Regression coverage for the audio/3D publish bugs:
 *  - promote used `videoUrl || imageUrl || ''`, so audio drafts got an empty
 *    mediaUrl and every later audio promote matched (and overwrote) the first;
 *  - 3D drafts were published as their thumbnail image, or as the turntable video.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { isUniverseAdmin } from '../../lib/safe-admin';

const { db, store, resetStore } = vi.hoisted(() => {
  const store = new Map<string, Map<string, Record<string, any>>>();
  let auto = 0;
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const snap = (name: string, id: string) => {
    const data = col(name).get(id);
    return { id, exists: data !== undefined, data: () => data, ref: docRef(name, id) };
  };
  const docRef = (name: string, id: string): any => ({
    __doc: true,
    col: name,
    id,
    get: async () => snap(name, id),
    set: async (d: any, opts?: any) => {
      col(name).set(id, opts?.merge ? { ...(col(name).get(id) ?? {}), ...d } : d);
    },
    update: async (d: any) => {
      col(name).set(id, { ...(col(name).get(id) ?? {}), ...d });
    },
    delete: async () => {
      col(name).delete(id);
    },
  });
  const query = (name: string, filters: Array<[string, any]> = []): any => ({
    __query: true,
    col: name,
    filters,
    where: (f: string, _op: string, v: any) => query(name, [...filters, [f, v]]),
    orderBy: () => query(name, filters),
    limit: () => query(name, filters),
    get: async () => {
      const docs = [...col(name).entries()]
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .map(([id]) => snap(name, id));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const db = {
    collection: (name: string) => ({
      ...query(name),
      doc: (id?: string) => docRef(name, id ?? `auto-${++auto}`),
      add: async (d: any) => {
        const id = `auto-${++auto}`;
        col(name).set(id, d);
        return docRef(name, id);
      },
    }),
    runTransaction: async (fn: any) =>
      fn({
        get: async (x: any) => (x.__doc ? snap(x.col, x.id) : x.get()),
        set: (ref: any, d: any) => col(ref.col).set(ref.id, d),
        update: (ref: any, d: any) =>
          col(ref.col).set(ref.id, { ...(col(ref.col).get(ref.id) ?? {}), ...d }),
      }),
  };
  return { db, store, resetStore: () => store.clear() };
});

vi.mock('../../lib/firebase', () => ({ db, firebaseAvailable: true }));

const USER = { uid: 'u1', address: '0x1111111111111111111111111111111111111111', email: 'a@b.c' };

async function caller(user: any = USER) {
  const { router } = await import('../../lib/trpc');
  const { sandboxRouter } = await import('./sandbox.routes');
  return router({ sandbox: sandboxRouter }).createCaller({ user } as any).sandbox;
}
const contentDocs = () => [...(store.get('content') ?? new Map()).entries()];

beforeEach(() => resetStore());

describe('saveDraft media selection', () => {
  it('mirrors an audio draft into content with the audio url', async () => {
    const c = await caller();
    const r = await c.saveDraft({
      title: 't',
      prompt: 'p',
      audioUrl: 'https://media.loar.fun/a.mp3',
      kind: 'audio',
    });
    const [, content] = contentDocs()[0];
    expect(content).toMatchObject({
      mediaUrl: 'https://media.loar.fun/a.mp3',
      mediaType: 'ai-audio',
    });
    expect(store.get('sandboxDrafts')!.get(r.id)!.galleryContentId).toBe(r.contentId);
  });

  it('prefers the 3D model over the turntable video and thumbnail', async () => {
    const c = await caller();
    await c.saveDraft({
      title: 't',
      prompt: 'p',
      modelUrl: 'https://assets.meshy.ai/m.glb',
      videoUrl: 'https://assets.meshy.ai/t.mp4',
      imageUrl: 'https://assets.meshy.ai/t.png',
      kind: '3d',
    });
    expect(contentDocs()[0][1]).toMatchObject({
      mediaUrl: 'https://assets.meshy.ai/m.glb',
      mediaType: 'ai-3d',
      thumbnailUrl: 'https://assets.meshy.ai/t.png',
    });
  });

  it('rejects urls on untrusted hosts and non-http schemes', async () => {
    const c = await caller();
    await expect(
      c.saveDraft({ title: 't', prompt: 'p', imageUrl: 'https://evil.example.com/x.png' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      c.saveDraft({ title: 't', prompt: 'p', imageUrl: 'javascript:alert(1)' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('promoteToUniverse', () => {
  it('promotes two audio drafts to two distinct content docs (no empty-mediaUrl collision)', async () => {
    const c = await caller();
    const a = await c.saveDraft({
      title: 'a',
      prompt: 'p',
      audioUrl: 'https://media.loar.fun/1.mp3',
      kind: 'audio',
    });
    const b = await c.saveDraft({
      title: 'b',
      prompt: 'p',
      audioUrl: 'https://media.loar.fun/2.mp3',
      kind: 'audio',
    });
    const ra = await c.promoteToUniverse({ draftId: a.id, visibility: 'public' });
    const rb = await c.promoteToUniverse({ draftId: b.id, visibility: 'private' });

    expect(ra.contentId).not.toBe(rb.contentId);
    const docs = contentDocs();
    expect(docs).toHaveLength(2);
    const byId = Object.fromEntries(docs.map(([id, d]) => [id, d]));
    expect(byId[ra.contentId]).toMatchObject({
      mediaUrl: 'https://media.loar.fun/1.mp3',
      visibility: 'public',
    });
    expect(byId[rb.contentId]).toMatchObject({
      mediaUrl: 'https://media.loar.fun/2.mp3',
      visibility: 'private',
    });
  });

  it('updates the content record saveDraft already created instead of duplicating it (3D)', async () => {
    const c = await caller();
    const d = await c.saveDraft({
      title: 't',
      prompt: 'p',
      modelUrl: 'https://assets.meshy.ai/m.glb',
      imageUrl: 'https://assets.meshy.ai/t.png',
      kind: '3d',
    });
    const r = await c.promoteToUniverse({
      draftId: d.id,
      classification: 'original',
      visibility: 'public',
    });
    expect(r.contentId).toBe(d.contentId);
    expect(contentDocs()).toHaveLength(1);
    expect(contentDocs()[0][1]).toMatchObject({
      mediaUrl: 'https://assets.meshy.ai/m.glb',
      mediaType: 'ai-3d',
      classification: 'original',
      visibility: 'public',
    });
  });

  it('rejects a draft with no media', async () => {
    store.set('sandboxDrafts', new Map([['d1', { creatorUid: 'u1', title: 't', prompt: 'p' }]]));
    const c = await caller();
    await expect(c.promoteToUniverse({ draftId: 'd1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it("refuses to promote someone else's draft", async () => {
    const c = await caller();
    const d = await c.saveDraft({
      title: 't',
      prompt: 'p',
      imageUrl: 'https://media.loar.fun/i.png',
    });
    const other = await caller({
      uid: 'u2',
      address: '0x2222222222222222222222222222222222222222',
    });
    await expect(other.promoteToUniverse({ draftId: d.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('requires universe admin when a universeId is given', async () => {
    const c = await caller();
    const d = await c.saveDraft({
      title: 't',
      prompt: 'p',
      imageUrl: 'https://media.loar.fun/i.png',
    });
    vi.mocked(isUniverseAdmin).mockResolvedValueOnce(false);
    await expect(c.promoteToUniverse({ draftId: d.id, universeId: 'uni1' })).rejects.toBeInstanceOf(
      TRPCError
    );
    vi.mocked(isUniverseAdmin).mockResolvedValueOnce(true);
    const ok = await c.promoteToUniverse({ draftId: d.id, universeId: 'uni1' });
    expect(ok.universeId).toBe('uni1');
    expect(contentDocs()[0][1].universeId).toBe('uni1');
  });
});
