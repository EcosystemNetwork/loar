/**
 * "Keep hatching different types of eggs" — runs Meshy image-to-3D for every
 * `thing` entity in the Dragon Egg universe that doesn't yet have a model.
 * Skips entities Meshy has already failed on twice (the Singing Egg of
 * Lúnavael — its image causes Meshy to stall around 49-51% repeatedly).
 *
 * Cost: ~$0.20 per generation. ~9 eligible eggs ≈ $1.80.
 *
 * Usage:
 *   pnpm tsx scripts/hatch-dragon-eggs.ts                    # dry run
 *   pnpm tsx scripts/hatch-dragon-eggs.ts --apply            # write
 *   pnpm tsx scripts/hatch-dragon-eggs.ts --apply --max 5    # cap
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const maxIdx = process.argv.indexOf('--max');
const MAX = maxIdx !== -1 ? Number(process.argv[maxIdx + 1]) : Infinity;
const BUCKET = 'loar-db.firebasestorage.app';
const DRAGON_EGG_ADDR = '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964';
const MESHY_KEY = process.env.MESHY_API_KEY || '';
const POLL_MS = 8000;
const MAX_POLLS = 75; // 10 min cap; if it stalls past this, skip

// Entities that have repeatedly failed/timed out — don't keep paying for them.
const SKIP_NAMES = new Set(['The Singing Egg of Lúnavael']);

async function meshy<T>(method: string, url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`meshy ${method} ${url}: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function pinGlb(buffer: Buffer, filename: string): Promise<string> {
  const safeName = filename.replace(/[/\\.\s]+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `models3d/${Date.now()}-${safeName}`;
  const file = getStorage().bucket(BUCKET).file(key);
  await file.save(buffer, {
    contentType: 'model/gltf-binary',
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

  const uDoc = await db.collection('cinematicUniverses').doc(DRAGON_EGG_ADDR).get();
  const u = uDoc.data() as any;

  const entSnap = await db
    .collection('entities')
    .where('universeAddress', '==', DRAGON_EGG_ADDR)
    .get();
  const eligible = entSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }))
    .filter(
      (e) =>
        ['thing', 'vehicle', 'technology'].includes(e.kind) &&
        !e.model3dUrl &&
        e.imageUrl &&
        !SKIP_NAMES.has(e.name)
    );

  console.log(`${u.name}: ${eligible.length} eligible thing-like entities without 3D yet`);
  for (const e of eligible) console.log(`  - ${e.kind.padEnd(8)} ${e.name}`);
  console.log('');

  const todo = Number.isFinite(MAX) ? eligible.slice(0, MAX) : eligible;
  if (!APPLY) {
    console.log(`dry-run (would process ${todo.length}). Re-run with --apply.`);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const target of todo) {
    console.log(`▶ ${target.name}`);
    try {
      const submit = await meshy<{ result: string }>(
        'POST',
        'https://api.meshy.ai/openapi/v1/image-to-3d',
        {
          image_url: target.imageUrl,
          ai_model: 'meshy-6',
          topology: 'quad',
          target_polycount: 30000,
          should_remesh: true,
        }
      );
      const taskId = submit.result;

      let finalUrl: string | null = null;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const task = await meshy<any>(
          'GET',
          `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`
        );
        if (task.status === 'SUCCEEDED') {
          finalUrl = task.model_urls?.glb || task.model_url;
          break;
        }
        if (task.status === 'FAILED') {
          throw new Error(`meshy FAILED: ${task.task_error?.message ?? 'unknown'}`);
        }
        if (i % 4 === 0) console.log(`    progress=${task.progress ?? '?'}`);
      }
      if (!finalUrl) throw new Error('meshy timed out');

      const dl = await fetch(finalUrl);
      if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      const ourUrl = await pinGlb(buf, `${target.kind}-${target.name}.glb`);
      await target.ref.update({ model3dUrl: ourUrl });

      await db.collection('threeDGenerations').add({
        universeId: DRAGON_EGG_ADDR,
        entityId: target.id,
        entityName: target.name,
        sourceImageUrl: target.imageUrl,
        modelUrl: ourUrl,
        provider: 'meshy',
        meshyTaskId: taskId,
        creator: u.creator || null,
        createdAt: new Date(),
      });

      console.log(`  ✓ ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
      ok++;
    } catch (err: any) {
      console.log(`  ✗ ${err.message?.slice(0, 200)}`);
      fail++;
    }
  }

  console.log(`\nfinal: ok=${ok} fail=${fail} of ${todo.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
