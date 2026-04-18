/**
 * Re-texture Entities — fix for missing 3D textures
 *
 * The original character pipeline had a bug where `getTextToTextureTask()`
 * didn't call `normalizeTask()`, so textured model URLs were silently lost.
 * This script finds all entities with untextured 3D models and re-runs
 * Meshy image-to-3D + text-to-texture to produce properly textured versions.
 *
 * How it works:
 *   1. Finds all entities that have 3D attachments but no textured GLB
 *   2. Uses each entity's permanent imageUrl to re-run Meshy image-to-3D
 *   3. Applies text-to-texture on the new GLB
 *   4. Attaches textured models to the entity
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/retexture-entities.ts
 *
 * Cost: ~$0.30 per entity (image-to-3D $0.15 + text-to-texture $0.15)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LOAR Re-Texture Pipeline — Fix Missing 3D Textures');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Initialize services ──────────────────────────────────────────
  const firebase = await import('../src/lib/firebase.js');
  if ('initFirebase' in firebase && typeof firebase.initFirebase === 'function') {
    firebase.initFirebase();
  }
  const db = firebase.db;
  if (!db) throw new Error('Firebase not available — check FIREBASE_SERVICE_ACCOUNT_PATH');
  console.log('  Firebase connected');

  const { meshyService } = await import('../src/services/meshy.js');
  if (!meshyService.isConfigured()) throw new Error('MESHY_API_KEY not set');
  console.log('  Meshy ready\n');

  const attachmentsCol = db.collection('mediaAttachments');

  // ── Find all entities that have 3D attachments ───────────────────
  const threeDSnap = await attachmentsCol.where('category', '==', '3d').get();

  if (threeDSnap.empty) {
    console.log('No 3D attachments found. Nothing to re-texture.');
    return;
  }

  // Group by entity
  const byEntity: Record<
    string,
    { attachments: FirebaseFirestore.QueryDocumentSnapshot[]; hasTexturedGlb: boolean }
  > = {};
  for (const doc of threeDSnap.docs) {
    const d = doc.data();
    const eid = d.targetId;
    if (!eid) continue;
    if (!byEntity[eid]) byEntity[eid] = { attachments: [], hasTexturedGlb: false };
    byEntity[eid].attachments.push(doc);
    if (d.mimeType === 'model/gltf-binary' && d.label?.toLowerCase().includes('textured')) {
      byEntity[eid].hasTexturedGlb = true;
    }
  }

  // Filter to entities that need re-texturing
  const needsRetexture = Object.entries(byEntity).filter(([, v]) => !v.hasTexturedGlb);

  if (needsRetexture.length === 0) {
    console.log(
      `Found ${Object.keys(byEntity).length} entities with 3D models — all already have textures.`
    );
    return;
  }

  console.log(
    `Found ${needsRetexture.length} entity/entities needing re-texture (out of ${Object.keys(byEntity).length} with 3D models).\n`
  );

  let succeeded = 0;
  let failed = 0;

  for (const [entityId] of needsRetexture) {
    // ── Get entity ─────────────────────────────────────────────────
    const entityDoc = await db.collection('entities').doc(entityId).get();
    if (!entityDoc.exists) {
      console.log(`  SKIP: Entity ${entityId} no longer exists`);
      failed++;
      continue;
    }

    const entity = entityDoc.data()!;
    const entityName = entity.name || 'Unknown';
    const imageUrl = entity.imageUrl;
    const creator = entity.creator || '';
    const description = entity.description || '';

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${entityName} (${entityId})`);
    console.log(`${'─'.repeat(50)}`);

    if (!imageUrl) {
      console.log(`  SKIP: Entity has no imageUrl`);
      failed++;
      continue;
    }

    try {
      // ── Step 1: Re-run Meshy image-to-3D ──────────────────────────
      console.log(`  Step 1: Converting image to 3D (Meshy image-to-3D)...`);
      const { taskId: meshyTaskId } = await meshyService.imageTo3D({
        imageUrl,
        enablePbr: false,
        aiModel: 'meshy-6',
        topology: 'triangle',
        targetPolycount: 15000,
      });
      console.log(`    Task: ${meshyTaskId} — polling...`);

      const meshyTask = await meshyService.waitForTask(meshyTaskId, 'image-to-3d', 25 * 60 * 1000);
      const glbUrl = meshyTask.modelUrls?.glb;
      if (!glbUrl) throw new Error('Meshy returned no GLB');
      console.log(`    3D model ready`);

      // ── Step 2: Apply textures via text-to-texture ────────────────
      console.log(`  Step 2: Applying textures (Meshy text-to-texture)...`);
      let texturePrompt = `${entityName}, ${description}, realistic style, detailed PBR textures, high quality materials`;
      if (texturePrompt.length > 800) texturePrompt = texturePrompt.slice(0, 797) + '...';

      const { taskId: textureTaskId } = await meshyService.textToTexture({
        modelUrl: glbUrl,
        prompt: texturePrompt,
        artStyle: 'realistic',
        enablePbr: true,
        resolution: 2048,
      });
      console.log(`    Task: ${textureTaskId} — polling...`);

      const textureTask = await meshyService.waitForTextureTask(textureTaskId, 20 * 60 * 1000);
      console.log(`    Textures applied!`);

      // ── Step 3: Attach textured models ────────────────────────────
      const texturedFormats: [string, string | undefined, string][] = [
        ['glb', textureTask.modelUrls?.glb, 'model/gltf-binary'],
        ['fbx', textureTask.modelUrls?.fbx, 'model/fbx'],
        ['obj', textureTask.modelUrls?.obj, 'model/obj'],
        ['usdz', textureTask.modelUrls?.usdz, 'model/usdz'],
      ];

      let attachedCount = 0;
      for (const [format, url, mime] of texturedFormats) {
        if (!url) continue;
        await attachmentsCol.add({
          contentHash: `retexture:${entityId}:textured:${format}`,
          originalFilename: `textured-model.${format}`,
          mimeType: mime,
          size: 0,
          url,
          targetType: 'entity',
          targetId: entityId,
          targetName: entityName,
          category: '3d',
          label: `Textured 3D model — ${format.toUpperCase()}`,
          subCategory: 'game_ready',
          version: 1,
          variantOf: null,
          variantLabel: null,
          generationId: `retexture-${entityId}`,
          sortOrder: 5,
          creator,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        attachedCount++;
      }

      if (textureTask.thumbnailUrl) {
        await attachmentsCol.add({
          contentHash: `retexture:${entityId}:textured:thumbnail`,
          originalFilename: 'thumbnail-textured.png',
          mimeType: 'image/png',
          size: 0,
          url: textureTask.thumbnailUrl,
          targetType: 'entity',
          targetId: entityId,
          targetName: entityName,
          category: 'image',
          label: 'Textured 3D model thumbnail',
          subCategory: 'concept_art',
          version: 1,
          variantOf: null,
          variantLabel: null,
          generationId: `retexture-${entityId}`,
          sortOrder: 11,
          creator,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      console.log(`  DONE: Attached ${attachedCount} textured model format(s)`);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${msg}`);
      failed++;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(50)}`);
  console.log(`  RE-TEXTURE COMPLETE`);
  console.log(`  Succeeded: ${succeeded}  |  Failed: ${failed}`);
  console.log(`${'═'.repeat(50)}`);
}

main().catch((err) => {
  console.error('\nRe-texture pipeline failed:', err.message || err);
  process.exit(1);
});
