/**
 * Probe every offChainNode + every episode clip + every videoGeneration
 * permanentVideoUrl, then group by universe to know who has real working
 * content vs. who is entirely dead. Read-only — informs the fix plan.
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

async function probe(rawUrl: string): Promise<boolean> {
  if (!rawUrl) return false;
  if (rawUrl.startsWith('https://dry-run')) return false;
  const url = authedUrl(rawUrl);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const isMedia =
      ct.startsWith('video/') ||
      ct.startsWith('image/') ||
      ct.startsWith('audio/') ||
      ct.startsWith('application/octet-stream') ||
      ct.startsWith('application/vnd.apple.mpegurl');
    if (r.ok && isMedia) {
      try {
        await r.arrayBuffer();
      } catch {}
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function probeAll<T>(
  rows: T[],
  get: (r: T) => string,
  concurrency = 16
): Promise<Map<T, boolean>> {
  const out = new Map<T, boolean>();
  for (let i = 0; i < rows.length; i += concurrency) {
    const slice = rows.slice(i, i + concurrency);
    const r = await Promise.all(slice.map(async (row) => [row, await probe(get(row))] as const));
    r.forEach(([row, alive]) => out.set(row, alive));
    process.stdout.write(`  probed ${Math.min(i + concurrency, rows.length)}/${rows.length}\r`);
  }
  console.log('');
  return out;
}

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const [unisSnap, ocSnap, epSnap, vgSnap] = await Promise.all([
    db.collection('cinematicUniverses').get(),
    db.collection('offChainNodes').get(),
    db.collection('episodes').get(),
    db.collection('videoGenerations').get(),
  ]);

  console.log(`Probing ${ocSnap.size} offChainNodes…`);
  const nodeRows = ocSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      uni: String(data.universeId || '').toLowerCase(),
      url: String(data.videoUrl || ''),
      sceneId: data.sceneId,
      nodeId: data.nodeId,
    };
  });
  const nodeAlive = await probeAll(nodeRows, (r) => r.url);

  console.log(`Probing ${vgSnap.size} videoGeneration permanentVideoUrls…`);
  const vgRows = vgSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      uni: String(data.universeId || '').toLowerCase(),
      url: String(data.permanentVideoUrl || data.videoUrl || ''),
    };
  });
  const vgAlive = await probeAll(vgRows, (r) => r.url);

  console.log(`Probing ${epSnap.size} episodes' clips (first clip only as health proxy)…`);
  const epRows = epSnap.docs.map((d) => {
    const data = d.data() as any;
    const clip0 = (data.clips || [])[0];
    return {
      id: d.id,
      uni: String(data.universeId || '').toLowerCase(),
      isCanon: !!data.isCanon,
      title: String(data.title || '').slice(0, 30),
      clipCount: (data.clips || []).length,
      url: String(clip0?.videoUrl || ''),
    };
  });
  const epClipAlive = await probeAll(epRows, (r) => r.url);

  type Stat = {
    name: string;
    addr: string;
    isHidden: boolean;
    nodes: number;
    nodesAlive: number;
    canonEps: number;
    canonEpsAlive: number;
    canonEpsDryRun: number;
    vgWithPermalive: number;
  };
  const byUni = new Map<string, Stat>();
  for (const d of unisSnap.docs) {
    const u = d.data() as any;
    const addr = (u.address || u.id || d.id).toLowerCase();
    byUni.set(addr, {
      name: u.name || '(unnamed)',
      addr,
      isHidden: !!u.isHidden,
      nodes: 0,
      nodesAlive: 0,
      canonEps: 0,
      canonEpsAlive: 0,
      canonEpsDryRun: 0,
      vgWithPermalive: 0,
    });
  }
  for (const r of nodeRows) {
    const s = byUni.get(r.uni);
    if (!s) continue;
    s.nodes++;
    if (nodeAlive.get(r)) s.nodesAlive++;
  }
  for (const r of vgRows) {
    const s = byUni.get(r.uni);
    if (!s) continue;
    if (vgAlive.get(r)) s.vgWithPermalive++;
  }
  for (const r of epRows) {
    const s = byUni.get(r.uni);
    if (!s) continue;
    if (r.isCanon) {
      s.canonEps++;
      if (r.url.startsWith('https://dry-run')) s.canonEpsDryRun++;
      else if (epClipAlive.get(r)) s.canonEpsAlive++;
    }
  }

  console.log('\n──────────── HEALTH BY UNIVERSE ────────────');
  console.log(
    'name'.padEnd(34) +
      'addr'.padEnd(14) +
      'nodes'.padEnd(12) +
      'canonEps'.padEnd(20) +
      'vg-rehost-alive'
  );
  console.log(
    ''.padEnd(34) + ''.padEnd(14) + 'alive/total'.padEnd(12) + 'alive/dry/total'.padEnd(20) + ''
  );
  const rows = Array.from(byUni.values()).filter((s) => s.nodes + s.canonEps > 0);
  rows.sort((a, b) => b.nodes - a.nodes);
  for (const s of rows) {
    console.log(
      s.name.slice(0, 32).padEnd(34) +
        s.addr.slice(0, 12).padEnd(14) +
        `${s.nodesAlive}/${s.nodes}`.padEnd(12) +
        `${s.canonEpsAlive}/${s.canonEpsDryRun}/${s.canonEps}`.padEnd(20) +
        String(s.vgWithPermalive)
    );
  }

  console.log('\n──────────── ACTION HINTS ────────────');
  for (const s of rows) {
    const hints: string[] = [];
    if (s.canonEpsDryRun > 0) hints.push(`delete ${s.canonEpsDryRun} dry-run episodes`);
    if (s.canonEps - s.canonEpsAlive - s.canonEpsDryRun > 0)
      hints.push(`${s.canonEps - s.canonEpsAlive - s.canonEpsDryRun} canon eps with dead clips`);
    if (s.nodes - s.nodesAlive > 0) hints.push(`cull ${s.nodes - s.nodesAlive} dead nodes`);
    if (s.canonEpsAlive === 0 && s.nodesAlive === 0 && s.vgWithPermalive === 0)
      hints.push('NO WORKING CONTENT — must hide universe');
    else if (s.canonEpsAlive === 0 && s.nodesAlive > 0)
      hints.push(`rebuild canon episode from ${s.nodesAlive} live nodes`);
    if (hints.length) console.log(`  ${s.name}: ${hints.join('; ')}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
