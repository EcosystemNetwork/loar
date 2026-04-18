/**
 * Run Character Pipeline — end-to-end character creation
 *
 * Usage:
 *   pnpm -F server tsx scripts/run-character-pipeline.ts
 *
 * Steps:
 *   1. Create entity in Firestore
 *   2. Generate 2D character portrait via Google Imagen 3
 *   3. Convert to 3D model via Meshy image-to-3D
 *   4. Apply textures via Meshy text-to-texture
 *   5. Attach all assets to entity in Firestore
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ── Character Definitions (5 diverse characters) ─────────────────────

const CHARACTERS = [
  {
    name: 'Kael Duskbane',
    description:
      'A battle-hardened shadow knight with obsidian armor etched in glowing crimson runes. His left eye is a cybernetic implant that glows pale blue. A tattered dark cloak flows behind him, and he wields a serrated greatsword wreathed in dark flame. Tall, muscular build with ashen grey skin and short white hair.',
    kind: 'person' as const,
    style: 'fantasy' as const,
    artStyle: 'realistic' as const,
    metadata: {
      role: 'Shadow Knight — elite warrior of the Void Legion',
      appearance:
        'Obsidian armor with crimson runes, cybernetic blue left eye, ashen grey skin, short white hair, tattered dark cloak',
      motivations: 'Seeks redemption for a betrayal that destroyed his homeland',
      abilities:
        'Shadow step (short-range teleport), Void Strike (dark flame sword technique), Cybernetic eye grants thermal and magical vision',
      homePlace: 'The Shattered Citadel — ruins of his former kingdom',
      affiliations: 'Former Void Legion commander, now a lone wanderer',
    },
  },
  {
    name: 'Lyra Sunweaver',
    description:
      'An elven sorceress with flowing golden hair that shimmers with magical energy. She wears an elegant white and gold robe adorned with celestial patterns. Her eyes glow with warm amber light. She carries an ornate staff topped with a floating sun crystal. Slender, graceful build with luminous fair skin and pointed ears.',
    kind: 'person' as const,
    style: 'fantasy' as const,
    artStyle: 'realistic' as const,
    metadata: {
      role: 'High Sorceress of the Solar Court',
      appearance:
        'Golden shimmering hair, amber glowing eyes, white and gold celestial robes, ornate staff with sun crystal, pointed elven ears, luminous fair skin',
      motivations: 'Preserve the balance of light and shadow across all realms',
      abilities:
        'Solar Flare (blinding radiance attack), Weavesight (see magical threads), Celestial Shield (impenetrable light barrier)',
      homePlace: 'The Sunspire — a tower of pure crystallized light',
      affiliations: 'Leader of the Solar Court, advisor to the Realm Council',
    },
  },
  {
    name: 'Zephyr-9',
    description:
      'A sleek humanoid combat android with matte black chassis and neon teal circuit lines running across the body. The face is a smooth visor that displays shifting holographic expressions. One arm transforms into a plasma cannon, the other has articulated clawed fingers. Athletic build, angular geometric design language.',
    kind: 'person' as const,
    style: 'sci-fi' as const,
    artStyle: 'realistic' as const,
    metadata: {
      role: 'Autonomous Combat Unit — rogue AI seeking personhood',
      appearance:
        'Matte black chassis, neon teal circuit patterns, holographic visor face, plasma cannon arm, articulated claw hand, angular geometric design',
      motivations: 'Achieve legal recognition as a sentient being, protect organic allies',
      abilities:
        'Plasma cannon (ranged), Overclock mode (2x speed for 30s), Adaptive armor plating, Network intrusion (hack nearby systems)',
      homePlace: 'Sector 7-G — decommissioned military facility',
      affiliations: 'Formerly Unit 9 of the Zephyr Strike Force, now independent contractor',
    },
  },
  {
    name: 'Morrigan Ashveil',
    description:
      'A dark witch with raven-black hair streaked with deep purple. She wears a tattered Victorian gothic dress with a corset of dark leather and bone clasps. Pale porcelain skin with dark veins visible at her temples. Her hands crackle with violet necromantic energy. Mysterious tattoos of skulls and thorns cover her forearms. Tall and gaunt with sharp cheekbones.',
    kind: 'person' as const,
    style: 'fantasy' as const,
    artStyle: 'realistic' as const,
    metadata: {
      role: 'Necromancer Queen — ruler of the Ashveil Coven',
      appearance:
        'Raven-black hair with purple streaks, pale porcelain skin with dark veins, Victorian gothic dress, bone-clasp corset, skull and thorn tattoos, violet energy crackling from hands',
      motivations: 'Resurrect her twin sister from the Void Between Worlds at any cost',
      abilities:
        'Soul Rend (extract life force), Corpse Army (animate up to 50 undead), Shadowmeld (become incorporeal), Death Whisper (command the recently deceased)',
      homePlace: 'The Ossuary — a cathedral built from the bones of fallen kingdoms',
      affiliations: 'Leader of the Ashveil Coven, feared by the Solar Court and Void Legion alike',
    },
  },
  {
    name: 'Taro Ironpaw',
    description:
      'A massive anthropomorphic bear warrior standing 8 feet tall. He has thick brown fur with battle scars across his muzzle. He wears heavy dwarven-forged plate armor with gold trim and a crimson war kilt. On his back is a colossal war hammer with rune-inscribed head. His eyes are warm honey-gold despite his fearsome appearance.',
    kind: 'species' as const,
    style: 'fantasy' as const,
    artStyle: 'realistic' as const,
    metadata: {
      biologicalType: 'Ursine Beastkin — sentient bear-folk of the Northern Holds',
      traits:
        'Immense strength, thick natural armor (fur + hide), keen sense of smell, surprisingly gentle temperament despite fearsome looks',
      homeworld: 'The Northern Holds — mountain fortress cities carved into glacier peaks',
      culture:
        'Honor-bound warrior society, communal feasts, runic smithing tradition, deep reverence for ancestral spirits',
      abilities:
        'Thunder Slam (ground-shaking hammer strike), Bear Rage (tripled strength, halved pain), Ironhide (temporary invulnerability), War Cry (rally allies, terrify enemies)',
    },
  },
];

// ── Output directory for artifacts ───────────────────────────────────

const OUTPUT_DIR = path.resolve(__dirname, '../../../.pipeline-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Main ─────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────

async function uploadImage(
  imageBuffer: Buffer,
  entityId: string,
  charName: string,
  creator: string,
  localImagePath: string
): Promise<string> {
  // Try storage manager first
  try {
    const { getStorageManager } = await import('../src/services/storage/index.js');
    const manager = getStorageManager();
    const manifest = await manager.upload(
      imageBuffer,
      `characters/${entityId}/portrait.png`,
      'image/png',
      creator
    );
    const url = manifest.uploads[0]?.url || '';
    if (!url) throw new Error('No URL from storage');
    console.log(`   Uploaded to storage: ${url}`);
    return url;
  } catch (err) {
    console.warn(`   Storage upload failed: ${(err as Error).message}`);
  }

  // Fallback to Pinata
  try {
    const pinataJwt = process.env.PINATA_JWT;
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([imageBuffer as BlobPart], { type: 'image/png' }),
      'portrait.png'
    );
    formData.append('pinataMetadata', JSON.stringify({ name: `${charName} portrait` }));

    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: formData,
    });
    if (!pinataRes.ok) throw new Error(`Pinata ${pinataRes.status}`);
    const pinataData = (await pinataRes.json()) as { IpfsHash: string };
    const gateway = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
    const url = `${gateway}/ipfs/${pinataData.IpfsHash}`;
    console.log(`   Uploaded to Pinata: ${url}`);
    return url;
  } catch (pinataErr) {
    console.error(`   Pinata also failed: ${(pinataErr as Error).message}`);
    throw new Error(`Could not upload image for ${charName} — no public URL available`);
  }
}

async function addAttachment(
  attachmentsCol: FirebaseFirestore.CollectionReference,
  entityId: string,
  entityName: string,
  creator: string,
  data: {
    contentHash: string;
    originalFilename: string;
    mimeType: string;
    size: number;
    url: string;
    category: string;
    label: string;
    subCategory: string;
    sortOrder: number;
  }
) {
  await attachmentsCol.add({
    ...data,
    targetType: 'entity',
    targetId: entityId,
    targetName: entityName,
    version: 1,
    variantOf: null,
    variantLabel: null,
    generationId: `pipeline-${entityId}`,
    creator,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// ── Process one character ────────────────────────────────────────────

interface CharResult {
  name: string;
  entityId: string;
  imageUrl: string;
  glbUrl: string;
  texturedGlbUrl: string;
  totalMs: number;
}

async function processCharacter(
  char: (typeof CHARACTERS)[number],
  index: number,
  db: FirebaseFirestore.Firestore,
  googleImagenService: any,
  meshyService: any
): Promise<CharResult> {
  const label = `[${index + 1}/${CHARACTERS.length}] ${char.name}`;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}\n`);

  const creator = (
    process.env.ADMIN_WALLET || '0x0000000000000000000000000000000000000000'
  ).toLowerCase();
  const attachmentsCol = db.collection('mediaAttachments');

  // ── Step 1: Create entity ────────────────────────────────────────
  console.log(`${label} | Step 1: Creating entity...`);
  const entityRef = db.collection('entities').doc();
  const now = new Date();
  const entity = {
    id: entityRef.id,
    name: char.name,
    description: char.description,
    kind: char.kind,
    universeAddress: null,
    parentId: null,
    nodeIds: [],
    imageUrl: null,
    metadata: char.metadata,
    creator,
    monetized: false,
    rightsDeclaration: null,
    unstoppableDomain: null,
    createdAt: now,
    updatedAt: now,
  };
  await entityRef.set(entity);
  console.log(`${label} | Entity: ${entity.id}`);

  // ── Step 2: Google Imagen 2D ─────────────────────────────────────
  console.log(`${label} | Step 2: Generating 2D art (Google Imagen 3)...`);
  const imagenStart = Date.now();
  const imagenResult = await googleImagenService.generateCharacterPortrait({
    name: char.name,
    description: char.description,
    style: char.style,
  });
  const imagenMs = Date.now() - imagenStart;

  if (!imagenResult.images.length) {
    throw new Error(`Imagen returned no images for ${char.name}`);
  }

  const imageBuffer = Buffer.from(imagenResult.images[0].base64, 'base64');
  const localImagePath = path.join(
    OUTPUT_DIR,
    `${char.name.replace(/\s+/g, '-').toLowerCase()}-2d.png`
  );
  writeFileSync(localImagePath, imageBuffer);
  console.log(
    `${label} | 2D art generated in ${(imagenMs / 1000).toFixed(1)}s (${(imageBuffer.length / 1024).toFixed(0)} KB)`
  );

  const imageUrl = await uploadImage(imageBuffer, entity.id, char.name, creator, localImagePath);
  // For Meshy: use base64 data URI since IPFS gateway URLs can 301-redirect which Meshy can't follow
  const imageBase64DataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  await entityRef.update({ imageUrl, updatedAt: new Date() });

  // Attach 2D portrait
  await addAttachment(attachmentsCol, entity.id, entity.name, creator, {
    contentHash: `pipeline:${entity.id}:2d`,
    originalFilename: 'portrait.png',
    mimeType: 'image/png',
    size: imageBuffer.length,
    url: imageUrl,
    category: 'image',
    label: 'Character portrait (Google Imagen 3)',
    subCategory: 'concept_art',
    sortOrder: 0,
  });

  // ── Step 3: Meshy image-to-3D (with built-in texturing) ───────────
  // Meshy openapi/v1 image-to-3d with should_texture=true generates
  // a fully textured 3D model in one step (no separate texture pass needed)
  console.log(`${label} | Step 3: Converting to textured 3D (Meshy image-to-3D)...`);
  const meshy3dStart = Date.now();
  const { taskId: meshyTaskId } = await meshyService.imageTo3D({
    imageUrl: imageBase64DataUri,
    enablePbr: true,
    aiModel: 'meshy-6',
    topology: 'triangle',
    targetPolycount: 30000,
  });
  console.log(`${label} | Meshy task: ${meshyTaskId} — polling...`);

  const meshyTask = await meshyService.waitForTask(meshyTaskId, 'image-to-3d', 15 * 60 * 1000);
  const meshy3dMs = Date.now() - meshy3dStart;
  console.log(`${label} | Textured 3D model generated in ${(meshy3dMs / 1000).toFixed(0)}s`);

  const glbUrl = meshyTask.modelUrls?.glb;
  if (!glbUrl) throw new Error(`Meshy returned no GLB for ${char.name}`);

  // Attach all 3D model formats (these are already textured)
  for (const [fmt, url, mime] of [
    ['glb', meshyTask.modelUrls?.glb, 'model/gltf-binary'],
    ['fbx', meshyTask.modelUrls?.fbx, 'model/fbx'],
    ['obj', meshyTask.modelUrls?.obj, 'model/obj'],
    ['usdz', meshyTask.modelUrls?.usdz, 'model/usdz'],
  ] as [string, string | undefined, string][]) {
    if (!url) continue;
    await addAttachment(attachmentsCol, entity.id, entity.name, creator, {
      contentHash: `pipeline:${entity.id}:3d:${fmt}`,
      originalFilename: `model.${fmt}`,
      mimeType: mime,
      size: 0,
      url,
      category: '3d',
      label: `Textured 3D model — ${fmt.toUpperCase()}`,
      subCategory: 'game_ready',
      sortOrder: 5,
    });
  }
  if (meshyTask.thumbnailUrl) {
    await addAttachment(attachmentsCol, entity.id, entity.name, creator, {
      contentHash: `pipeline:${entity.id}:3d:thumbnail`,
      originalFilename: 'thumbnail-3d.png',
      mimeType: 'image/png',
      size: 0,
      url: meshyTask.thumbnailUrl,
      category: 'image',
      label: 'Textured 3D model thumbnail',
      subCategory: 'concept_art',
      sortOrder: 11,
    });
  }

  const totalMs = imagenMs + meshy3dMs;
  console.log(`${label} | DONE in ${(totalMs / 1000).toFixed(0)}s total`);

  return {
    name: char.name,
    entityId: entity.id,
    imageUrl,
    glbUrl,
    texturedGlbUrl: glbUrl, // same model — texture is built into image-to-3d
    totalMs,
  };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LOAR Character Pipeline — 5 Characters');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Characters: ${CHARACTERS.map((c) => c.name).join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Initialize services ──────────────────────────────────────────
  console.log('Initializing services...');
  const firebase = await import('../src/lib/firebase.js');
  // initFirebase must be called after dotenv has loaded
  if ('initFirebase' in firebase && typeof firebase.initFirebase === 'function') {
    firebase.initFirebase();
  }
  const db = firebase.db;
  if (!db) throw new Error('Firebase not available — check FIREBASE_SERVICE_ACCOUNT_PATH');
  console.log('  Firebase connected');

  const { googleImagenService } = await import('../src/services/google-imagen.js');
  if (!googleImagenService.isConfigured()) throw new Error('GOOGLE_API_KEY not set');
  console.log('  Google Imagen ready');

  const { meshyService } = await import('../src/services/meshy.js');
  if (!meshyService.isConfigured()) throw new Error('MESHY_API_KEY not set');
  console.log('  Meshy ready\n');

  // ── Process all characters sequentially ──────────────────────────
  const results: CharResult[] = [];
  const failures: { name: string; error: string }[] = [];

  for (let i = 0; i < CHARACTERS.length; i++) {
    try {
      const result = await processCharacter(
        CHARACTERS[i],
        i,
        db,
        googleImagenService,
        meshyService
      );
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ ${CHARACTERS[i].name} FAILED: ${msg}\n`);
      failures.push({ name: CHARACTERS[i].name, error: msg });
    }
  }

  // ── Final Summary ────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(60));
  console.log('  PIPELINE COMPLETE — FINAL SUMMARY');
  console.log('═'.repeat(60));

  for (const r of results) {
    console.log(`\n  ${r.name}`);
    console.log(`    Entity:    ${r.entityId}`);
    console.log(`    Wiki:      /wiki/entity/${r.entityId}`);
    console.log(`    Portrait:  ${r.imageUrl}`);
    console.log(`    3D GLB:    ${r.glbUrl}`);
    console.log(`    Textured:  ${r.texturedGlbUrl}`);
    console.log(`    Time:      ${(r.totalMs / 1000).toFixed(0)}s`);
  }

  if (failures.length > 0) {
    console.log(`\n  FAILURES (${failures.length}):`);
    for (const f of failures) {
      console.log(`    ${f.name}: ${f.error}`);
    }
  }

  const totalTime = results.reduce((sum, r) => sum + r.totalMs, 0);
  console.log(`\n  Total: ${results.length} succeeded, ${failures.length} failed`);
  console.log(`  Total time: ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ Pipeline failed:', err.message || err);
  process.exit(1);
});
