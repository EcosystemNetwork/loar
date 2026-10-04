/**
 * tripo.* world-building routes — end to end: real router + real Firestore
 * emulator + real Redis (budget holds) + a local HTTP server implementing the
 * Tripo OpenAPI v3 contract (task create / poll / file upload). Gallery
 * publish is stubbed (it auto-tags via an LLM). Not verified against the live
 * Tripo API.
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
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  return port;
});
const HOST = `http://127.0.0.1:${PORT}`;

const NO_KEY_UID = vi.hoisted(() => `nokey-${Math.random().toString(36).slice(2, 8)}`);
vi.mock('../lib/byok', async (orig) => ({
  ...(await orig<typeof import('../lib/byok')>()),
  resolveProviderKey: async (uid: string) => (uid === NO_KEY_UID ? undefined : 'tripo-test-key'),
}));
const published = vi.hoisted(() => [] as any[]);
vi.mock('../lib/gallery-publish', async (orig) => ({
  ...(await orig<typeof import('../lib/gallery-publish')>()),
  publishToGallery: async (input: any) => {
    published.push(input);
    // Like the real one, leave a content doc (pipelines dedupe on it).
    const { db } = await import('../lib/firebase');
    await db!
      .collection('content')
      .add({ generationId: input.generationId, mediaUrl: input.mediaUrl });
  },
}));
// GLB optimisation itself is covered by tripo-optimize.test.ts; here it's a
// deterministic stand-in so the web-copy plumbing is exercised end to end.
vi.mock('../services/tripo-world/optimize', async (orig) => ({
  ...(await orig<typeof import('../services/tripo-world/optimize')>()),
  webOptimizeUrl: async (url: string | null | undefined) =>
    url ? url.replace(/\.glb$/, '-web.glb') : null,
}));
// Universe-manager checks: Alice manages every universe in this suite.
vi.mock('../lib/safe-admin', async (orig) => ({
  ...(await orig<typeof import('../lib/safe-admin')>()),
  isUniverseAdmin: async (_universeId: string, address: string) =>
    address.toLowerCase() === '0x1111111111111111111111111111111111111111',
}));

/** A GLB whose JSON chunk names two mesh parts. */
function partsGlb(): Buffer {
  let text = JSON.stringify({
    nodes: [
      { name: 'hull', mesh: 0 },
      { name: 'wing_left', mesh: 1 },
    ],
    meshes: [{}, {}],
  });
  while (text.length % 4) text += ' ';
  const body = Buffer.from(text);
  const buf = Buffer.alloc(20 + body.length);
  buf.writeUInt32LE(0x46546c67, 0);
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(buf.length, 8);
  buf.writeUInt32LE(body.length, 12);
  buf.writeUInt32LE(0x4e4f534a, 16);
  body.copy(buf, 20);
  return buf;
}

let seen: Array<{ method: string; url: string; body?: any }> = [];
/** task_id → output the fake reports on success. */
const outputs = new Map<string, Record<string, unknown>>();
/** POST path → output factory for the task it creates. */
let failPath: string | null = null;
let server: Server;

function outputFor(path: string, id: string): Record<string, unknown> {
  const f = (name: string) => `${HOST}/out/${id}/${name}`;
  switch (path) {
    case '/v3/generation/image-to-model':
    case '/v3/generation/multiview-to-model':
      return {
        model_url: f('model.glb'),
        rendered_image_url: f('preview.png'),
        rendered_video_url: f('turntable.mp4'),
      };
    case '/v3/generation/image-to-image':
      return { generated_image_url: f('tpose.png') };
    case '/v3/generation/image-to-multiview':
      return {
        front_view_url: f('front.png'),
        left_view_url: f('left.png'),
        back_view_url: f('back.png'),
        right_view_url: f('right.png'),
      };
    case '/v3/animations/rig':
      return { model_url: f('rigged.glb') };
    case '/v3/animations/retarget':
      return { model_urls: [f('idle.glb'), f('walk.glb'), f('run.glb'), f('turn.glb')] };
    case '/v3/mesh/segment':
      return { seg_model_url: f('seg.glb') };
    case '/v3/mesh/complete':
      return { model_url: `${HOST}/parts.glb` };
    case '/v3/generation/image-to-splat':
      return { splat_url: f('scene.spz') };
    case '/v3/models/convert':
      return { model_url: f('model.usdz') };
    default:
      return { model_url: f('model.glb') };
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = { multipart: true };
      }
      seen.push({ method: req.method!, url: req.url!, body });
      if (req.url === '/parts.glb' || req.url?.startsWith('/source')) {
        res.setHeader('content-type', 'model/gltf-binary');
        return res.end(partsGlb());
      }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/v3/files') {
        return res.end(JSON.stringify({ code: 0, data: { file_token: 'ft-1' } }));
      }
      if (req.method === 'POST' && req.url?.startsWith('/v3/')) {
        const id = `t-${randomUUID().slice(0, 8)}`;
        outputs.set(id, req.url === failPath ? { __fail: true } : outputFor(req.url, id));
        return res.end(JSON.stringify({ code: 0, data: { task_id: id } }));
      }
      const m = /^\/v3\/tasks\/(.+)$/.exec(req.url ?? '');
      if (req.method === 'GET' && m && outputs.has(m[1])) {
        const out = outputs.get(m[1])!;
        const data = out.__fail
          ? { task_id: m[1], status: 'failed', error_code: 2008, error_message: 'moderation' }
          : { task_id: m[1], status: 'success', progress: 100, output: out };
        return res.end(JSON.stringify({ code: 0, data }));
      }
      res.statusCode = 404;
      res.end('{}');
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
  failPath = null;
  published.length = 0;
});

