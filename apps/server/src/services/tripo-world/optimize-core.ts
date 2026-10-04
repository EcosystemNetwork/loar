/**
 * Web-delivery optimisation for generated GLBs.
 *
 * Tripo's high-detail meshes are ~2M triangles of uncompressed float32
 * (60 MB+) — far past what a browser viewer needs, and slow enough that
 * pages looked broken. This produces a display copy (typically 2-3 MB):
 *
 *   weld → simplify to a triangle budget → prune → textures to ≤2K WebP
 *   → meshopt compression (quantised + EXT_meshopt_compression)
 *
 * Simplification only rewrites indices, so skinned (rigged) meshes and
 * animation clips stay valid. The original GLB is always kept as the
 * source of truth — Tripo derivative tasks, exports and asset packs use it,
 * since DCC tools (Blender) can't import meshopt-compressed files.
 *
 * Pure (bytes in → bytes out); the worker-thread wrapper is optimize.ts.
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

export interface OptimizeGlbOptions {
  /** Triangle budget for the display mesh (whole scene). */
  maxTriangles?: number;
  /** Longest texture edge, px. */
  maxTextureSize?: number;
}

export interface OptimizeGlbStats {
  inputBytes: number;
  outputBytes: number;
  trianglesIn: number;
  trianglesOut: number;
  ms: number;
}

export const WEB_GLB_DEFAULTS = { maxTriangles: 250_000, maxTextureSize: 2048 } as const;

export function countTriangles(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      // Only TRIANGLES (mode 4) contributes; points/lines don't matter here.
      if (prim.getMode() !== 4) continue;
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
      tris += Math.floor(count / 3);
    }
  }
  return tris;
}

export async function optimizeGlb(
  input: Uint8Array,
  options: OptimizeGlbOptions = {}
): Promise<{ buffer: Uint8Array; stats: OptimizeGlbStats }> {
  const started = Date.now();
  const maxTriangles = options.maxTriangles ?? WEB_GLB_DEFAULTS.maxTriangles;
  const maxTextureSize = options.maxTextureSize ?? WEB_GLB_DEFAULTS.maxTextureSize;

  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readBinary(input);
  // gltf-transform logs every pass at info level; keep server logs clean.
  doc.setLogger({ debug() {}, info() {}, warn() {}, error: console.error } as never);

  const trianglesIn = countTriangles(doc);
  const ratio = trianglesIn > maxTriangles ? maxTriangles / trianglesIn : 1;

  // sharp is a native addon — load lazily so the module stays importable
  // where it isn't needed (tests that only exercise geometry).
  const sharp = (await import('sharp')).default;

  await doc.transform(
    dedup(),
    weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 })] : []),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [maxTextureSize, maxTextureSize],
      quality: 85,
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );

  const buffer = await io.writeBinary(doc);
  return {
    buffer,
    stats: {
      inputBytes: input.byteLength,
      outputBytes: buffer.byteLength,
      trianglesIn,
      trianglesOut: countTriangles(doc),
      ms: Date.now() - started,
    },
  };
}
