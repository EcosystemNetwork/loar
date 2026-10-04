import { describe, it, expect, vi, afterEach } from 'vitest';
import { listAnimationNames, listPartNames, readGlbJson } from '../services/tripo-world/glb';
import { urlExt } from '../services/tripo-world/runner';
import {
  tripo3dService,
  tripoMultiviewUrls,
  TRIPO_MODEL_GAME,
  TRIPO_MODEL_HIFI,
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
    expect(calls[1].body.smart_low_poly).toBe(true);
  });

  it('multiview-to-model chains from a multiview task id', async () => {
    const calls = captureFetch();
    const { taskId } = await tripo3dService.multiviewToModel({
      multiviewTaskId: 'mv-1',
      apiKey: 'k',
    });
    expect(taskId).toBe('task-1');
    expect(calls[0].body.original_model_task_id).toBe('mv-1');
    expect(calls[0].body.inputs).toBeUndefined();
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
      style_image: { type: 'jpeg', url: 'https://x/style.jpg' },
    });
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