const run = randomUUID().slice(0, 8);
const ALICE = { uid: `alice-${run}`, address: '0x1111111111111111111111111111111111111111' };
const BOB = { uid: `bob-${run}`, address: '0x2222222222222222222222222222222222222222' };
const UNIVERSE = `0x${run.padEnd(40, 'a')}`;

async function caller(user: { uid: string; address: string } = ALICE) {
  const { router } = await import('../lib/trpc');
  const { tripoRouter } = await import('../routers/generation/tripo.routes');
  return router({ tripo: tripoRouter }).createCaller({
    user: { ...user, email: 't@example.com' },
    clientIp: '127.0.0.1',
  } as never).tripo;
}

async function seedEntity(over: Record<string, unknown> = {}) {
  const { db } = await import('../lib/firebase');
  const id = `ent-${randomUUID().slice(0, 8)}`;
  await db!
    .collection('entities')
    .doc(id)
    .set({
      name: 'Captain Vex',
      kind: 'person',
      description: '',
      universeAddress: UNIVERSE,
      parentId: null,
      nodeIds: [],
      imageUrl: 'https://img.example/vex.png',
      metadata: {},
      creator: ALICE.address,
      referenceBundle: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
  return id;
}

async function waitJob(jobId: string, ms = 15000) {
  const { db } = await import('../lib/firebase');
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const d = (await db!.collection('threeDGenerations').doc(jobId).get()).data();
    if (d && (d.status === 'completed' || d.status === 'failed')) return d;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('job did not finish');
}

async function entityDoc(id: string) {
  const { db } = await import('../lib/firebase');
  return (await db!.collection('entities').doc(id).get()).data()!;
}

const posts = () => seen.filter((s) => s.method === 'POST').map((s) => s.url);

describe('tripo.entityTo3D', () => {
  it('turns the entity cover into a model on the entity, its media gallery and the universe gallery', async () => {
    const t = await caller();
    const entityId = await seedEntity();
    const { jobId } = await t.entityTo3D({ entityId });
    const job = await waitJob(jobId);
    expect(job.status).toBe('completed');
    expect(job.steps).toEqual([
      expect.objectContaining({ name: 'Generate 3D model', status: 'success', progress: 100 }),
    ]);

    const req = seen.find((s) => s.url === '/v3/generation/image-to-model')!;
    expect(req.body).toMatchObject({
      input: 'https://img.example/vex.png',
      model: 'v3.1-20260211',
      pbr: true,
      auto_size: true,
      render_video: true,
    });

    const e = await entityDoc(entityId);
    expect(e.metadata.modelUrl).toMatch(/\/model\.glb$/);
    expect(e.metadata.model3d).toMatchObject({ quality: 'hifi', provider: 'tripo', jobId });
    // Web-delivery copy alongside the full-detail original.
    expect(e.metadata.model3d.webGlbUrl).toMatch(/\/model-web\.glb$/);

    const { db } = await import('../lib/firebase');
    const atts = await db!.collection('mediaAttachments').where('targetId', '==', entityId).get();
    const cats = atts.docs.map((d) => `${d.data().category}/${d.data().subCategory}`).sort();
    expect(cats).toEqual(['3d/game_ready', '3d/web', 'image/concept_art', 'video/turntable']);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      mediaType: '3d',
      universeId: UNIVERSE,
      title: 'Captain Vex',
      // Gallery viewers get the light copy; edits start from the original.
      mediaUrl: expect.stringMatching(/model-web\.glb$/),
      sourceMediaUrl: expect.stringMatching(/\/model\.glb$/),
    });
  });

  it('refuses callers who do not manage the entity — before touching Tripo', async () => {
    const t = await caller(BOB);
    await expect(t.entityTo3D({ entityId: await seedEntity() })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(seen).toHaveLength(0);
  });

  it('refuses with a BYOK FORBIDDEN when the caller has no Tripo key', async () => {
    const t = await caller({ uid: NO_KEY_UID, address: ALICE.address });
    await expect(t.entityTo3D({ entityId: await seedEntity() })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('Tripo3D API key'),
    });
    expect(seen).toHaveLength(0);
  });

  it('rejects private/loopback source art (SSRF guard)', async () => {
    const t = await caller();
    const entityId = await seedEntity({ imageUrl: 'http://169.254.169.254/latest/meta-data' });
    await expect(t.entityTo3D({ entityId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a failed Tripo task fails the job with the provider reason and writes nothing to the entity', async () => {
    failPath = '/v3/generation/image-to-model';
    const t = await caller();
    const entityId = await seedEntity();
    const job = await waitJob((await t.entityTo3D({ entityId })).jobId);
    expect(job.status).toBe('failed');
    expect(job.failureReason).toContain('moderation');
    expect((await entityDoc(entityId)).metadata).toEqual({});
  });
});

describe('tripo.characterPuppet', () => {
  it('poses, builds a turnaround, body, rig and motion library — and feeds the turnaround to the reference bundle', async () => {
    const t = await caller();
    const entityId = await seedEntity();
    const job = await waitJob((await t.characterPuppet({ entityId })).jobId);
    expect(job.status).toBe('completed');
    expect(job.steps.map((s: any) => s.name)).toEqual([
      'Pose for rigging',
      'Turnaround sheet',
      'Build 3D body',
      'Rig skeleton',
      'Animations',
    ]);
    expect(posts()).toEqual([
      '/v3/generation/image-to-image',
      '/v3/generation/image-to-multiview',
      '/v3/generation/multiview-to-model',
      '/v3/animations/rig',
      '/v3/animations/retarget',
    ]);
    // Each step chains from the previous task — no re-uploads.
    const body = (url: string) => seen.find((s) => s.url === url)!.body;
    expect(body('/v3/generation/image-to-image')).toMatchObject({ template: 't_pose' });
    expect(body('/v3/generation/image-to-multiview').input).toMatch(/tpose\.png$/);
    expect(body('/v3/animations/retarget').animations).toEqual([
      'preset:idle',
      'preset:walk',
      'preset:run',
      'preset:turn',
    ]);

    const e = await entityDoc(entityId);
    expect(Object.keys(e.metadata.puppet.turnaround).sort()).toEqual([
      'back',
      'front',
      'left',
      'right',
    ]);
    expect(e.metadata.puppet.animations.map((a: any) => a.name)).toEqual([
      'idle',
      'walk',
      'run',
      'turn',
    ]);
    expect(e.metadata.puppet.riggedModelUrl).toMatch(/rigged\.glb$/);
    // Turnaround → character reference slots (front, left, right), locks on.
    expect(e.referenceBundle.slots.character).toHaveLength(3);
    expect(e.referenceBundle.slots.character[0]).toMatch(/front\.png$/);
    // The rigged model is published with the id threed.animate decodes.
    expect(published.some((p) => String(p.generationId).startsWith('rig:tripo:'))).toBe(true);
  });

  it('never overwrites reference images a creator picked by hand', async () => {
    const t = await caller();
    const mine = ['https://img.example/a.png', 'https://img.example/b.png'];
    const entityId = await seedEntity({
      referenceBundle: { slots: { character: mine }, locks: {}, identityStrength: 0.9 },
    });
    await waitJob((await t.characterPuppet({ entityId })).jobId);
    const e = await entityDoc(entityId);
    expect(e.referenceBundle.slots.character.slice(0, 2)).toEqual(mine);
    expect(e.referenceBundle.slots.character).toHaveLength(3);
    expect(e.referenceBundle.identityStrength).toBe(0.9);
  });

  it('non-bipeds skip the T-pose and get their own gait', async () => {
    const t = await caller();
    const entityId = await seedEntity({ kind: 'species' });
    await waitJob((await t.characterPuppet({ entityId, rigType: 'quadruped' })).jobId);
    expect(posts()).not.toContain('/v3/generation/image-to-image');
    expect(seen.find((s) => s.url === '/v3/animations/retarget')!.body.animations).toEqual([
      'preset:idle',
      'preset:quadruped:walk',
    ]);
  });
});

describe('tripo.segment / placeEnvironment / convert', () => {
  it('splits an entity model into a named parts kit', async () => {
    const t = await caller();
    const entityId = await seedEntity({
      kind: 'vehicle',
      metadata: { modelUrl: `${HOST}/source.glb` },
    });
    const job = await waitJob((await t.segment({ source: { entityId } })).jobId);
    expect(job.status).toBe('completed');
    expect(job.result.parts).toEqual(['hull', 'wing_left']);
    expect(posts()).toEqual(['/v3/files', '/v3/mesh/segment', '/v3/mesh/complete']);
  });

  it('builds a splat environment for a place and records it on the entity', async () => {
    const t = await caller();
    const entityId = await seedEntity({ kind: 'place', name: 'Rust Harbor' });
    const job = await waitJob((await t.placeEnvironment({ entityId })).jobId);
    expect(job.status).toBe('completed');
    const e = await entityDoc(entityId);
    expect(e.metadata.environment).toMatchObject({ format: 'spz' });
    expect(e.metadata.environment.splatUrl).toMatch(/scene\.spz$/);
  });

  it('refuses environments for non-places', async () => {
    const t = await caller();
    await expect(t.placeEnvironment({ entityId: await seedEntity() })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('USDZ export is remembered on the entity for AR Quick Look', async () => {
    const t = await caller();
    const entityId = await seedEntity({ metadata: { modelUrl: `${HOST}/source.glb` } });
    const job = await waitJob((await t.convert({ source: { entityId }, format: 'USDZ' })).jobId);
    expect(job.result).toMatchObject({ format: 'USDZ', ext: 'usdz' });
    expect((await entityDoc(entityId)).metadata.usdzUrl).toMatch(/model\.usdz$/);
  });
});

describe('tripo.worldOverview / getJob', () => {
  it('lists the universe 3D coverage, and jobs are private to their owner', async () => {
    const t = await caller();
    const entityId = await seedEntity();
    const { jobId } = await t.entityTo3D({ entityId });
    await waitJob(jobId);

    const overview = await t.worldOverview({ universeId: UNIVERSE });
    const row = overview.find((r) => r.id === entityId)!;
    expect(row.modelUrl).toMatch(/\/model\.glb$/);
    expect(row.webModelUrl).toMatch(/model-web\.glb$/);
    expect(row.needsWebCopy).toBe(false);

    expect((await t.getJob({ jobId }))?.status).toBe('completed');
    const bob = await caller(BOB);
    await expect(bob.getJob({ jobId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('durable jobs — resume, retry, batch', () => {
  async function jobRef(jobId: string) {
    const { db } = await import('../lib/firebase');
    return db!.collection('threeDGenerations').doc(jobId);
  }

  it('resumes a job orphaned by a restart by replaying its Tripo task — no re-submit, no duplicates', async () => {
    const t = await caller();
    const entityId = await seedEntity();
    const { jobId } = await t.entityTo3D({ entityId });
    await waitJob(jobId);
    const { db } = await import('../lib/firebase');
    const attsBefore = (
      await db!.collection('mediaAttachments').where('targetId', '==', entityId).get()
    ).size;

    // Simulate the process dying mid-job: still "running", heartbeat long gone.
    const ref = await jobRef(jobId);
    await ref.update({ status: 'running', heartbeatAt: new Date(Date.now() - 60 * 60 * 1000) });
    seen = [];
    published.length = 0;

    const { resumeStaleTripoJobs } = await import('../services/tripo-world/runner');
    const r = await resumeStaleTripoJobs(async () => 'tripo-test-key');
    expect(r.resumed).toBeGreaterThanOrEqual(1);
    const job = await waitJob(jobId);
    expect(job.status).toBe('completed');
    expect(job.resumeCount).toBe(1);
    expect(job.steps[0]).toMatchObject({ reused: true, status: 'success' });
    expect(posts()).not.toContain('/v3/generation/image-to-model');
    expect(published).toHaveLength(0);
    const attsAfter = (
      await db!.collection('mediaAttachments').where('targetId', '==', entityId).get()
    ).size;
    expect(attsAfter).toBe(attsBefore);
  });

  it('fails orphaned jobs that predate resumable args instead of leaving them spinning', async () => {
    const ref = await jobRef(`legacy-${randomUUID().slice(0, 8)}`);
    await ref.set({
      provider: 'tripo',
      kind: 'entity_model',
      status: 'running',
      userId: ALICE.uid,
      steps: [],
      heartbeatAt: new Date(Date.now() - 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const { resumeStaleTripoJobs } = await import('../services/tripo-world/runner');
    await resumeStaleTripoJobs(async () => 'tripo-test-key');
    const d = (await ref.get()).data()!;
    expect(d.status).toBe('failed');
    expect(d.failureReason).toMatch(/run it again/);
  });

  it('leaves jobs with a fresh heartbeat alone', async () => {
    const ref = await jobRef(`fresh-${randomUUID().slice(0, 8)}`);
    await ref.set({
      provider: 'tripo',
      kind: 'entity_model',
      status: 'running',
      userId: ALICE.uid,
      steps: [],
      pipelineArgs: {},
      heartbeatAt: new Date(),
      createdAt: new Date(),
    });
    const { resumeStaleTripoJobs } = await import('../services/tripo-world/runner');
    await resumeStaleTripoJobs(async () => 'tripo-test-key');
    expect((await ref.get()).data()!.status).toBe('running');
    await ref.delete();
  });

  it('retrying a failed puppet re-bills only the failed step onward', async () => {
    const t = await caller();
    const entityId = await seedEntity();
    failPath = '/v3/animations/rig';
    const { jobId } = await t.characterPuppet({ entityId, rigType: 'biped' });
    const failed = await waitJob(jobId);
    expect(failed.status).toBe('failed');
    expect((await t.getJob({ jobId }))?.retryable).toBe(true);

    failPath = null;
    seen = [];
    await t.retryJob({ jobId });
    const job = await waitJob(jobId);
    expect(job.status).toBe('completed');
    expect(job.retryCount).toBe(1);
    // Pose, turnaround and body were replayed; rig + motion were submitted.
    expect(posts()).toEqual(['/v3/animations/rig', '/v3/animations/retarget']);
    const e = await entityDoc(entityId);
    expect(e.metadata.puppet.webRiggedModelUrl).toMatch(/rigged-web\.glb$/);
    expect(e.metadata.puppet.animations[0].webUrl).toMatch(/-web\.glb$/);
  });

  it('refuses to retry a job that has not failed', async () => {
    const t = await caller();
    const { jobId } = await t.entityTo3D({ entityId: await seedEntity() });
    await waitJob(jobId);
    await expect(t.retryJob({ jobId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('batch queues every missing model and environment, skipping entities already in flight', async () => {
    const t = await caller();
    const universe = `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`;
    const a = await seedEntity({ universeAddress: universe, name: 'Prop A', kind: 'thing' });
    const busy = await seedEntity({ universeAddress: universe, name: 'Prop B', kind: 'thing' });
    const place = await seedEntity({ universeAddress: universe, name: 'Dock', kind: 'place' });
    await seedEntity({ universeAddress: universe, name: 'No art', kind: 'thing', imageUrl: null });
    const ref = await jobRef(`busy-${randomUUID().slice(0, 8)}`);
    await ref.set({
      provider: 'tripo',
      kind: 'entity_model',
      status: 'running',
      userId: ALICE.uid,
      entityId: busy,
      steps: [],
      heartbeatAt: new Date(),
      createdAt: new Date(),
    });

    const r = await t.batchEntityTo3D({ universeId: universe, includeEnvironments: true });
    expect(r.jobs.map((j) => [j.entityId, j.kind]).sort()).toEqual(
      [
        [a, 'entity_model'],
        [place, 'place_splat'],
      ].sort()
    );
    // Sequential: concurrent first-time dynamic imports of a mocked module
    // race in Vitest and can hand back the unmocked lib/firebase.
    for (const j of r.jobs) expect((await waitJob(j.jobId)).status).toBe('completed');
    await ref.delete();
  });

  it('batch is universe-manager only', async () => {
    const bob = await caller(BOB);
    await expect(bob.batchEntityTo3D({ universeId: UNIVERSE })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('optimizeWebModels backfills web copies for models made before optimisation', async () => {
    const t = await caller();
    const universe = `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`;
    const id = await seedEntity({
      universeAddress: universe,
      metadata: {
        modelUrl: `${HOST}/old/model.glb`,
        model3d: { glbUrl: `${HOST}/old/model.glb`, provider: 'tripo' },
      },
    });
    expect((await t.worldOverview({ universeId: universe }))[0].needsWebCopy).toBe(true);
    const r = await t.optimizeWebModels({ universeId: universe });
    expect(r.queued).toBe(1);
    const end = Date.now() + 5000;
    while (Date.now() < end && !(await entityDoc(id)).metadata.model3d.webGlbUrl) {
      await new Promise((res) => setTimeout(res, 100));
    }
    expect((await entityDoc(id)).metadata.model3d.webGlbUrl).toBe(`${HOST}/old/model-web.glb`);
    expect((await t.worldOverview({ universeId: universe }))[0].needsWebCopy).toBe(false);
  });
});
