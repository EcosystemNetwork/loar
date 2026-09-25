/**
 * threed.remesh — the LIVE route, end to end: real router + real Firestore
 * emulator + real Redis (budget holds) + a local HTTP server that implements
 * Meshy's documented remesh contract. Only the storage re-host is stubbed (it
 * would upload to real storage). Not verified against the live Meshy API.
 *
 * Prereq: firebase emulators:start --only firestore --project loar-db
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import './_real-firebase';

const PORT = vi.hoisted(() => {
  const port = 40000 + Math.floor(Math.random() * 20000);
  process.env.MESHY_API_HOST = `http://127.0.0.1:${port}`;
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  return port;
});

vi.mock('../lib/byok', async (orig) => ({
  ...(await orig<typeof import('../lib/byok')>()),
  resolveProviderKey: async () => 'meshy-test-key',
}));
// Storage boundary: pretend every requested format was re-hosted permanently.
vi.mock('../lib/rehost-ephemeral', async (orig) => ({
  ...(await orig<typeof import('../lib/rehost-ephemeral')>()),
  rehostModelBundle: async (input: any, slug: string) => ({
    modelUrls: Object.fromEntries(
      Object.entries(input.modelUrls ?? {})
        .filter(([, v]) => !!v)
        .map(([k]) => [k, `https://permanent.example/${slug}.${k}`])
    ),
    thumbnailUrl: input.thumbnailUrl ? 'https://permanent.example/thumb.png' : null,
    videoUrl: null,
  }),
}));

// Unique per test: the emulator keeps data between runs, so a shared task id would let an
// earlier run's gallery item satisfy (or break) a later test's assertions.
let taskId = '';
let seen: Array<{ method: string; url: string; body?: any }> = [];
let taskScript: Array<Record<string, unknown>> = [];
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : undefined });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/openapi/v1/remesh') {
        res.end(JSON.stringify({ result: taskId }));
      } else if (req.method === 'GET' && req.url === `/openapi/v1/remesh/${taskId}`) {
        const next = taskScript.length > 1 ? taskScript.shift()! : taskScript[0];
        res.end(JSON.stringify({ id: taskId, progress: 100, ...next }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
  const { getRedisClientAsync } = await import('../lib/redis');
  await getRedisClientAsync();
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  const { shutdownControlsSubscriber } = await import('../services/cost-tracker');
  await shutdownControlsSubscriber?.();
  const { shutdownRedis } = await import('../lib/redis');
  await shutdownRedis?.();
});
beforeEach(() => {
  taskId = `task-${randomUUID().slice(0, 8)}`;
  seen = [];
  taskScript = [
    {
      status: 'SUCCEEDED',
      model_urls: { glb: 'https://assets.meshy.ai/r.glb', obj: 'https://assets.meshy.ai/r.obj' },
      thumbnail_url: 'https://assets.meshy.ai/t.png',
    },
  ];
});

const run = randomUUID().slice(0, 8);
const ALICE = { uid: `alice-${run}`, address: '0x1111111111111111111111111111111111111111' };

async function caller(user = ALICE) {
  const { router } = await import('../lib/trpc');
  const { threedRouter } = await import('../routers/generation/threed.routes');
  return router({ threed: threedRouter }).createCaller({
    user: { ...user, email: 't@example.com' },
    clientIp: '127.0.0.1',
  } as never).threed;
}

async function seedContent(over: Record<string, unknown> = {}) {
  const { db } = await import('../lib/firebase');
  const id = `remesh-src-${randomUUID().slice(0, 8)}`;
  await db!
    .collection('content')
    .doc(id)
    .set({
      mediaType: '3d',
      mediaUrl: 'https://permanent.example/source.glb',
      creatorUid: ALICE.uid,
      title: 'Dragon',
      universeId: 'uni-1',
      generationId: 'gen-src',
      ...over,
    });
  return id;
}

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for condition');
}

describe('threed.remesh (live route)', () => {
  it('remeshes a model you own: calls Meshy, re-hosts, records the result, publishes to the gallery', async () => {
    const t = await caller();
    const contentId = await seedContent();
    const out = await t.remesh({
      contentId,
      topology: 'quad',
      targetPolycount: 12_000,
      targetFormats: ['glb', 'obj'],
    });
    expect(out).toMatchObject({ providerTaskId: taskId });

    // Meshy got exactly the documented request, with the source model URL.
    const post = seen.find((s) => s.method === 'POST')!;
    expect(post.body).toEqual({
      model_url: 'https://permanent.example/source.glb',
      target_formats: ['glb', 'obj'],
      topology: 'quad',
      target_polycount: 12_000,
    });

    const { db } = await import('../lib/firebase');
    const gen = await waitFor(async () => {
      const d = (await db!.collection('threeDGenerations').doc(out.jobId).get()).data();
      return d?.status === 'completed' ? d : undefined;
    });
    expect(gen).toMatchObject({
      type: 'meshy_remesh',
      meshyTaskId: taskId,
      topology: 'quad',
      targetPolycount: 12_000,
      thumbnailUrl: 'https://permanent.example/thumb.png',
    });
    // Stored URLs are the permanent ones, never Meshy's expiring CDN links.
    expect(
      Object.values(gen.modelUrls).every((u) => String(u).startsWith('https://permanent.example/'))
    ).toBe(true);
    expect(gen.modelUrls.glb).toBeTruthy();
    expect(gen.modelUrls.obj).toBeTruthy();

    // Published to the gallery as a NEW item derived from the source.
    const published = await waitFor(async () => {
      const snap = await db!
        .collection('content')
        .where('generationId', '==', `remesh:meshy:${taskId}`)
        .get();
      return snap.empty ? undefined : snap.docs[0].data();
    });
    expect(published).toMatchObject({
      mediaType: '3d',
      creatorUid: ALICE.uid,
      generationModel: 'meshy-remesh',
    });
    expect(String(published.title)).toContain('Dragon — remeshed (quad, 12,000 polys)');
  });

  it('defaults: triangle topology, 30k polys, glb only', async () => {
    const t = await caller();
    await t.remesh({ contentId: await seedContent() });
    const post = seen.find((s) => s.method === 'POST')!;
    expect(post.body).toMatchObject({
      topology: 'triangle',
      target_polycount: 30_000,
      target_formats: ['glb'],
    });
  });

  it('a failed Meshy task marks the generation failed and refunded, and publishes nothing', async () => {
    taskScript = [{ status: 'FAILED', task_error: { message: 'mesh is non-manifold' } }];
    const t = await caller();
    const out = await t.remesh({ contentId: await seedContent() });
    const { db } = await import('../lib/firebase');
    const gen = await waitFor(async () => {
      const d = (await db!.collection('threeDGenerations').doc(out.jobId).get()).data();
      return d?.status === 'failed' ? d : undefined;
    });
    expect(gen.failureReason).toContain('mesh is non-manifold');
    expect(gen.creditsRefunded).toBe(true);
    const pub = await db!
      .collection('content')
      .where('generationId', '==', `remesh:meshy:${taskId}`)
      .get();
    expect(pub.empty).toBe(true);
  });

  it("rejects a missing item, a non-3D item, and someone else's model — without calling Meshy", async () => {
    const t = await caller();
    await expect(t.remesh({ contentId: 'does-not-exist' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      t.remesh({ contentId: await seedContent({ mediaType: 'image' }) })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      t.remesh({ contentId: await seedContent({ creatorUid: 'someone-else' }) })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(seen).toHaveLength(0);
  });

  it('validates input: polycount bounds and only re-hostable formats', async () => {
    const t = await caller();
    const contentId = await seedContent();
    await expect(t.remesh({ contentId, targetPolycount: 50 })).rejects.toThrow();
    await expect(t.remesh({ contentId, targetPolycount: 300_001 })).rejects.toThrow();
    // stl/3mf/blend would be stored as expiring Meshy CDN links — not offered.
    await expect(t.remesh({ contentId, targetFormats: ['stl' as any] })).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('requires a signed-in user', async () => {
    const { router } = await import('../lib/trpc');
    const { threedRouter } = await import('../routers/generation/threed.routes');
    const anon = router({ threed: threedRouter }).createCaller({
      user: null,
      clientIp: '127.0.0.1',
    } as never).threed;
    await expect(anon.remesh({ contentId: 'x' })).rejects.toThrow();
  });
});
