/**
 * threed.* on Tripo3D — the LIVE routes end to end: real router + real
 * Firestore emulator + real Redis (budget holds) + a local HTTP server that
 * implements the Tripo v3 contract (the same shapes services/tripo3d.ts
 * targets). Only the storage re-host is stubbed. Not verified against the
 * live Tripo API.
 *
 * Covers provider `auto` routing (Tripo when the user has a Tripo key, Meshy
 * otherwise), text/image/multiview → model, humanoid + monster rigging,
 * rig-check auto-detection, and remesh via /models/convert.
 *
 * Prereq: firebase emulators:start --only firestore --project loar-db
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import './_real-firebase';

const PORT = vi.hoisted(() => {
  const port = 40000 + Math.floor(Math.random() * 20000);
  process.env.TRIPO_API_HOST = `http://127.0.0.1:${port}`;
  process.env.MESHY_API_HOST = `http://127.0.0.1:${port}`;
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  return port;
});

// Which BYOK keys the caller has — flipped per test.
const keys = vi.hoisted(() => ({ tripo: true as boolean, meshy: true as boolean }));
vi.mock('../lib/byok', async (orig) => ({
  ...(await orig<typeof import('../lib/byok')>()),
  resolveProviderKey: async (_uid: string, provider: string) =>
    provider === 'tripo'
      ? keys.tripo
        ? 'tripo-test-key'
        : undefined
      : provider === 'meshy' && keys.meshy
        ? 'meshy-test-key'
        : undefined,
}));
vi.mock('../lib/rehost-ephemeral', async (orig) => ({
  ...(await orig<typeof import('../lib/rehost-ephemeral')>()),
  rehostModelBundle: async (input: any, slug: string) => ({
    modelUrls: Object.fromEntries(
      Object.entries(input.modelUrls ?? {})
        .filter(([, v]) => !!v)
        .map(([k]) => [k, `https://permanent.example/${slug}.${k}`])
    ),
    thumbnailUrl: input.thumbnailUrl ? 'https://permanent.example/thumb.png' : null,
    videoUrl: input.videoUrl ? 'https://permanent.example/turntable.mp4' : null,
  }),
}));

let seen: Array<{ method: string; url: string; body?: any }> = [];
/** What rig-check reports for the uploaded mesh. */
let rigCheckVerdict: { riggable: boolean; rig_type?: string } = { riggable: true };
const tasks = new Map<string, string>(); // task id → endpoint that created it
let server: Server;

