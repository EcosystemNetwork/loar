/**
 * Try to recover Fogline/Dostopia content by pulling the original videoUrl
 * from `videoGenerations` (keyed by the same generationId as the content's
 * generationId). If the original URL is still live on the provider's CDN,
 * pin it to Pinata and swap the content doc's mediaUrl.
 *
 * Dry-run first to see how many can be recovered before writing.
 *
 * Usage:
 *   pnpm tsx scripts/recover-fogline.ts              # dry run
 *   pnpm tsx scripts/recover-fogline.ts --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const CONCURRENCY = 4;

// Universes to recover
const TARGET_UNIVERSES = [
  '0x0000000000000000000000000000019d9e26795c', // Fogline
  '0x0000000000000000000000000000016ef3094a9d', // Dostopia (will look up actual addr below)
];

async function headOk(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function pinFromUrl(url: string, filename: string): Promise<string | null> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return null;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || 'video/mp4';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: ct }), filename);
    const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!pinRes.ok) return null;
    const { IpfsHash } = (await pinRes.json()) as { IpfsHash: string };
    const gateway = (process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud').replace(
      /\/$/,
      ''
    );
    return `${gateway}/ipfs/${IpfsHash}`;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  // Discover target universes by name
  const unisSnap = await db
    .collection('cinematicUniverses')
    .where('name', 'in', ['Fallout: Fogline', 'Dostopia: The Iron Faith'])
    .get();
  const targets = unisSnap.docs.map((d) => ({
    id: d.id,
    address: ((d.data() as any).address || d.id).toLowerCase(),
    name: (d.data() as any).name,
  }));
  console.log(`\ntargets:`);
  for (const t of targets) console.log(`  ${t.name}  ${t.address}`);

  const counts = {
    checked: 0,
    noGenRecord: 0,
    providerUrlDead: 0,
    pinFailed: 0,
    recovered: 0,
  };

  const work: Array<{
    contentDoc: FirebaseFirestore.QueryDocumentSnapshot;
    vgDoc: FirebaseFirestore.QueryDocumentSnapshot;
  }> = [];

  for (const uni of targets) {
    console.log(`\n--- scanning ${uni.name} ---`);
    const content = await db.collection('content').where('universeId', '==', uni.address).get();
    console.log(`  ${content.size} content docs`);

    for (const cDoc of content.docs) {
      const c = cDoc.data() as any;
      const isVideo = c.mediaType === 'video' || c.mediaType === 'ai-video';
      if (!isVideo) continue;
      const genId = String(c.generationId || '').split(':')[0];
      if (!genId) continue;

      // Lookup videoGenerations by document id
      const vg = await db.collection('videoGenerations').doc(genId).get();
      if (!vg.exists) {
        counts.noGenRecord++;
        continue;
      }
      work.push({ contentDoc: cDoc, vgDoc: vg });
    }
  }

  console.log(`\n${work.length} content docs matched a videoGenerations record`);

  const queue = [...work];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      counts.checked++;
      const c = item.contentDoc.data() as any;
      const g = item.vgDoc.data() as any;

      // Prefer permanentVideoUrl, else videoUrl
      const sourceUrl: string | undefined = g.permanentVideoUrl || g.videoUrl;
      if (!sourceUrl) {
        counts.providerUrlDead++;
        continue;
      }

      const live = await headOk(sourceUrl);
      if (!live) {
        counts.providerUrlDead++;
        console.log(`  ${item.contentDoc.id.slice(0, 8)}  dead: ${sourceUrl.slice(0, 60)}`);
        continue;
      }

      const pinned = await pinFromUrl(sourceUrl, `recover-${item.contentDoc.id}.mp4`);
      if (!pinned) {
        counts.pinFailed++;
        console.log(
          `  ${item.contentDoc.id.slice(0, 8)}  pin-failed from ${sourceUrl.slice(0, 60)}`
        );
        continue;
      }
      counts.recovered++;
      console.log(
        `  ${item.contentDoc.id.slice(0, 8)}  ${(c.title || '').slice(0, 38)}  RECOVERED → ${pinned.slice(0, 70)}`
      );

      if (APPLY) {
        await item.contentDoc.ref.update({
          mediaUrl: pinned,
          thumbnailUrl: null, // will be regenerated next backfill pass
          contentStatus: 'active',
          contentStatusUpdatedAt: new Date().toISOString(),
          contentStatusUpdatedBy: 'backfill:recover-fogline',
          contentStatusReason: 'mediaUrl repointed to recovered provider URL + re-pinned',
        });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log('\nsummary:', counts);
  console.log('✓ done');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
