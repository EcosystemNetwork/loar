/**
 * saveDraft / promoteToUniverse / myDrafts against a REAL Firestore emulator and
 * the real router + real isUniverseAdmin. NO MOCKS (same approach as
 * off-chain-nodes.test.ts). Prereq:
 *   firebase emulators:start --only firestore --project loar-db
 *
 * Regression coverage for the audio/3D publish bugs:
 *  - promote used `videoUrl || imageUrl || ''`, so audio drafts got an empty
 *    mediaUrl and every later audio promote matched (and overwrote) the first;
 *  - 3D drafts were published as their thumbnail image, or as the turntable video.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../__tests__/_real-firebase';
import { getFirestore } from 'firebase-admin/firestore';

// The shared setup stubs universe-admin checks to `false`; this file wants the
// real implementation reading real universe docs.
vi.unmock('../../lib/safe-admin');

const rand = () => Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40);

let ME: { uid: string; address: string; email: string };
let universeIds: string[];

beforeEach(() => {
  const address = `0x${rand()}`;
  // Wallet sessions use the (lowercased) address as their uid.
  ME = { uid: address, address, email: 't@example.com' };
  universeIds = [];
});

afterEach(async () => {
  const fs = getFirestore();
  for (const [col, field] of [
    ['sandboxDrafts', 'creatorUid'],
    ['content', 'creatorUid'],
  ] as const) {
    const snap = await fs.collection(col).where(field, '==', ME.uid).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await fs.collection('profiles').doc(ME.uid).delete();
  await Promise.all(universeIds.map((id) => fs.collection('cinematicUniverses').doc(id).delete()));
});

async function caller(user: { uid: string; address: string; email?: string } = ME) {
  const { router } = await import('../../lib/trpc');
  const { sandboxRouter } = await import('./sandbox.routes');
  return router({ sandbox: sandboxRouter }).createCaller({ user } as never).sandbox;
}

const fs = () => getFirestore();
const myContent = async () =>
  (await fs().collection('content').where('creatorUid', '==', ME.uid).get()).docs;

async function createUniverse(creator: string) {
  const id = `0x${rand()}`;
  universeIds.push(id);
  await fs().collection('cinematicUniverses').doc(id).set({ creator, name: 'Test Universe' });
  return id;
}

describe('saveDraft media selection', () => {
  it('mirrors an audio draft into content with the audio url', async () => {
    const c = await caller();
    const r = await c.saveDraft({
      title: 't',
      prompt: 'p',
      audioUrl: 'https://media.loar.fun/a.mp3',
      kind: 'audio',
    });
    const content = (await fs().collection('content').doc(r.contentId!).get()).data()!;
    expect(content).toMatchObject({
      mediaUrl: 'https://media.loar.fun/a.mp3',
      mediaType: 'ai-audio',
    });
    const draft = (await fs().collection('sandboxDrafts').doc(r.id).get()).data()!;
    expect(draft.galleryContentId).toBe(r.contentId);
  });

  it('prefers the 3D model over the turntable video and thumbnail', async () => {
    const c = await caller();
    const r = await c.saveDraft({
      title: 't',
      prompt: 'p',
      modelUrl: 'https://assets.meshy.ai/m.glb',
      videoUrl: 'https://assets.meshy.ai/t.mp4',
      imageUrl: 'https://assets.meshy.ai/t.png',
      kind: '3d',
    });
    const content = (await fs().collection('content').doc(r.contentId!).get()).data()!;
    expect(content).toMatchObject({
      mediaUrl: 'https://assets.meshy.ai/m.glb',
      mediaType: 'ai-3d',
      thumbnailUrl: 'https://assets.meshy.ai/t.png',
    });
  });

  it('saving the same media twice reuses one content record (deterministic id)', async () => {
    const c = await caller();
    const a = await c.saveDraft({
      title: 'one',
      prompt: 'p',
      imageUrl: 'https://media.loar.fun/i.png',
    });
    const b = await c.saveDraft({
      title: 'two',
      prompt: 'p',
      imageUrl: 'https://media.loar.fun/i.png',
    });
    expect(b.contentId).toBe(a.contentId);
    expect(await myContent()).toHaveLength(1);
    expect((await myContent())[0].data().title).toBe('two');
  });

  it('rejects urls on untrusted hosts and non-http schemes without writing anything', async () => {
    const c = await caller();
    await expect(
      c.saveDraft({ title: 't', prompt: 'p', imageUrl: 'https://evil.example.com/x.png' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      c.saveDraft({ title: 't', prompt: 'p', imageUrl: 'javascript:alert(1)' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await myContent()).toHaveLength(0);
    expect(
      (await fs().collection('sandboxDrafts').where('creatorUid', '==', ME.uid).get()).size
    ).toBe(0);
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
    expect(await myContent()).toHaveLength(2);
    const [ca, cb] = await Promise.all(
      [ra.contentId, rb.contentId].map(
        async (id) => (await fs().collection('content').doc(id).get()).data()!
      )
    );
    expect(ca).toMatchObject({ mediaUrl: 'https://media.loar.fun/1.mp3', visibility: 'public' });
    expect(cb).toMatchObject({ mediaUrl: 'https://media.loar.fun/2.mp3', visibility: 'private' });
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
    const docs = await myContent();
    expect(docs).toHaveLength(1);
    expect(docs[0].data()).toMatchObject({
      mediaUrl: 'https://assets.meshy.ai/m.glb',
      mediaType: 'ai-3d',
      classification: 'original',
      visibility: 'public',
    });
    const draft = (await fs().collection('sandboxDrafts').doc(d.id).get()).data()!;
    expect(draft).toMatchObject({ status: 'promoted', promotedTo: d.contentId });
  });

  it('rejects a draft with no media', async () => {
    const ref = await fs()
      .collection('sandboxDrafts')
      .add({ creatorUid: ME.uid, title: 't', prompt: 'p' });
    const c = await caller();
    await expect(c.promoteToUniverse({ draftId: ref.id })).rejects.toMatchObject({
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
    const other = await caller({ uid: `0x${rand()}`, address: `0x${rand()}` });
    await expect(other.promoteToUniverse({ draftId: d.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('promotes into a universe only for its real creator (real isUniverseAdmin)', async () => {
    const c = await caller();
    const d = await c.saveDraft({
      title: 't',
      prompt: 'p',
      imageUrl: 'https://media.loar.fun/i.png',
    });

    const notMine = await createUniverse(`0x${rand()}`);
    await expect(c.promoteToUniverse({ draftId: d.id, universeId: notMine })).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      }
    );

    const mine = await createUniverse(ME.address);
    const ok = await c.promoteToUniverse({ draftId: d.id, universeId: mine });
    expect(ok.universeId).toBe(mine);
    expect((await myContent())[0].data().universeId).toBe(mine);
  });
});

describe('myDrafts', () => {
  it('honours the limit and returns newest first', async () => {
    const c = await caller();
    for (const n of [1, 2, 3]) {
      await c.saveDraft({
        title: `d${n}`,
        prompt: 'p',
        imageUrl: `https://media.loar.fun/${n}.png`,
      });
      await new Promise((r) => setTimeout(r, 15));
    }
    const two = await c.myDrafts({ limit: 2 });
    expect(two.map((d) => d.title)).toEqual(['d3', 'd2']);
    const all = await c.myDrafts();
    expect(all.map((d) => d.title)).toEqual(['d3', 'd2', 'd1']);
  });
});
