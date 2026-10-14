import { describe, it, expect, vi, afterEach } from 'vitest';
import { listAnimationNames, listPartNames, readGlbJson } from '../services/tripo-world/glb';
import { urlExt } from '../services/tripo-world/runner';
import {
  generateBody,
  tripo3dService,
  TripoApiError,
  tripoMultiviewUrls,
  TRIPO_MODEL_GAME,
  TRIPO_MODEL_HIFI,
  TRIPO_TEXTURE_MODEL,
  type TripoTask,
} from '../services/tripo3d';

/** Build a GLB byte buffer around a JSON document (no BIN chunk). */
function makeGlb(json: unknown): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const buf = new Uint8Array(12 + 8 + body.length);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, buf.length, true);
  v.setUint32(12, body.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  buf.set(body, 20);
  return buf;
}

describe('GLB inspection', () => {
  it('reads the JSON chunk and lists mesh-bearing node names', () => {
    const gltf = readGlbJson(
      makeGlb({
        nodes: [
          { name: 'root', children: [1, 2, 3] },
          { name: 'hull', mesh: 0 },
          { mesh: 1 },
          { name: 'hull', mesh: 2 },
        ],
        meshes: [{ name: 'm0' }, { name: 'engine_pod' }, { name: 'm2' }],
        animations: [{ name: 'Walk' }, {}],
      })
    );
    expect(listPartNames(gltf)).toEqual(['hull', 'engine_pod']);
    expect(listAnimationNames(gltf)).toEqual(['Walk', 'clip_1']);
  });

  it('rejects non-GLB bytes', () => {
    expect(() => readGlbJson(new TextEncoder().encode('not a glb at all, sorry'))).toThrow(
      'Not a GLB'
    );
  });
});

describe('urlExt', () => {
  it('reads the path extension and ignores the signed query', () => {
    expect(urlExt('https://tripo-data.rg1.data.tripo3d.ai/x/scene.spz?sig=a.b', 'ply')).toBe('spz');
    expect(urlExt('https://x.test/download', 'glb')).toBe('glb');
    expect(urlExt('not a url', 'glb')).toBe('glb');
  });
});

describe('tripoMultiviewUrls', () => {
  it('prefers top-level view urls and falls back to nested multiview output', () => {
    const task = {
      task_id: 't',
      type: 'x',
      status: 'success',
      output: {
        front_view_url: 'f',
        generate_multiview_image: { front_view_url: 'nf', back_view_url: 'nb' },
      },
    } as TripoTask;
    expect(tripoMultiviewUrls(task)).toEqual({
      front: 'f',
      left: undefined,
      back: 'nb',
      right: undefined,
    });
  });
});