function taskOutput(endpoint: string, id: string) {
  if (endpoint === '/v3/animations/rig-check') return rigCheckVerdict;
  if (endpoint.startsWith('/v3/generation/')) {
    return {
      model_url: `https://data.tripo3d.ai/${id}.glb`,
      rendered_image_url: `https://data.tripo3d.ai/${id}.png`,
      rendered_video_url: `https://data.tripo3d.ai/${id}.mp4`,
    };
  }
  return { model_url: `https://data.tripo3d.ai/${id}.out` };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = req.url!;
      let body: any;
      try {
        body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      seen.push({ method: req.method!, url, body });
      if (req.method === 'GET' && url === '/source.glb') {
        res.setHeader('content-type', 'model/gltf-binary');
        res.end(Buffer.from('glTF-fake'));
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && url === '/v3/files') {
        res.end(JSON.stringify({ code: 0, data: { file_token: 'file-tok-1' } }));
      } else if (req.method === 'POST' && url.startsWith('/v3/')) {
        const id = `tt-${randomUUID().slice(0, 8)}`;
        tasks.set(id, url);
        res.end(JSON.stringify({ code: 0, data: { task_id: id } }));
      } else if (req.method === 'GET' && url.startsWith('/v3/tasks/')) {
        const id = url.slice('/v3/tasks/'.length);
        const endpoint = tasks.get(id);
        if (!endpoint) {
          res.statusCode = 404;
          res.end(JSON.stringify({ code: 2001, message: 'no task' }));
          return;
        }
        res.end(
          JSON.stringify({
            code: 0,
            data: {
              task_id: id,
              type: endpoint,
              status: 'success',
              output: taskOutput(endpoint, id),
            },
          })
        );
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
  seen = [];
  keys.tripo = true;
  keys.meshy = true;
  rigCheckVerdict = { riggable: true };
});

const run = randomUUID().slice(0, 8);
const ALICE = { uid: `alice-${run}`, address: '0x1111111111111111111111111111111111111111' };

async function caller() {
  const { router } = await import('../lib/trpc');
  const { threedRouter } = await import('../routers/generation/threed.routes');
  return router({ threed: threedRouter }).createCaller({
    user: { ...ALICE, email: 't@example.com' },
    clientIp: '127.0.0.1',
  } as never).threed;
}

async function seedContent(over: Record<string, unknown> = {}) {
  const { db } = await import('../lib/firebase');
  const id = `tripo-src-${randomUUID().slice(0, 8)}`;
  await db!
    .collection('content')
    .doc(id)
    .set({
      mediaType: '3d',
      mediaUrl: `http://127.0.0.1:${PORT}/source.glb`,
      creatorUid: ALICE.uid,
      title: 'Ogre',
      universeId: 'uni-1',
      generationId: 'gen-src',
      ...over,
    });
  return id;
}

async function genDoc(id: string) {
  const { db } = await import('../lib/firebase');
  return (await db!.collection('threeDGenerations').doc(id).get()).data();
}

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for condition');
}

const posts = (path: string) => seen.filter((s) => s.method === 'POST' && s.url === path);

