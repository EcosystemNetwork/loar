import { describe, it, expect } from 'vitest';
import { rehostModelBundle, isEphemeralUrl } from '../lib/rehost-ephemeral';

describe('isEphemeralUrl — 3D provider CDNs', () => {
  it('flags Meshy and Tripo3D asset URLs as ephemeral', () => {
    expect(isEphemeralUrl('https://assets.meshy.ai/x/tasks/y/output/model.glb?Expires=1')).toBe(
      true
    );
    expect(isEphemeralUrl('https://tripo-data.rg1.data.tripo3d.ai/tcli_x/model.glb?sig=abc')).toBe(
      true
    );
    expect(isEphemeralUrl('https://tripo-data.cdn.bcebos.com/x/model.glb')).toBe(true);
  });

  it('does not flag Tripo/Meshy API endpoints or permanent hosts', () => {
    expect(isEphemeralUrl('https://api.tripo3d.ai/v2/openapi/task/123')).toBe(false);
    expect(isEphemeralUrl('https://openapi.tripo3d.ai/v3/animations/rig')).toBe(false);
    expect(isEphemeralUrl('https://api.meshy.ai/openapi/v1/image-to-3d')).toBe(false);
    expect(isEphemeralUrl('https://gateway.pinata.cloud/ipfs/Qm123')).toBe(false);
  });
});

/**
 * `rehostModelBundle` delegates each URL to `rehostEphemeralUrl`, which
 * returns non-ephemeral URLs untouched without any network/storage call.
 * These cases exercise the bundle-shaping logic (format iteration, null
 * handling, pass-through) — the same code path a rehost failure falls back to.
 */
describe('rehostModelBundle', () => {
  const uid = '0xabc';

  it('passes non-ephemeral URLs through unchanged, preserving every format', async () => {
    const modelUrls = {
      glb: 'https://cdn.example.com/a.glb',
      fbx: 'https://cdn.example.com/a.fbx',
      obj: 'https://cdn.example.com/a.obj',
      usdz: 'https://cdn.example.com/a.usdz',
    };
    const out = await rehostModelBundle(
      {
        modelUrls,
        thumbnailUrl: 'https://cdn.example.com/t.png',
        videoUrl: 'https://cdn.example.com/v.mp4',
      },
      'Some Entity',
      uid
    );
    expect(out.modelUrls).toEqual(modelUrls);
    expect(out.thumbnailUrl).toBe('https://cdn.example.com/t.png');
    expect(out.videoUrl).toBe('https://cdn.example.com/v.mp4');
  });

  it('omits formats that were absent and normalizes null thumbnail/video', async () => {
    const out = await rehostModelBundle(
      { modelUrls: { glb: 'https://cdn.example.com/only.glb' } },
      '',
      uid
    );
    expect(out.modelUrls).toEqual({ glb: 'https://cdn.example.com/only.glb' });
    expect(out.thumbnailUrl).toBeNull();
    expect(out.videoUrl).toBeNull();
  });

  it('tolerates an entirely empty bundle', async () => {
    const out = await rehostModelBundle({}, 'x', uid);
    expect(out).toEqual({ modelUrls: {}, thumbnailUrl: null, videoUrl: null });
  });
});
