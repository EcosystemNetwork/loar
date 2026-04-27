/**
 * Re-check reachability of currently-hidden content. Read-only.
 *
 * Reports:
 *  - who/what hid each batch (contentStatusUpdatedBy + reason)
 *  - sample HEAD-check across IPFS gateways for each batch
 *  - rolls up: how many would now pass and could be reinstated
 *
 * No mutations. Operator decides whether to reinstate.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const GATEWAY_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';
const CONCURRENCY = 8;

function cidPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const m = parsed.pathname.match(/^\/ipfs\/(.+)$/);
    if (m) return m[1];
    const sub = parsed.host.match(/^([^.]+)\.ipfs\./);
    if (sub) {
      const rest = parsed.pathname.replace(/^\//, '');
      return rest ? `${sub[1]}/${rest}` : sub[1];
    }
  } catch {
    /* noop */
  }
  return null;
}

function candidates(url: string): string[] {
  const cidPath = cidPathFromUrl(url);
  if (!cidPath) return [url];
  const out: string[] = [];
  if (GATEWAY_TOKEN && url.includes('.mypinata.cloud')) {
    const u = new URL(url);
    u.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    out.push(u.toString());
  }
  out.push(`https://gateway.pinata.cloud/ipfs/${cidPath}`);
  out.push(`https://w3s.link/ipfs/${cidPath}`);
  out.push(`https://ipfs.io/ipfs/${cidPath}`);
  return out;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function reachable(url: string): Promise<{ ok: boolean; via: string | null }> {
  for (const c of candidates(url)) {
    if (await headOk(c)) return { ok: true, via: c };
  }
  return { ok: false, via: null };
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

  const uSnap = await db.collection('cinematicUniverses').get();
  const uByAddr = new Map<string, string>();
  for (const d of uSnap.docs) {
    const data = d.data() as any;
    const addr = (data.address || d.id || '').toLowerCase();
    uByAddr.set(addr, data.name || '(unnamed)');
  }

  const cSnap = await db.collection('content').where('contentStatus', '==', 'hidden').get();
  console.log(`hidden content docs: ${cSnap.size}\n`);

  // Group by hider + reason
  const groups = new Map<string, any[]>();
  for (const doc of cSnap.docs) {
    const d = doc.data() as any;
    const key = `${d.contentStatusUpdatedBy || '?'}  |  ${d.contentStatusReason || '?'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: doc.id, ...d });
  }
  for (const [k, items] of groups) {
    console.log(`  ${items.length}× ${k}`);
  }
  console.log();

  // Sample-recheck per universe (8 docs each, parallel)
  const byUni = new Map<string, any[]>();
  for (const doc of cSnap.docs) {
    const d = doc.data() as any;
    const uid = (d.universeId as string | undefined)?.toLowerCase() || '<no-universe>';
    if (!byUni.has(uid)) byUni.set(uid, []);
    byUni.get(uid)!.push({ id: doc.id, ...d });
  }

  console.log('──────────── PER-UNIVERSE SAMPLE RE-CHECK (up to 8 docs each) ────────────');
  for (const [uid, docs] of byUni) {
    const name = uByAddr.get(uid) ?? '(?)';
    const sample = docs.slice(0, 8);

    const queue = [...sample];
    const results: Array<{ id: string; ok: boolean; via: string | null; url: string }> = [];
    async function worker() {
      while (queue.length) {
        const doc = queue.shift()!;
        const r = await reachable(doc.mediaUrl || '');
        results.push({ id: doc.id, ok: r.ok, via: r.via, url: doc.mediaUrl || '' });
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const okCount = results.filter((r) => r.ok).length;
    console.log(
      `\n${name}  ${uid.slice(0, 12)}…  hidden=${docs.length}  sampled=${sample.length}  reachable-now=${okCount}/${sample.length}`
    );
    for (const r of results.slice(0, 3)) {
      console.log(`  ${r.ok ? '✓' : '✗'}  ${r.id}  ${r.via ?? r.url.slice(0, 80)}`);
    }
  }

  // Full pass: reachability per universe extrapolated from sample
  console.log('\n──────────── FULL RE-CHECK (parallel HEAD) ────────────');
  const all = cSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
  const queue = [...all];
  let ok = 0;
  let fail = 0;
  const okPerUni = new Map<string, number>();
  const failPerUni = new Map<string, number>();

  async function fullWorker() {
    while (queue.length) {
      const d = queue.shift();
      if (!d) break;
      const uid = (d.universeId as string | undefined)?.toLowerCase() || '<no-universe>';
      const r = await reachable(d.mediaUrl || '');
      if (r.ok) {
        ok++;
        okPerUni.set(uid, (okPerUni.get(uid) ?? 0) + 1);
      } else {
        fail++;
        failPerUni.set(uid, (failPerUni.get(uid) ?? 0) + 1);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, fullWorker));

  console.log(`\nReachable now: ${ok} / ${cSnap.size}    Still unreachable: ${fail}\n`);
  console.log('Per universe:');
  const allUids = new Set<string>([...okPerUni.keys(), ...failPerUni.keys()]);
  for (const uid of allUids) {
    const name = uByAddr.get(uid) ?? '(?)';
    console.log(
      `  ${name.padEnd(28)} ${uid.slice(0, 12)}…  reachable=${okPerUni.get(uid) ?? 0}  unreachable=${failPerUni.get(uid) ?? 0}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
