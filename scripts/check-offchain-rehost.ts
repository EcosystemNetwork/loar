/**
 * Read-only: For each hidden content doc whose source generation has a
 * sceneId, look for an offChainNode in the same universe at that scene whose
 * videoUrl is reachable. If found, that's a recoverable URL.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const PINATA_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';
function authedUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (
      /\.mypinata\.cloud$/i.test(u.host) &&
      PINATA_TOKEN &&
      !u.searchParams.has('pinataGatewayToken')
    ) {
      u.searchParams.set('pinataGatewayToken', PINATA_TOKEN);
      return u.toString();
    }
  } catch {}
  return raw;
}
async function probeOk(rawUrl: string): Promise<boolean> {
  if (!rawUrl) return false;
  try {
    const r = await fetch(authedUrl(rawUrl), { method: 'HEAD', redirect: 'follow' });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  const sa = JSON.parse(
    readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
      'utf-8'
    )
  );
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  if (!getApps()[0]) db.settings({ preferRest: true });

  const [unisSnap, vgSnap, igSnap, ocSnap, cSnap] = await Promise.all([
    db.collection('cinematicUniverses').get(),
    db.collection('videoGenerations').get(),
    db.collection('imageGenerations').get(),
    db.collection('offChainNodes').get(),
    db
      .collection('content')
      .where('contentStatusUpdatedBy', '==', 'repair-broken-media-urls')
      .get(),
  ]);

  const uniName = new Map<string, string>();
  for (const d of unisSnap.docs) {
    const data = d.data() as any;
    const addr = (data.address || data.id || d.id || '').toLowerCase();
    uniName.set(addr, data.name || '(unnamed)');
  }
  const vgById = new Map<string, any>();
  vgSnap.docs.forEach((d) => vgById.set(d.id, { id: d.id, ...(d.data() as any) }));
  const igById = new Map<string, any>();
  igSnap.docs.forEach((d) => igById.set(d.id, { id: d.id, ...(d.data() as any) }));

  // Index offChainNodes by (universeId|sceneId) AND (universeId|nodeId)
  const ocBySceneKey = new Map<string, any[]>();
  const ocByNodeKey = new Map<string, any[]>();
  for (const d of ocSnap.docs) {
    const data = d.data() as any;
    const uni = String(data.universeId || '').toLowerCase();
    if (!uni) continue;
    if (data.sceneId != null) {
      const k = `${uni}|${data.sceneId}`;
      if (!ocBySceneKey.has(k)) ocBySceneKey.set(k, []);
      ocBySceneKey.get(k)!.push(data);
    }
    if (data.nodeId != null) {
      const k = `${uni}|${String(data.nodeId)}`;
      if (!ocByNodeKey.has(k)) ocByNodeKey.set(k, []);
      ocByNodeKey.get(k)!.push(data);
    }
  }

  // Probe ALL distinct offChainNode URLs upfront (cheaper than per-content)
  const allUrls = new Set<string>();
  for (const d of ocSnap.docs) {
    const u = (d.data() as any).videoUrl;
    if (typeof u === 'string') allUrls.add(u);
  }
  console.log(`Probing ${allUrls.size} distinct offChainNode URLs…`);
  const urlOk = new Map<string, boolean>();
  const urls = [...allUrls];
  for (let i = 0; i < urls.length; i += 16) {
    const slice = urls.slice(i, i + 16);
    await Promise.all(
      slice.map(async (u) => {
        urlOk.set(u, await probeOk(u));
      })
    );
    process.stdout.write(`  probed ${Math.min(i + 16, urls.length)}/${urls.length}\r`);
  }
  console.log('');
  const liveCount = [...urlOk.values()].filter(Boolean).length;
  console.log(`  ${liveCount}/${urls.length} offChainNode URLs are reachable\n`);

  // Now match each hidden content to an offChainNode rescue URL
  type Row = {
    universe: string;
    contentId: string;
    mediaType: string;
    generationId: string;
    rescueUrl?: string;
    rescueOk?: boolean;
  };
  const rows: Row[] = [];
  for (const d of cSnap.docs) {
    const data = d.data() as any;
    const uni = uniName.get(String(data.universeId).toLowerCase()) ?? '?';
    const gid = data.generationId;
    const gen = gid ? (vgById.get(gid) ?? igById.get(gid)) : null;
    let rescue: string | undefined;
    let rescueOk = false;
    if (gen) {
      const sceneKey = `${String(data.universeId).toLowerCase()}|${gen.sceneId}`;
      const nodeKey = `${String(data.universeId).toLowerCase()}|${String(gen.nodeId ?? gen.sceneId)}`;
      const candidates = [
        ...(ocBySceneKey.get(sceneKey) ?? []),
        ...(ocByNodeKey.get(nodeKey) ?? []),
      ];
      for (const oc of candidates) {
        if (typeof oc.videoUrl === 'string' && urlOk.get(oc.videoUrl)) {
          rescue = oc.videoUrl;
          rescueOk = true;
          break;
        }
      }
      // Fallback: if no scene match, scan ALL offChainNodes for the universe
      // for any with a working URL... but this is meaningless without a key
      // tying it to the same scene. Skip.
    }
    rows.push({
      universe: uni,
      contentId: d.id,
      mediaType: data.mediaType,
      generationId: gid,
      rescueUrl: rescue,
      rescueOk,
    });
  }

  // Per-universe summary
  const byUni = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byUni.has(r.universe)) byUni.set(r.universe, []);
    byUni.get(r.universe)!.push(r);
  }
  console.log('══════ OFFCHAIN-NODE RESCUE POTENTIAL ══════');
  for (const [name, arr] of byUni) {
    const recoverable = arr.filter((r) => r.rescueOk).length;
    console.log(
      `${name.padEnd(28)} hidden=${arr.length}  rescueable-from-offChainNode=${recoverable}`
    );
  }

  console.log('\n── SAMPLE rescuable ──');
  rows
    .filter((r) => r.rescueOk)
    .slice(0, 10)
    .forEach((r) =>
      console.log(
        `  ${r.universe.slice(0, 22).padEnd(24)} ${r.contentId.slice(0, 18)} ${r.mediaType.padEnd(
          10
        )}  ${String(r.rescueUrl).slice(0, 90)}`
      )
    );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
