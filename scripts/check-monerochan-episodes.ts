/**
 * Diagnostic: inspect Monerochan episode docs + their clips. Read-only.
 *
 *   pnpm tsx scripts/check-monerochan-episodes.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e1c8a49';

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'mc-check-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  // Build url → tag map from content docs so we can classify each clip.
  const urlToTags = new Map<string, string[]>();
  const urlToScene = new Map<string, string>();
  for (const tag of ['episode-1', 'episode-1-animated']) {
    const snap = await db
      .collection('content')
      .where('universeId', '==', UNIVERSE_ID)
      .where('tags', 'array-contains', tag)
      .get();
    for (const d of snap.docs) {
      const x = d.data() as any;
      const url = (x.mediaUrl as string) ?? (x.videoUrl as string);
      if (!url) continue;
      const tags = (x.tags as string[]) ?? [];
      urlToTags.set(url, tags);
      const sceneTag = tags.find((t) => /^s\d+$/i.test(t));
      if (sceneTag) urlToScene.set(url, sceneTag.toUpperCase());
    }
  }

  const eps = await db.collection('episodes').where('universeId', '==', UNIVERSE_ID).get();
  console.log(`\n${eps.size} episode doc(s) for ${UNIVERSE_ID}\n`);

  for (const d of eps.docs) {
    const x = d.data() as any;
    const clips: any[] = Array.isArray(x.clips) ? x.clips : [];
    const created = x.createdAt?.toDate?.() ?? x.createdAt;
    console.log(`━━ ${d.id}`);
    console.log(`    title:     "${x.title ?? ''}"`);
    console.log(`    createdAt: ${created}`);
    console.log(`    clips:     ${clips.length}`);
    console.log(`    creator:   ${x.creatorAddress ?? x.creatorUid ?? ''}`);

    const styleCounts: Record<string, number> = { photoreal: 0, animated: 0, unknown: 0 };
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const url = c.videoUrl ?? c.mediaUrl ?? '';
      const tags = urlToTags.get(url) ?? [];
      const scene = urlToScene.get(url) ?? '?';
      let style = 'unknown';
      if (tags.includes('episode-1-animated')) style = 'animated';
      else if (tags.includes('episode-1')) style = 'photoreal';
      styleCounts[style]++;
      const shortUrl = url ? url.slice(-40) : '(no url)';
      console.log(
        `      [${String(i + 1).padStart(2)}] ${scene.padEnd(4)} ${style.padEnd(9)} ${shortUrl}  ${c.label ?? c.title ?? ''}`
      );
    }
    console.log(
      `    styles:    photoreal=${styleCounts.photoreal} animated=${styleCounts.animated} unknown=${styleCounts.unknown}\n`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('CHECK FAILED:', err);
  process.exit(1);
});