describe('Tripo3D v3 request bodies', () => {
  afterEach(() => vi.unstubAllGlobals());

  function captureFetch() {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({ code: 0, data: { task_id: 'task-1' } }), {
          status: 200,
        });
      })
    );
    return calls;
  }

  it('image-to-model uses H3.1 by default, P1 for game quality, and drops undefined fields', async () => {
    const calls = captureFetch();
    await tripo3dService.imageToModel({ input: 'https://x/a.png', apiKey: 'k' });
    await tripo3dService.imageToModel({ input: 'https://x/a.png', quality: 'game', apiKey: 'k' });
    expect(calls[0].url).toBe('https://openapi.tripo3d.ai/v3/generation/image-to-model');
    expect(calls[0].body.model).toBe(TRIPO_MODEL_HIFI);
    expect(calls[0].body.auto_size).toBe(true);
    expect('face_limit' in calls[0].body).toBe(false);
    expect(calls[1].body.model).toBe(TRIPO_MODEL_GAME);
    // P series rejects the H-series-only knobs.
    expect('smart_low_poly' in calls[1].body).toBe(false);
    expect('geometry_quality' in calls[1].body).toBe(false);
    expect(calls[0].body.texture_version).toBe(TRIPO_TEXTURE_MODEL);
  });

  it('generate_parts turns texture + PBR off (Tripo rejects parts with texture)', () => {
    const body = generateBody({ generateParts: true });
    expect(body).toMatchObject({ generate_parts: true, texture: false, pbr: false });
    expect(body.texture_version).toBeUndefined();
    expect(body.texture_quality).toBeUndefined();
    // P series has no parts — the flag is dropped rather than sent.
    expect(generateBody({ quality: 'game', generateParts: true }).generate_parts).toBeUndefined();
  });

  it('clamps a P1 face limit to its 50–20,000 range', () => {
    expect(generateBody({ quality: 'game', faceLimit: 300_000 }).face_limit).toBe(20_000);
    expect(generateBody({ quality: 'game', faceLimit: 10 }).face_limit).toBe(50);
    expect(generateBody({ faceLimit: 300_000 }).face_limit).toBe(300_000);
  });

  it('retries a transient 503 on submit and 500 on a poll', async () => {
    const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream down', { status: 503 }))
      .mockResolvedValueOnce(ok({ task_id: 'task-ok' }))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(ok({ task_id: 'task-ok', status: 'success', output: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const prev = tripo3dService.rateLimitBackoffMs;
    tripo3dService.rateLimitBackoffMs = 1;
    try {
      const { taskId } = await tripo3dService.imageToModel({
        input: 'https://x/a.png',
        apiKey: 'k',
      });
      const task = await tripo3dService.getTask(taskId, 'k');
      expect(task.status).toBe('success');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      tripo3dService.rateLimitBackoffMs = prev;
    }
  });

  it('does not retry a 500 on submit — the task may already exist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('oops', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      tripo3dService.imageToModel({ input: 'https://x/a.png', apiKey: 'k' })
    ).rejects.toThrow('Tripo3D API error 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains user-fixable errors (out of credits) and keeps the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 2010, message: 'insufficient credit' }), {
          status: 403,
        })
      )
    );
    const err = await tripo3dService
      .imageToModel({ input: 'https://x/a.png', apiKey: 'k' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TripoApiError);
    expect(err.code).toBe(2010);
    expect(err.message).toMatch(/out of credits/);
    expect(err.message).toContain('Tripo3D API error 403');
  });

  it('refuses an `others` rig before calling Tripo', async () => {
    const calls = captureFetch();
    await expect(
      tripo3dService.rigModel({ input: 't', rigType: 'others', apiKey: 'k' })
    ).rejects.toThrow(/no skeleton/);
    expect(calls).toHaveLength(0);
  });

  it('retries a 429 (too many tasks in flight) and submits once a slot frees up', async () => {
    const limited = JSON.stringify({
      code: 2000,
      message: 'You have exceeded the limit of generation',
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(limited, { status: 429 }))
      .mockResolvedValueOnce(new Response(limited, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { task_id: 'task-ok' } }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);
    const prev = tripo3dService.rateLimitBackoffMs;
    tripo3dService.rateLimitBackoffMs = 1;
    try {
      const { taskId } = await tripo3dService.imageToModel({
        input: 'https://x/a.png',
        apiKey: 'k',
      });
      expect(taskId).toBe('task-ok');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      tripo3dService.rateLimitBackoffMs = prev;
    }
  });

  it('uploads token-gated gateway images instead of passing a URL Tripo cannot fetch', async () => {
    vi.stubEnv('PINATA_GATEWAY_URL', 'https://media.loar.test');
    vi.stubEnv('PINATA_GATEWAY_TOKEN', 'gw-secret');
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body });
        if (url.startsWith('https://media.loar.test/')) {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          });
        }
        if (url.endsWith('/files')) {
          return new Response(JSON.stringify({ code: 0, data: { file_token: 'ft-1' } }));
        }
        return new Response(JSON.stringify({ code: 0, data: { task_id: 'task-1' } }));
      })
    );
    try {
      await tripo3dService.imageToModel({
        input: 'https://media.loar.test/ipfs/bafycover/cover.png',
        apiKey: 'k',
      });
      expect(calls[0].url).toBe(
        'https://media.loar.test/ipfs/bafycover/cover.png?pinataGatewayToken=gw-secret'
      );
      expect(calls[1].url).toBe('https://openapi.tripo3d.ai/v3/files');
      const submit = JSON.parse(String(calls[2].body));
      expect(submit.input).toBe('ft-1');
      expect(String(calls[2].body)).not.toContain('gw-secret');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still fails on a non-429 error without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad input', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      tripo3dService.imageToModel({ input: 'https://x/a.png', apiKey: 'k' })
    ).rejects.toThrow('Tripo3D API error 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('multiview-to-model chains from a multiview task id', async () => {
    const calls = captureFetch();
    const { taskId } = await tripo3dService.multiviewToModel({
      multiviewTaskId: 'mv-1',
      apiKey: 'k',
    });
    expect(taskId).toBe('task-1');
    expect(calls[0].body.inputs).toEqual([{ task_id: 'mv-1' }]);
    expect(calls[0].body.original_model_task_id).toBeUndefined();
  });

  it('multiview-to-model sends one view per input object, front required', async () => {
    const calls = captureFetch();
    await tripo3dService.multiviewToModel({
      views: { front: 'https://x/f.png', back: 'https://x/b.png' },
      apiKey: 'k',
    });
    expect(calls[0].body.inputs).toEqual([
      { front: 'https://x/f.png' },
      { back: 'https://x/b.png' },
    ]);
    await expect(
      tripo3dService.multiviewToModel({ views: { front: 'https://x/f.png' }, apiKey: 'k' })
    ).rejects.toThrow(/at least one other view/);
  });

  it('texture sends a style image as an input-source object', async () => {
    const calls = captureFetch();
    await tripo3dService.textureModel({
      input: 'task-9',
      text: 'weathered brass',
      styleImageUrl: 'https://x/style.jpg',
      apiKey: 'k',
    });
    expect(calls[0].url.endsWith('/models/texture')).toBe(true);
    expect(calls[0].body.texture_prompt).toEqual({
      text: 'weathered brass',
      style_image: { url: 'https://x/style.jpg' },
    });
    expect(calls[0].body.model).toBe(TRIPO_TEXTURE_MODEL);
    expect('texture' in calls[0].body).toBe(false);
  });

  it('texture with only a reference image sends it as `image`', async () => {
    const calls = captureFetch();
    await tripo3dService.textureModel({
      input: 'task-9',
      styleImageUrl: 'https://x/ref.png',
      apiKey: 'k',
    });
    expect(calls[0].body.texture_prompt).toEqual({ image: { url: 'https://x/ref.png' } });
  });

  it('only sends an FBX preset for FBX conversions', async () => {
    const calls = captureFetch();
    await tripo3dService.convertModel({
      input: 't',
      format: 'USDZ',
      fbxPreset: 'blender',
      apiKey: 'k',
    });
    await tripo3dService.convertModel({
      input: 't',
      format: 'FBX',
      fbxPreset: 'blender',
      apiKey: 'k',
    });
    expect(calls[0].body.fbx_preset).toBeUndefined();
    expect(calls[1].body.fbx_preset).toBe('blender');
  });

  it('refuses to dispatch without a BYOK key', async () => {
    await expect(tripo3dService.imageToSplat({ input: 'https://x/a.png' })).rejects.toThrow(
      /Tripo3D API key/
    );
  });
});
