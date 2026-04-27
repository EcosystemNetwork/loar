/**
 * Generate 3D models via Meshy image-to-3D for the hero "thing"/"vehicle"/
 * "technology" entity in each of the 7 visible universes (the same entity
 * featured as the focal subject in the universe's hero clip). Saves the
 * resulting GLB to Firebase Storage and writes `model3dUrl` on the entity.
 *
 * Cost: roughly $0.20 per generation. Cap: 1 entity per universe = 7.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const BUCKET = 'loar-db.firebasestorage.app';
const TARGET_UNIVERSES = [
  '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa',
  '0x8e5cddb763534fe426766e4eb035449fb9e73913',
  '0x341ffa19c0ec8d2c8ef42a360cf799949844262e',
  '0x89669812f850f34f907ee9e9009f501d1b008420',
  '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964',
  '0x36a903899f51096e8a59d5bee018966c995888c1',
  '0x0000000000000000000000000000019d9ab4ae0f',
];
const MESHY_KEY = process.env.MESHY_API_KEY || '';
const POLL_MS = 8000;
const MAX_POLLS = 120; // 16 min cap (Singing Egg stalled around 49% on first try)

async function meshy<T>(method: string, url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${MESHY_KEY}`,
      'Content-Type': 'application/json',
    },
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

  console.log('──────────── MESHY 3D HERO MODELS ────────────');

  for (const addr of TARGET_UNIVERSES) {
    const uDoc = await db.collection('cinematicUniverses').doc(addr).get();
    if (!uDoc.exists) continue;
    const u = uDoc.data() as any;

    // Pick the hero "thing"/"vehicle"/"technology" entity by description length
    // (consistent with regen-hero-clip.ts's subject picker)
    const entSnap = await db.collection('entities').where('universeAddress', '==', addr).get();
    const ents = entSnap.docs
      .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }))
      .filter(
        (e) => ['thing', 'vehicle', 'technology'].includes(e.kind) && !e.model3dUrl && e.imageUrl
      )
      .sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));

    const target = ents[0];
    if (!target) {
      console.log(`▶ ${u.name}  — no eligible thing/vehicle/tech entity (or all already have 3D).`);
      continue;
    }

    console.log(`▶ ${u.name}  →  ${target.kind} "${target.name}"`);
    if (!APPLY) {
      console.log(`  imageUrl: ${target.imageUrl?.slice(0, 80)}…`);
      continue;
    }

    try {
      // 1. Submit image-to-3D
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
      console.log(`  meshy task ${taskId} submitted, polling…`);

      // 2. Poll
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
        if (i % 4 === 0) console.log(`    status=${task.status}  progress=${task.progress ?? '?'}`);
      }
      if (!finalUrl) throw new Error('meshy timed out');

      // 3. Download + repin to Firebase Storage
      const dl = await fetch(finalUrl);
      if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      const ourUrl = await pinGlb(buf, `${target.kind}-${target.name}.glb`);
      await target.ref.update({ model3dUrl: ourUrl });

      // Also write to threeDGenerations for the gallery + lineage
      await db.collection('threeDGenerations').add({
        universeId: addr,
        entityId: target.id,
        entityName: target.name,
        sourceImageUrl: target.imageUrl,
        modelUrl: ourUrl,
        provider: 'meshy',
        meshyTaskId: taskId,
        creator: u.creator || null,
        createdAt: new Date(),
      });

      console.log(`  ✓ ${(buf.length / 1024 / 1024).toFixed(2)} MB  ${ourUrl.slice(0, 70)}…`);
    } catch (e: any) {
      console.log(`  ✗ ${e.message?.slice(0, 200)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
