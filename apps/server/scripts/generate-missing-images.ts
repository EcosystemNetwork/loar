/**
 * Generate Missing Wiki Images
 *
 * Finds all entities in Firestore with no imageUrl and generates
 * an appropriate image for each using Google Imagen 4, then uploads
 * to storage and updates the entity.
 *
 * Usage:
 *   pnpm -F server tsx scripts/generate-missing-images.ts
 *
 * Options (env vars):
 *   DRY_RUN=1        — list entities that need images without generating
 *   KIND_FILTER=person,place — only process specific kinds
 *   LIMIT=10         — max entities to process (default: all)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ── Prompt templates per entity kind ────────────────────────────────

type EntityKind =
  | 'person'
  | 'place'
  | 'thing'
  | 'faction'
  | 'event'
  | 'lore'
  | 'species'
  | 'vehicle'
  | 'technology'
  | 'organization'
  | 'timeline'
  | 'reality'
  | 'dimension'
  | 'plane'
  | 'realm'
  | 'domain';

interface PromptConfig {
  buildPrompt: (name: string, description: string, metadata: Record<string, unknown>) => string;
  negativePrompt: string;
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  personGeneration: string;
}

const PROMPT_CONFIGS: Record<string, PromptConfig> = {
  person: {
    buildPrompt: (name, description, metadata) => {
      const appearance = metadata.appearance || '';
      return [
        `Full-body character portrait of ${name}`,
        description,
        appearance ? `Appearance: ${appearance}` : '',
        'fantasy concept art, cinematic lighting, detailed textures',
        'T-pose or neutral standing pose',
        'clean solid color background',
        'front-facing view, high detail character design',
        'no text, no watermarks, single character only',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt:
      'blurry, low quality, text, watermark, multiple characters, busy background, cropped',
    aspectRatio: '3:4',
    personGeneration: 'ALLOW_ADULT',
  },

  species: {
    buildPrompt: (name, description, metadata) => {
      const traits = metadata.traits || '';
      return [
        `Detailed creature portrait of ${name}`,
        description,
        traits ? `Physical traits: ${traits}` : '',
        'fantasy creature concept art, cinematic lighting',
        'neutral pose, clean background',
        'high detail, no text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, busy background, cropped',
    aspectRatio: '3:4',
    personGeneration: 'ALLOW_ADULT',
  },

  place: {
    buildPrompt: (name, description, metadata) => {
      const atmosphere = metadata.atmosphere || '';
      const placeType = metadata.placeType || '';
      return [
        `Breathtaking vista of ${name}`,
        description,
        placeType ? `Type: ${placeType}` : '',
        atmosphere ? `Atmosphere: ${atmosphere}` : '',
        'epic landscape, concept art, cinematic wide shot',
        'volumetric lighting, detailed environment',
        'matte painting style, high detail',
        'no text, no watermarks, no UI elements',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, people in foreground, cropped',
    aspectRatio: '16:9',
    personGeneration: 'DONT_ALLOW',
  },

  thing: {
    buildPrompt: (name, description, metadata) => {
      const origin = metadata.origin || '';
      const thingType = metadata.thingType || '';
      return [
        `Detailed illustration of ${name}`,
        description,
        thingType ? `Type: ${thingType}` : '',
        origin ? `Origin: ${origin}` : '',
        'item concept art, studio lighting, clean background',
        'centered composition, high detail rendering',
        'no text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, busy background, hands holding item',
    aspectRatio: '1:1',
    personGeneration: 'DONT_ALLOW',
  },

  faction: {
    buildPrompt: (name, description, metadata) => {
      const ideology = metadata.ideology || '';
      const leader = metadata.leader || '';
      return [
        `Faction emblem and headquarters of ${name}`,
        description,
        ideology ? `Ideology: ${ideology}` : '',
        leader ? `Led by: ${leader}` : '',
        'epic heraldic banner and fortress scene, concept art',
        'cinematic lighting, dramatic composition',
        'high detail, no text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, modern elements',
    aspectRatio: '16:9',
    personGeneration: 'DONT_ALLOW',
  },

  event: {
    buildPrompt: (name, description, metadata) => {
      const era = metadata.era || '';
      const location = metadata.location || '';
      return [
        `Dramatic scene depicting the event: ${name}`,
        description,
        era ? `Era: ${era}` : '',
        location ? `Location: ${location}` : '',
        'epic historical scene, concept art, cinematic composition',
        'dramatic lighting, sweeping vista',
        'high detail, no text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, modern elements, cropped',
    aspectRatio: '16:9',
    personGeneration: 'ALLOW_ADULT',
  },

  lore: {
    buildPrompt: (name, description) => {
      return [
        `Ancient mystical illustration representing: ${name}`,
        description,
        'illuminated manuscript style, magical symbols, arcane diagrams',
        'glowing runes, ethereal atmosphere, parchment texture',
        'high detail, mystical concept art',
        'no modern text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, modern text, watermark, photograph',
    aspectRatio: '1:1',
    personGeneration: 'DONT_ALLOW',
  },

  vehicle: {
    buildPrompt: (name, description, metadata) => {
      return [
        `Detailed vehicle design of ${name}`,
        description,
        'vehicle concept art, three-quarter view, studio lighting',
        'clean background, technical illustration quality',
        'high detail, no text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, busy background, people',
    aspectRatio: '16:9',
    personGeneration: 'DONT_ALLOW',
  },

  technology: {
    buildPrompt: (name, description) => {
      return [
        `Technical illustration of ${name}`,
        description,
        'sci-fi concept art, holographic display, futuristic device',
        'clean studio lighting, detailed engineering',
        'high detail rendering, no text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, busy background',
    aspectRatio: '1:1',
    personGeneration: 'DONT_ALLOW',
  },

  organization: {
    buildPrompt: (name, description, metadata) => {
      const mission = metadata.mission || '';
      return [
        `Grand headquarters and emblem of the organization: ${name}`,
        description,
        mission ? `Mission: ${mission}` : '',
        'architectural concept art, imposing building with faction banner',
        'cinematic lighting, epic scale',
        'high detail, no text, no watermarks',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, modern office',
    aspectRatio: '16:9',
    personGeneration: 'DONT_ALLOW',
  },
};

// Structural kinds get a generic cosmic/abstract treatment
const STRUCTURAL_PROMPT: PromptConfig = {
  buildPrompt: (name, description) => {
    return [
      `Abstract cosmic visualization of ${name}`,
      description,
      'cosmic abstract art, nebula, starfields, dimensional rifts',
      'ethereal glowing energy, sci-fi concept art',
      'dramatic lighting, high detail',
      'no text, no watermarks',
    ]
      .filter(Boolean)
      .join(', ');
  },
  negativePrompt: 'blurry, low quality, text, watermark, photograph',
  aspectRatio: '16:9',
  personGeneration: 'DONT_ALLOW',
};

function getPromptConfig(kind: string): PromptConfig {
  return PROMPT_CONFIGS[kind] || STRUCTURAL_PROMPT;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.env.DRY_RUN === '1';
  const kindFilter = process.env.KIND_FILTER?.split(',').map((k) => k.trim());
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║       LOAR — Generate Missing Wiki Images               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  if (isDryRun) console.log('  🔍 DRY RUN — no images will be generated\n');
  if (kindFilter) console.log(`  Filter: ${kindFilter.join(', ')}\n`);

  // Dynamic imports after dotenv
  const firebase = await import('../src/lib/firebase.js');
  if ('initFirebase' in firebase && typeof firebase.initFirebase === 'function') {
    firebase.initFirebase();
  }
  const { db } = firebase;
  if (!db) {
    console.error('ERROR: Firebase not initialized. Check FIREBASE_SERVICE_ACCOUNT in .env');
    process.exit(1);
  }
  const { googleImagenService } = await import('../src/services/google-imagen.js');
  if (!googleImagenService.isConfigured()) {
    console.error('ERROR: GOOGLE_API_KEY is not set.');
    process.exit(1);
  }
  console.log(`  Model: nano-banana-pro-preview (Google direct)`);

  // ── Query all entities ──────────────────────────────────────────
  console.log('Fetching all entities from Firestore...');
  const snapshot = await db.collection('entities').get();
  const allEntities = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Array<{
    id: string;
    name: string;
    description: string;
    kind: EntityKind;
    imageUrl: string | null;
    metadata: Record<string, unknown>;
    creator: string;
  }>;

  console.log(`  Total entities: ${allEntities.length}`);

  // ── Filter to those missing images ──────────────────────────────
  let needsImage = allEntities.filter((e) => !e.imageUrl);
  if (kindFilter) {
    needsImage = needsImage.filter((e) => kindFilter.includes(e.kind));
  }
  if (needsImage.length > limit) {
    needsImage = needsImage.slice(0, limit);
  }

  console.log(`  Missing images: ${needsImage.length}\n`);

  if (needsImage.length === 0) {
    console.log('All entities already have images. Nothing to do.');
    process.exit(0);
  }

  // ── Show summary by kind ────────────────────────────────────────
  const byKind: Record<string, number> = {};
  for (const e of needsImage) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  }
  console.log('  Breakdown:');
  for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${kind}: ${count}`);
  }
  console.log();

  if (isDryRun) {
    console.log('Entities needing images:');
    for (const e of needsImage) {
      console.log(`  [${e.kind}] ${e.name} (${e.id})`);
    }
    console.log('\nRun without DRY_RUN=1 to generate images.');
    process.exit(0);
  }

  // ── Upload helper (downloads from FAL temp URL → pins to Pinata IPFS) ──
  async function uploadToPinata(imageUrl: string, entityName: string): Promise<string> {
    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) return imageUrl; // fallback: use FAL temp URL directly

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);
    const buffer = new Uint8Array(await imgRes.arrayBuffer());

    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: 'image/png' }), 'cover.png');
    formData.append('pinataMetadata', JSON.stringify({ name: `${entityName} wiki image` }));

    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: formData,
    });
    if (!pinataRes.ok) throw new Error(`Pinata upload failed: ${pinataRes.status}`);
    const pinataData = (await pinataRes.json()) as { IpfsHash: string };
    const gateway = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
    return `${gateway}/ipfs/${pinataData.IpfsHash}`;
  }

  // ── Process each entity ─────────────────────────────────────────
  let success = 0;
  let failed = 0;

  for (let i = 0; i < needsImage.length; i++) {
    const entity = needsImage[i];
    const label = `[${i + 1}/${needsImage.length}]`;

    console.log(`${label} ${entity.kind}: "${entity.name}"`);

    try {
      const config = getPromptConfig(entity.kind);

      // Build prompt, with a safety-filter fallback that strips dark/violent descriptors
      const buildSafeDescription = (desc: string) =>
        desc
          .replace(
            /necromantic|undead|corpse|skull|death|bone|dark vein|soul rend|life force/gi,
            ''
          )
          .replace(/\s{2,}/g, ' ')
          .trim();

      let prompt = config.buildPrompt(entity.name, entity.description || '', entity.metadata || {});

      // Generate image via Google nano-banana-2
      console.log(`  Generating image...`);
      let result;
      try {
        result = await googleImagenService.generate({
          prompt,
          model: 'nano-banana-pro-preview',
          negativePrompt: config.negativePrompt,
          numberOfImages: 1,
          aspectRatio: config.aspectRatio,
          personGeneration: config.personGeneration,
        });
      } catch (firstErr) {
        const msg = (firstErr as Error).message;
        if (msg.includes('Responsible AI') || msg.includes('filtered')) {
          console.log(`  Safety filter hit — retrying with softened prompt...`);
          const safeDesc = buildSafeDescription(entity.description || '');
          const safeMeta: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(entity.metadata || {})) {
            safeMeta[k] = typeof v === 'string' ? buildSafeDescription(v) : v;
          }
          prompt = config.buildPrompt(entity.name, safeDesc, safeMeta);
          result = await googleImagenService.generate({
            prompt,
            model: 'nano-banana-pro-preview',
            negativePrompt: config.negativePrompt,
            numberOfImages: 1,
            aspectRatio: config.aspectRatio,
            personGeneration: config.personGeneration,
          });
        } else {
          throw firstErr;
        }
      }

      if (!result.images.length) {
        console.log(`  SKIP — returned no images (safety filter?)`);
        failed++;
        continue;
      }

      // Upload to Pinata IPFS
      console.log(`  Uploading to IPFS...`);
      const buffer = Buffer.from(result.images[0].base64, 'base64');
      const formData = new FormData();
      formData.append('file', new Blob([buffer as BlobPart], { type: 'image/png' }), 'cover.png');
      formData.append('pinataMetadata', JSON.stringify({ name: `${entity.name} wiki image` }));

      const pinataJwt = process.env.PINATA_JWT;
      if (!pinataJwt) throw new Error('PINATA_JWT not set');
      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pinataJwt}` },
        body: formData,
      });
      if (!pinataRes.ok) throw new Error(`Pinata upload failed: ${pinataRes.status}`);
      const pinataData = (await pinataRes.json()) as { IpfsHash: string };
      const gateway = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
      const imageUrl = `${gateway}/ipfs/${pinataData.IpfsHash}`;

      // Update entity
      await db.collection('entities').doc(entity.id).update({
        imageUrl,
        updatedAt: new Date(),
      });

      console.log(`  Done: ${imageUrl}\n`);
      success++;

      // Small delay to avoid rate limits
      if (i < needsImage.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`  FAILED: ${msg}\n`);

      // Stop immediately on quota exhaustion — no point burning through remaining entities
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        console.log(
          '\n  QUOTA EXHAUSTED — stopping early. Re-run tomorrow when the daily limit resets.\n'
        );
        const remaining = needsImage.length - i - 1;
        console.log(`  ${remaining} entities still need images.\n`);
        failed += remaining + 1;
        break;
      }

      failed++;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`  COMPLETE — ${success} generated, ${failed} failed`);
  console.log('═'.repeat(60) + '\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
