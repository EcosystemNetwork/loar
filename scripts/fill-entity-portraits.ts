/**
 * Generate a portrait image for every entity without `imageUrl`, in the
 * 7 visible universes we just populated with hero clips. Uses fal
 * flux/schnell (cheapest) → uploads to Firebase Storage → patches the
 * entity doc with imageUrl.
 *
 * Cost: ~$0.003 per image. ~150 entities × $0.003 = ~$0.45.
 *
 * Usage:
 *   pnpm tsx scripts/fill-entity-portraits.ts                   # dry run
 *   pnpm tsx scripts/fill-entity-portraits.ts --apply           # write
 *   pnpm tsx scripts/fill-entity-portraits.ts --apply --limit 5 # cap
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';
import * as fal from '@fal-ai/serverless-client';
import { createHash } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : Infinity;
const CONCURRENCY = 5;
const FAL_MODEL = 'fal-ai/flux/schnell';
const BUCKET = 'loar-db.firebasestorage.app';

const TARGET_UNIVERSES = [
  '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa', // Space Fleet
  '0x8e5cddb763534fe426766e4eb035449fb9e73913', // Vacation Bunny
  '0x341ffa19c0ec8d2c8ef42a360cf799949844262e', // Cyber War
  '0x89669812f850f34f907ee9e9009f501d1b008420', // Voidborn Saga
  '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964', // Dragon Egg
  '0x36a903899f51096e8a59d5bee018966c995888c1', // E Combonator
  '0x0000000000000000000000000000019d9ab4ae0f', // Nexus Protocol
];

function buildPortraitPrompt(entity: any, uniName: string, uniStyle: string): string {
  const desc = String(entity.description || '')
    .replace(/\s+/g, ' ')
    .slice(0, 280);
  const kind = entity.kind || 'thing';

  // Frame the prompt by entity kind so the visual makes sense:
  //   - person → portrait
  //   - place → establishing landscape
  //   - thing/vehicle/technology → product / hero shot of object
  //   - faction/organization → emblem or representative scene
  //   - lore/event → symbolic illustration
  let frame: string;
  if (kind === 'person' || kind === 'species') {
    frame = `Character portrait of "${entity.name}" from "${uniName}". ${desc}. Cinematic close-up, expressive face, key lighting.`;
  } else if (
    kind === 'place' ||
    kind === 'realm' ||
    kind === 'plane' ||
    kind === 'dimension' ||
    kind === 'reality' ||
    kind === 'domain' ||
    kind === 'timeline'
  ) {
    frame = `Establishing shot of "${entity.name}" from "${uniName}". ${desc}. Wide angle, atmospheric lighting, no characters in frame.`;
  } else if (kind === 'thing' || kind === 'vehicle' || kind === 'technology') {
    frame = `Hero shot of "${entity.name}" from "${uniName}". ${desc}. Studio lighting, focused on the object, clean composition.`;
  } else {
    frame = `Symbolic illustration representing "${entity.name}" from "${uniName}". ${desc}. Stylized, evocative, single subject.`;
  }
  return `${frame} Style: ${uniStyle.slice(0, 200)}. No text, no watermarks.`;
}

async function generatePortrait(prompt: string): Promise<{ imageUrl: string }> {
  fal.config({ credentials: process.env.FAL_KEY });
  const result = (await fal.subscribe(FAL_MODEL, {
    input: { prompt, image_size: 'square_hd', num_inference_steps: 4 },
    logs: false,
  })) as any;
  const url = result?.images?.[0]?.url || result?.image?.url;
  if (!url) throw new Error(`fal returned no image url: ${JSON.stringify(result).slice(0, 300)}`);
  return { imageUrl: url };
}

async function pinToFirebaseStorage(buffer: Buffer, filename: string): Promise<string> {
  const safeName = filename.replace(/[/\\.\s]+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `images/entities/${Date.now()}-${safeName}`;
  const file = getStorage().bucket(BUCKET).file(key);
  await file.save(buffer, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${BUCKET}/${key}`;
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

  // Pull universes for style cues
  const uniMap = new Map<string, any>();
  for (const addr of TARGET_UNIVERSES) {
    const doc = await db.collection('cinematicUniverses').doc(addr).get();
    if (doc.exists) uniMap.set(addr, doc.data());
  }

  // Pull entities, filter to those without imageUrl
  const targets: Array<{ entity: any; uni: any; addr: string }> = [];
  for (const addr of TARGET_UNIVERSES) {
    const snap = await db.collection('entities').where('universeAddress', '==', addr).get();
    const ents = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }));
    const missing = ents.filter((e) => !e.imageUrl);
    console.log(
      `${uniMap.get(addr)?.name?.padEnd(28) ?? addr.slice(0, 10)}  total=${ents.length}  missing=${missing.length}`
    );
    for (const e of missing) targets.push({ entity: e, uni: uniMap.get(addr), addr });
  }

  const todo = Number.isFinite(LIMIT) ? targets.slice(0, LIMIT) : targets;
  console.log(
    `\nTotal entities needing portraits: ${targets.length}.  Will process: ${todo.length}.`
  );

  if (!APPLY) {
    console.log('\ndry-run — re-run with --apply to start generation.');
    return;
  }

  fal.config({ credentials: process.env.FAL_KEY });

  let ok = 0;
  let fail = 0;
  const queue = [...todo];
  async function worker(workerId: number) {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const idx = todo.length - queue.length;
      const e = item.entity;
      const uniName = item.uni?.name || '(unnamed)';
      const uniStyle = item.uni?.description || '';
      try {
        const prompt = buildPortraitPrompt(e, uniName, uniStyle);
        const { imageUrl } = await generatePortrait(prompt);
        const dl = await fetch(imageUrl);
        if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        const finalUrl = await pinToFirebaseStorage(buf, `${e.kind}-${e.name}.jpg`);
        await e.ref.update({ imageUrl: finalUrl });
        ok++;
        console.log(
          `  [w${workerId}] (${idx}/${todo.length}) ✓ ${uniName.slice(0, 18)}  ${e.kind.padEnd(8)} ${e.name.slice(0, 30)}`
        );
      } catch (err: any) {
        fail++;
        console.log(
          `  [w${workerId}] (${idx}/${todo.length}) ✗ ${e.name.slice(0, 30)}  — ${err.message?.slice(0, 80)}`
        );
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  console.log(`\nfinal: ok=${ok} fail=${fail} of ${todo.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
