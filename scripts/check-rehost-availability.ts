/**
 * Read-only: for every hidden content doc that was hidden by
 * `repair-broken-media-urls`, look up the source generation and check whether
 * a permanent (IPFS) rehost URL exists. Tells us how many hidden items can be
 * resurrected by rewriting mediaUrl + unhiding, vs. how many are genuinely
 * unrecoverable.
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
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(
      readFileSync(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
        'utf-8'
      )
    );
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const [unisSnap, vgSnap, igSnap, cSnap] = await Promise.all([
    db.collection('cinematicUniverses').get(),
    db.collection('videoGenerations').get(),
    db.collection('imageGenerations').get(),
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

  type Bucket = {
    universe: string;
    contentId: string;
    contentMediaType: string;
    generationId?: string;
    hasGen: boolean;
    permanentUrl?: string;
    permanentReachable?: boolean;
  };
  const buckets: Bucket[] = [];

  for (const d of cSnap.docs) {
    const data = d.data() as any;
    const uni = uniName.get(String(data.universeId).toLowerCase()) ?? '?';
    const gid = data.generationId;
    let permanent: string | undefined;
    let hasGen = false;
    if (gid) {
      const vg = vgById.get(gid);
      const ig = igById.get(gid);
      if (vg) {
        hasGen = true;
        permanent =
          vg.permanentVideoUrl ||
          (typeof vg.videoUrl === 'string' && vg.videoUrl.includes('ipfs')
            ? vg.videoUrl
            : undefined);
      } else if (ig) {
        hasGen = true;
        permanent =
          ig.permanentImageUrl ||
          (typeof ig.imageUrl === 'string' && ig.imageUrl.includes('ipfs')
            ? ig.imageUrl
            : undefined);
      }
    }
    buckets.push({
      universe: uni,
      contentId: d.id,
      contentMediaType: data.mediaType ?? '(none)',
      generationId: gid,
      hasGen,
      permanentUrl: permanent,
    });
  }

  // Probe permanent URLs we found
  console.log(`Total hidden-by-repair items: ${buckets.length}`);
  const withPermanent = buckets.filter((b) => b.permanentUrl);
  console.log(`  with linkable generation:   ${buckets.filter((b) => b.hasGen).length}`);
  console.log(`  with permanent URL field:   ${withPermanent.length}`);
  console.log(`Probing permanent URLs (concurrency 16)…`);
  for (let i = 0; i < withPermanent.length; i += 16) {
    const slice = withPermanent.slice(i, i + 16);
    await Promise.all(
      slice.map(async (b) => {
        b.permanentReachable = await probeOk(b.permanentUrl!);
      })
    );
    process.stdout.write(
      `  probed ${Math.min(i + 16, withPermanent.length)}/${withPermanent.length}\r`
    );
  }
  console.log('');

  // Group by universe
  const byUni = new Map<string, Bucket[]>();
  for (const b of buckets) {
    if (!byUni.has(b.universe)) byUni.set(b.universe, []);
    byUni.get(b.universe)!.push(b);
  }
  console.log('\n══════ PER-UNIVERSE RECOVERY POTENTIAL ══════');
  for (const [name, arr] of byUni) {
    const reachable = arr.filter((b) => b.permanentReachable).length;
    const hasPerm = arr.filter((b) => b.permanentUrl).length;
    const hasGen = arr.filter((b) => b.hasGen).length;
    console.log(`${name}`);
    console.log(`  total hidden: ${arr.length}`);
    console.log(`  has gen doc:  ${hasGen}`);
    console.log(`  has permanent URL field: ${hasPerm}`);
    console.log(`  permanent URL reachable: ${reachable} ← recoverable`);
    if (arr.length - reachable > 0) {
      console.log(`  unrecoverable: ${arr.length - reachable}`);
    }
  }

  // Show 5 sample recoverable + 5 sample unrecoverable
  console.log('\n── SAMPLE: recoverable ──');
  buckets
    .filter((b) => b.permanentReachable)
    .slice(0, 5)
    .forEach((b) =>
      console.log(
        `  ${b.universe.slice(0, 22).padEnd(24)} ${b.contentId.slice(0, 18)}  ${b.contentMediaType.padEnd(10)} ${String(
          b.permanentUrl
        ).slice(0, 70)}`
      )
    );
  console.log('\n── SAMPLE: unrecoverable ──');
  buckets
    .filter((b) => !b.permanentReachable)
    .slice(0, 5)
    .forEach((b) =>
      console.log(
        `  ${b.universe.slice(0, 22).padEnd(24)} ${b.contentId.slice(0, 18)}  ${b.contentMediaType.padEnd(10)} hasGen=${b.hasGen}  permURL=${
          b.permanentUrl ? String(b.permanentUrl).slice(0, 50) : '(none)'
        }`
      )
    );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
