import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { countTriangles, optimizeGlb } from '../services/tripo-world/optimize-core';
import { webFilename, webOptimizeUrl } from '../services/tripo-world/optimize';

/** A dense, textured grid — a stand-in for Tripo's 2M-triangle output. */
async function denseGlb(cells: number, textureSize = 1024): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const n = cells + 1;
  const pos = new Float32Array(n * n * 3);
  const nrm = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      // Gentle waves so simplification has real curvature to preserve.
      pos.set([x / cells, Math.sin(x / 7) * Math.cos(y / 9) * 0.05, y / cells], i * 3);
      nrm.set([0, 1, 0], i * 3);
      uv.set([x / cells, y / cells], i * 2);
    }
  }
  const idx = new Uint32Array(cells * cells * 6);
  let k = 0;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const a = y * n + x;
      idx.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k);
      k += 6;
    }
  }
  const png = await sharp({
    // Noise, like real albedo maps (a flat colour PNG is already tiny).
    create: {
      width: textureSize,
      height: textureSize,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 30 },
    },
  })
    .png()
    .toBuffer();
  const texture = doc.createTexture('color').setImage(new Uint8Array(png)).setMimeType('image/png');
  const material = doc.createMaterial('m').setBaseColorTexture(texture);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
    .setMaterial(material);
  const mesh = doc.createMesh('grid').addPrimitive(prim);
  doc.createScene().addChild(doc.createNode('grid').setMesh(mesh));
  return new NodeIO().writeBinary(doc);
}

async function readBack(buf: Uint8Array) {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(buf);
}

describe('optimizeGlb', () => {
  it('simplifies to the triangle budget, compresses, and stays a loadable GLB', async () => {
    const input = await denseGlb(300); // 180k triangles, ~5 MB
    const { buffer, stats } = await optimizeGlb(input, {
      maxTriangles: 20_000,
      maxTextureSize: 512,
    });
    expect(stats.trianglesIn).toBe(180_000);
    expect(stats.trianglesOut).toBeLessThanOrEqual(22_000);
    expect(stats.outputBytes).toBeLessThan(stats.inputBytes / 5);

    const doc = await readBack(buffer);
    expect(
      doc
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName)
    ).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'EXT_texture_webp']));
    expect(countTriangles(doc)).toBe(stats.trianglesOut);
    const tex = doc.getRoot().listTextures()[0];
    expect(tex.getMimeType()).toBe('image/webp');
    expect(Math.max(...(tex.getSize() ?? [0, 0]))).toBeLessThanOrEqual(512);
    // Node names survive (parts kits list them).
    expect(doc.getRoot().listNodes()[0].getName()).toBe('grid');
  }, 60_000);

  it('leaves meshes already under budget unsimplified', async () => {
    const { stats } = await optimizeGlb(await denseGlb(20, 64), { maxTriangles: 10_000 });
    expect(stats.trianglesOut).toBe(stats.trianglesIn);
  });
});

describe('webOptimizeUrl', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubFetch = (res: Response) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res)
    );

  it('uploads a web copy of a heavy model', async () => {
    stubFetch(new Response(Buffer.from(await denseGlb(300))));
    const storeUpload = vi.fn(async (buf: Buffer, name: string) => {
      expect(buf.byteLength).toBeLessThan(3 * 1024 * 1024);
      return `https://media.example/ipfs/${name}`;
    });
    const url = await webOptimizeUrl('https://media.example/ipfs/QmX', 'hero.glb', 'u1', {
      storeUpload,
    });
    expect(url).toBe('https://media.example/ipfs/hero-web.glb');
    expect(storeUpload).toHaveBeenCalledOnce();
  }, 60_000);

  it('returns the original when it is already web-sized', async () => {
    stubFetch(new Response(Buffer.from(await denseGlb(10, 16))));
    const storeUpload = vi.fn();
    const src = 'https://media.example/ipfs/QmSmall';
    expect(await webOptimizeUrl(src, 'small.glb', 'u1', { storeUpload })).toBe(src);
    expect(storeUpload).not.toHaveBeenCalled();
  });

  it('never throws — a failed download means "keep the original" (null)', async () => {
    stubFetch(new Response('nope', { status: 401 }));
    expect(await webOptimizeUrl('https://media.example/ipfs/QmX', 'a.glb', 'u1')).toBeNull();
    expect(await webOptimizeUrl(null, 'a.glb', 'u1')).toBeNull();
  });

  it('names copies after the original', () => {
    expect(webFilename('Captain-Vex.glb')).toBe('Captain-Vex-web.glb');
  });
});
