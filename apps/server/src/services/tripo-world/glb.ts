/**
 * Minimal GLB inspection — read the JSON chunk of a binary glTF and list
 * the named meshes/nodes. Used to turn a Tripo segmentation result into a
 * parts list without pulling a 3D library onto the server.
 *
 * GLB layout: 12-byte header (magic 'glTF', version, length), then chunks
 * of [u32 length][u32 type][payload]; the first chunk is JSON (type 0x4E4F534A).
 */

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

export interface GltfJson {
  nodes?: Array<{ name?: string; mesh?: number; children?: number[] }>;
  meshes?: Array<{ name?: string }>;
  animations?: Array<{ name?: string }>;
}

export function readGlbJson(buf: Uint8Array): GltfJson {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Not a GLB file');
  }
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== CHUNK_JSON || 20 + chunkLength > buf.byteLength) {
    throw new Error('GLB has no JSON chunk');
  }
  const json = new TextDecoder().decode(buf.subarray(20, 20 + chunkLength));
  return JSON.parse(json) as GltfJson;
}

/**
 * Names of the mesh-bearing nodes, de-duplicated, in file order. Falls back
 * to mesh names when nodes are unnamed. These are the `part_names` Tripo's
 * convert / complete endpoints accept.
 */
export function listPartNames(gltf: GltfJson): string[] {
  const names: string[] = [];
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const name = node.name?.trim() || gltf.meshes?.[node.mesh]?.name?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Names of the animation clips baked into a GLB. */
export function listAnimationNames(gltf: GltfJson): string[] {
  return (gltf.animations ?? []).map((a, i) => a.name?.trim() || `clip_${i}`);
}

export async function fetchGlbJson(url: string): Promise<GltfJson> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch GLB (${res.status})`);
  return readGlbJson(new Uint8Array(await res.arrayBuffer()));
}
