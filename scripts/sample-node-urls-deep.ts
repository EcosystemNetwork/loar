/**
 * Deep probe — for each unique URL host, try authenticated/full GET without
 * Range so we can tell apart "gated, but content is real" from "expired/dead".
 * Inspects content-type and response body length on a small sample per host.
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

async function deepProbe(rawUrl: string) {
  const url = authedUrl(rawUrl);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    const cl = r.headers.get('content-length') || '';
    const body = await r.arrayBuffer();
    return { status: r.status, contentType: ct, contentLength: cl, byteLen: body.byteLength };
  } catch (e: any) {
    return { status: `err:${e?.code || e?.message}`.slice(0, 40) };
  }
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

  const ocSnap = await db.collection('offChainNodes').get();
  // Bucket by host so we sample 3 from each
  const byHost = new Map<string, { docId: string; nodeId: any; url: string }[]>();
  for (const d of ocSnap.docs) {
    const data = d.data() as any;
    const url = String(data.videoUrl || '');
    if (!url) continue;
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return '—';
      }
    })();
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host)!.push({ docId: d.id, nodeId: data.nodeId, url });
  }

  for (const [host, rows] of byHost.entries()) {
    console.log(`\n=== ${host}  (${rows.length} nodes total) ===`);
    const sample = rows.slice(0, 3);
    for (const s of sample) {
      const r = await deepProbe(s.url);
      console.log(
        `  node=${s.nodeId}  status=${r.status}  ct=${(r as any).contentType ?? '—'}  ` +
          `cl=${(r as any).contentLength ?? '—'}  bytes=${(r as any).byteLen ?? '—'}`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
