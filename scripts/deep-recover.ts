/**
 * Deep recovery scan: for Fogline/Dostopia content, check every storage
 * location we might still have the bytes in:
 *   - content.mediaUrl (already dead)
 *   - content.storageContentHash → check mediaAttachments / other references
 *   - videoGenerations.videoUrl, .permanentVideoUrl (dead)
 *   - videoGenerations.sourceImageUrl (maybe still alive?)
 *   - mediaAttachments for the content's generationId
 *   - offChainNodes.videoUrl for the universe
 *   - scanning any sibling CIDs with same contentHash
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function headOk(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return res.ok && (ct.startsWith('video/') || ct === 'application/octet-stream');
  } catch {
    return false;
  }
}

async function main() {
  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  console.log('\n=== sampling 3 Fogline video content docs for any recoverable source ===\n');

  const snap = await db
    .collection('content')
    .where('universeId', '==', '0x0000000000000000000000000000019d9e26795c')
    .where('mediaType', '==', 'ai-video')
    .limit(3)
    .get();

  for (const cDoc of snap.docs) {
    const c = cDoc.data() as any;
    const genId = String(c.generationId || '').split(':')[0];
    console.log(`═ content ${cDoc.id} (gen ${genId}) ═`);
    console.log(`  title: ${(c.title || '').slice(0, 50)}`);

    // All fields on the content doc
    const allFields = Object.keys(c).filter(
      (k) => typeof c[k] === 'string' && c[k].startsWith('http')
    );
    for (const f of allFields) {
      const live = await headOk(c[f]);
      console.log(`  content.${f}: ${live ? '✓ LIVE video' : '✗'} ${c[f].slice(0, 70)}`);
    }

    // videoGenerations
    const vg = await db.collection('videoGenerations').doc(genId).get();
    if (vg.exists) {
      const g = vg.data()!;
      for (const k of Object.keys(g)) {
        if (typeof g[k] === 'string' && g[k].startsWith('http')) {
          const live = await headOk(g[k]);
          console.log(`  vg.${k}: ${live ? '✓ LIVE video' : '✗'} ${g[k].slice(0, 70)}`);
        }
      }
    }

    // mediaAttachments keyed by generationId
    const attach = await db.collection('mediaAttachments').where('generationId', '==', genId).get();
    console.log(`  mediaAttachments with this genId: ${attach.size}`);
    for (const a of attach.docs) {
      const ad = a.data() as any;
      if (typeof ad.url === 'string') {
        const live = await headOk(ad.url);
        console.log(`    attach.url: ${live ? '✓ LIVE video' : '✗'} ${ad.url.slice(0, 70)}`);
      }
    }

    // offChainNodes that reference this generation's URL
    if (c.mediaUrl) {
      const ocNodes = await db
        .collection('offChainNodes')
        .where('videoUrl', '==', c.mediaUrl)
        .get();
      console.log(`  offChainNodes with same videoUrl: ${ocNodes.size}`);
    }

    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
