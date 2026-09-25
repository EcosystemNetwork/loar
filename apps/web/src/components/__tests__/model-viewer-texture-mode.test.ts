import { describe, expect, it, vi } from 'vitest';

// ModelViewer imports the <model-viewer> custom element, which needs WebGL.
vi.mock('@google/model-viewer', () => ({}));

import { applyTextureMode, type SavedMaterial } from '../ModelViewer';

const texInfo = (texture: unknown) => ({
  texture,
  setTexture(t: unknown) {
    this.texture = t;
  },
});

function fakeViewer() {
  const pbr = {
    baseColorTexture: texInfo('base'),
    metallicRoughnessTexture: texInfo('mr'),
    baseColorFactor: [1, 0.5, 0.25, 1],
    metallicFactor: 0.4,
    roughnessFactor: 0.9,
    setBaseColorFactor(f: number[]) {
      this.baseColorFactor = f;
    },
    setMetallicFactor(v: number) {
      this.metallicFactor = v;
    },
    setRoughnessFactor(v: number) {
      this.roughnessFactor = v;
    },
  };
  const mat = {
    pbrMetallicRoughness: pbr,
    normalTexture: texInfo('normal'),
    emissiveTexture: texInfo(null),
    occlusionTexture: texInfo(null),
  };
  return { el: { model: { materials: [mat] } }, mat, pbr };
}

describe('applyTextureMode', () => {
  it('strips every texture for the geometry view and restores them exactly', () => {
    const { el, mat, pbr } = fakeViewer();
    const saved = new Map<number, SavedMaterial>();

    applyTextureMode(el, false, saved);
    expect(pbr.baseColorTexture.texture).toBeNull();
    expect(pbr.metallicRoughnessTexture.texture).toBeNull();
    expect(mat.normalTexture.texture).toBeNull();
    expect(pbr.baseColorFactor).toEqual([0.85, 0.85, 0.85, 1]);
    expect(pbr.metallicFactor).toBe(0);

    applyTextureMode(el, true, saved);
    expect(pbr.baseColorTexture.texture).toBe('base');
    expect(pbr.metallicRoughnessTexture.texture).toBe('mr');
    expect(mat.normalTexture.texture).toBe('normal');
    expect(pbr.baseColorFactor).toEqual([1, 0.5, 0.25, 1]);
    expect(pbr.metallicFactor).toBe(0.4);
    expect(pbr.roughnessFactor).toBe(0.9);
  });

  it('is a no-op before the model has loaded', () => {
    expect(() => applyTextureMode({ model: undefined }, false, new Map())).not.toThrow();
    expect(() => applyTextureMode(null, false, new Map())).not.toThrow();
  });
});