describe('threed generation on Tripo3D', () => {
  it('auto + Tripo key: text-to-3D runs on Tripo, completes with a permanent GLB', async () => {
    const t = await caller();
    const out = await t.textTo3DPreview({ prompt: 'a moss-covered stone golem', quality: 'game' });
    expect(out).toMatchObject({ provider: 'tripo', meshyTaskId: null });

    const [post] = posts('/v3/generation/text-to-model');
    expect(post.body).toMatchObject({
      prompt: 'a moss-covered stone golem',
      model: 'P1-20260311',
      smart_low_poly: true,
      render_video: true,
    });

    const gen = await waitFor(async () => {
      const d = await genDoc(out.generationId);
      return d?.status === 'completed' ? d : undefined;
    });
    expect(gen).toMatchObject({ provider: 'tripo', quality: 'game', type: 'text_preview' });
    expect(gen.tripoTaskId).toMatch(/^tt-/);
    expect(gen.modelUrls.glb).toMatch(/^https:\/\/permanent\.example\//);
    expect(gen.thumbnailUrl).toBe('https://permanent.example/thumb.png');
  });

  it('auto without a Tripo key falls back to Meshy (no Tripo calls)', async () => {
    keys.tripo = false;
    const t = await caller();
    const out = await t.textTo3DPreview({ prompt: 'a lantern' }).catch((e) => e);
    // The fake server does not speak Meshy — what matters is no Tripo traffic.
    expect(seen.some((s) => s.url.startsWith('/v3/'))).toBe(false);
    if (!(out instanceof Error)) expect(out.provider).toBe('meshy');
  });

  it("provider 'tripo' without a key is a FORBIDDEN carrying NoKeyAvailableError", async () => {
    keys.tripo = false;
    const t = await caller();
    const err: any = await t.textTo3DPreview({ prompt: 'x', provider: 'tripo' }).catch((e) => e);
    expect(err?.code).toBe('FORBIDDEN');
    expect(err?.cause?.name).toBe('NoKeyAvailableError');
  });

  it('multiple images run Tripo multiview-to-model as front/left/back/right', async () => {
    const t = await caller();
    await t.imageTo3D({
      imageUrls: [
        'https://img.example/front.png',
        'https://img.example/left.png',
        'https://img.example/back.png',
      ],
    });
    const [post] = posts('/v3/generation/multiview-to-model');
    expect(post.body.inputs[0]).toEqual({
      front: { type: 'png', url: 'https://img.example/front.png' },
      left: { type: 'png', url: 'https://img.example/left.png' },
      back: { type: 'png', url: 'https://img.example/back.png' },
    });
  });

  it('refuses to "refine" a Tripo model', async () => {
    const t = await caller();
    const out = await t.textTo3DPreview({ prompt: 'a chest' });
    await waitFor(async () =>
      (await genDoc(out.generationId))?.status === 'completed' ? true : undefined
    );
    await expect(t.textTo3DRefine({ previewGenerationId: out.generationId })).rejects.toThrow(
      /already full quality/
    );
  });
});

describe('threed.rig on Tripo3D', () => {
  it('humanoids and bipedal monsters rig on Tripo when the user has a Tripo key', async () => {
    const t = await caller();
    const out = await t.rig({ contentId: await seedContent(), rigType: 'biped' });
    expect(out).toMatchObject({ provider: 'tripo', rigType: 'biped' });
    const [rig] = posts('/v3/animations/rig');
    expect(rig.body).toMatchObject({ input: 'file-tok-1', rig_type: 'biped' });

    const { db } = await import('../lib/firebase');
    const published = await waitFor(async () => {
      const snap = await db!
        .collection('content')
        .where('generationId', '==', `rig:tripo:${out.providerTaskId}`)
        .get();
      return snap.empty ? undefined : snap.docs[0].data();
    });
    // The wiki derives the rig type (and so the preset list) from these tags.
    expect(published.tags).toEqual(expect.arrayContaining(['rigged', 'biped']));
  });

  it("rigType 'auto' asks rig-check and rigs with the skeleton it reports", async () => {
    rigCheckVerdict = { riggable: true, rig_type: 'octopod' };
    const t = await caller();
    const out = await t.rig({ contentId: await seedContent(), rigType: 'auto' });
    expect(out).toMatchObject({ provider: 'tripo', rigType: 'octopod' });
    expect(posts('/v3/animations/rig-check')[0].body).toEqual({ input: 'file-tok-1' });
    expect(posts('/v3/animations/rig')[0].body).toMatchObject({ rig_type: 'octopod' });
    expect(await genDoc(out.jobId)).toMatchObject({ rigType: 'octopod', rigTypeDetected: true });
  });

  it("rigType 'auto' on an unriggable mesh fails before any rig task is submitted", async () => {
    rigCheckVerdict = { riggable: false };
    const t = await caller();
    await expect(t.rig({ contentId: await seedContent(), rigType: 'auto' })).rejects.toThrow(
      /cannot be rigged/
    );
    expect(posts('/v3/animations/rig')).toHaveLength(0);
  });

  it("Meshy can't rig a quadruped", async () => {
    const t = await caller();
    await expect(
      t.rig({ contentId: await seedContent(), rigType: 'quadruped', provider: 'meshy' })
    ).rejects.toThrow(/Meshy only rigs humanoids/);
  });
});

describe('threed.remesh on Tripo3D', () => {
  it('runs one /models/convert per format with quad + face limit, then publishes', async () => {
    const t = await caller();
    const out = await t.remesh({
      contentId: await seedContent(),
      topology: 'quad',
      targetPolycount: 12_000,
      targetFormats: ['glb', 'fbx'],
    });
    const gen = await waitFor(async () => {
      const d = await genDoc(out.jobId);
      return d?.status === 'completed' ? d : undefined;
    });
    const converts = posts('/v3/models/convert');
    expect(converts.map((c) => c.body.format)).toEqual(['GLTF', 'FBX']);
    expect(converts[0].body).toMatchObject({ input: 'file-tok-1', quad: true, face_limit: 12_000 });
    expect(gen).toMatchObject({ type: 'tripo_remesh', provider: 'tripo' });
    expect(Object.keys(gen.modelUrls).sort()).toEqual(['fbx', 'glb']);
  });
});
