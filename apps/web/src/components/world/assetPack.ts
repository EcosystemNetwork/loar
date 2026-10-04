/**
 * Universe asset pack — zips every 3D asset in a universe (models, rigged
 * puppets + motion clips, turnaround sheets, splat environments) with a
 * manifest, entirely in the browser. Drop the folder into Unity / Unreal /
 * Godot / Blender; `manifest.json` maps files back to wiki entities.
 */
import { zip, type Zippable } from 'fflate';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';
import type { WorldOverviewRow } from './useTripoJob';

export interface PackFile {
  path: string;
  url: string;
}

const safe = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    // No leading dots: a bare `..` must never become a path segment in the zip.
    .replace(/^[.\s]+/, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'asset';

/** Plan the archive layout from the world overview (pure — unit tested). */
export function planAssetPack(rows: WorldOverviewRow[]): {
  files: PackFile[];
  manifest: Record<string, unknown>;
} {
  const files: PackFile[] = [];
  const entities: Array<Record<string, unknown>> = [];
  const used = new Set<string>();
  const unique = (base: string) => {
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    return name;
  };

  for (const row of rows) {
    if (!row.modelUrl && !row.puppet && !row.environment) continue;
    const dir = `${row.kind}/${unique(safe(row.name))}`;
    const entry: Record<string, unknown> = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      files: {},
    };
    const add = (key: string, file: string, url: string | null | undefined) => {
      if (!url) return;
      const path = `${dir}/${file}`;
      files.push({ path, url });
      (entry.files as Record<string, string>)[key] = path;
    };
    add('model', 'model.glb', row.modelUrl);
    add('usdz', 'model.usdz', row.usdzUrl);
    if (row.puppet) {
      add('rigged', 'rigged.glb', row.puppet.riggedModelUrl);
      entry.rigType = row.puppet.rigType;
      for (const clip of row.puppet.animations)
        add(`clip:${clip.name}`, `anim_${safe(clip.name)}.glb`, clip.url);
      for (const [view, url] of Object.entries(row.puppet.turnaround)) {
        add(`turnaround:${view}`, `turnaround_${view}.png`, url);
      }
    }
    if (row.environment) {
      add(
        'environment',
        `environment.${safe(row.environment.format || 'ply')}`,
        row.environment.splatUrl
      );
    }
    entities.push(entry);
  }
  return {
    files,
    manifest: {
      format: 'loar-asset-pack@1',
      generatedAt: new Date().toISOString(),
      units: 'meters (models are auto-sized to real-world scale)',
      entities,
    },
  };
}

export async function buildAssetPack(
  universeName: string,
  rows: WorldOverviewRow[],
  onProgress?: (done: number, total: number) => void
): Promise<{ blob: Blob; filename: string; skipped: string[] }> {
  const { files, manifest } = planAssetPack(rows);
  const tree: Zippable = {};
  const skipped: string[] = [];
  let done = 0;

  // Small concurrency pool — gateways throttle bursts.
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        const res = await fetch(resolveIpfsUrlPreferred(f.url) || f.url);
        if (!res.ok) throw new Error(String(res.status));
        tree[f.path] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
      } catch {
        skipped.push(f.path);
      }
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  tree['manifest.json'] = new TextEncoder().encode(
    JSON.stringify({ ...manifest, skipped }, null, 2)
  );
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(tree, (err, out) => (err ? reject(err) : resolve(out)))
  );
  return {
    // Copy into a plain ArrayBuffer-backed view — BlobPart rejects SharedArrayBuffer-typed views.
    blob: new Blob([new Uint8Array(data)], { type: 'application/zip' }),
    filename: `${safe(universeName)}_asset_pack.zip`,
    skipped,
  };
}
