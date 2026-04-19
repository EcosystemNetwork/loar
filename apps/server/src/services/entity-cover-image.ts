/**
 * Entity Cover Image Service
 *
 * Generates a cover image for a wiki entity using Google's nano-banana-pro-preview
 * (via googleImagenService), uploads to Pinata IPFS, and updates the entity.
 *
 * Used by:
 *   - entities.create (fire-and-forget when no imageUrl provided)
 *   - scripts/generate-missing-images.ts (batch backfill)
 */

import { db } from '../lib/firebase';
import { googleImagenService } from './google-imagen';

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
  | 'moodboard'
  | 'style_pack'
  | 'timeline'
  | 'reality'
  | 'dimension'
  | 'plane'
  | 'realm'
  | 'domain';

type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

interface PromptConfig {
  buildPrompt: (name: string, description: string, metadata: Record<string, unknown>) => string;
  negativePrompt: string;
  aspectRatio: AspectRatio;
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
        'T-pose or neutral standing pose, clean solid color background',
        'front-facing view, high detail character design',
        'no text, no watermarks, single character only',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, multiple characters, busy background',
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
        'fantasy creature concept art, cinematic lighting, neutral pose, clean background',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, busy background',
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
        'epic landscape, concept art, cinematic wide shot, volumetric lighting, matte painting',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, people in foreground',
    aspectRatio: '16:9',
    personGeneration: 'DONT_ALLOW',
  },
  thing: {
    buildPrompt: (name, description, metadata) => {
      const origin = metadata.origin || '';
      return [
        `Detailed illustration of ${name}`,
        description,
        origin ? `Origin: ${origin}` : '',
        'item concept art, studio lighting, clean background, centered composition, high detail',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, busy background',
    aspectRatio: '1:1',
    personGeneration: 'DONT_ALLOW',
  },
  faction: {
    buildPrompt: (name, description, metadata) => {
      const ideology = metadata.ideology || '';
      return [
        `Faction emblem and headquarters of ${name}`,
        description,
        ideology ? `Ideology: ${ideology}` : '',
        'epic heraldic banner, fortress scene, concept art, cinematic lighting',
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
      return [
        `Dramatic scene depicting the event: ${name}`,
        description,
        era ? `Era: ${era}` : '',
        'epic historical scene, concept art, cinematic composition, dramatic lighting',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark',
    aspectRatio: '16:9',
    personGeneration: 'ALLOW_ADULT',
  },
  lore: {
    buildPrompt: (name, description) => {
      return [
        `Ancient mystical illustration representing: ${name}`,
        description,
        'illuminated manuscript style, magical symbols, glowing runes, parchment texture',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, modern text, watermark, photograph',
    aspectRatio: '1:1',
    personGeneration: 'DONT_ALLOW',
  },
  vehicle: {
    buildPrompt: (name, description) => {
      return [
        `Detailed vehicle design of ${name}`,
        description,
        'vehicle concept art, three-quarter view, studio lighting, clean background',
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
        'sci-fi concept art, futuristic device, clean studio lighting, detailed engineering',
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
        'architectural concept art, imposing building, faction banner, cinematic lighting',
      ]
        .filter(Boolean)
        .join(', ');
    },
    negativePrompt: 'blurry, low quality, text, watermark, modern office',
    aspectRatio: '16:9',
    personGeneration: 'DONT_ALLOW',
  },
};

const STRUCTURAL_PROMPT: PromptConfig = {
  buildPrompt: (name, description) => {
    return [
      `Abstract cosmic visualization of ${name}`,
      description,
      'cosmic abstract art, nebula, starfields, dimensional rifts, ethereal glowing energy',
    ]
      .filter(Boolean)
      .join(', ');
  },
  negativePrompt: 'blurry, low quality, text, watermark, photograph',
  aspectRatio: '16:9',
  personGeneration: 'DONT_ALLOW',
};

export function getEntityPromptConfig(kind: string): PromptConfig {
  return PROMPT_CONFIGS[kind] || STRUCTURAL_PROMPT;
}

async function uploadToPinata(
  base64: string,
  entityId: string,
  entityName: string
): Promise<string> {
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) throw new Error('PINATA_JWT not configured');

  const buffer = Buffer.from(base64, 'base64');
  const formData = new FormData();
  formData.append('file', new Blob([buffer as BlobPart], { type: 'image/png' }), `${entityId}.png`);
  formData.append('pinataMetadata', JSON.stringify({ name: `${entityName} cover` }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Pinata upload failed: ${res.status}`);
  const data = (await res.json()) as { IpfsHash: string };
  const gateway = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
  return `${gateway}/ipfs/${data.IpfsHash}`;
}

export interface EntityForCover {
  id: string;
  name: string;
  description: string;
  kind: EntityKind;
  metadata: Record<string, unknown>;
}

/**
 * Generate a cover image for an entity and update its imageUrl in Firestore.
 * Returns the IPFS URL on success. Throws on failure.
 */
export async function generateEntityCoverImage(entity: EntityForCover): Promise<string> {
  const config = getEntityPromptConfig(entity.kind);
  const prompt = config.buildPrompt(entity.name, entity.description || '', entity.metadata || {});

  const result = await googleImagenService.generate({
    prompt,
    model: 'nano-banana-pro-preview',
    negativePrompt: config.negativePrompt,
    numberOfImages: 1,
    aspectRatio: config.aspectRatio,
    personGeneration: config.personGeneration,
  });

  if (!result.images.length) {
    throw new Error('Image generation returned no images (safety filter?)');
  }

  const imageUrl = await uploadToPinata(result.images[0].base64, entity.id, entity.name);
  if (!db) throw new Error('Firestore not initialized');
  await db.collection('entities').doc(entity.id).update({
    imageUrl,
    updatedAt: new Date(),
  });
  return imageUrl;
}

/**
 * Fire-and-forget cover image generation — logs errors but doesn't throw.
 * Use this from create routes where you don't want to block the response.
 */
export function triggerCoverImageGenerationAsync(entity: EntityForCover): void {
  generateEntityCoverImage(entity)
    .then((url) => {
      console.log(`[entity-cover] Generated cover for ${entity.name} (${entity.id}): ${url}`);
    })
    .catch((err) => {
      console.error(
        `[entity-cover] Failed to generate cover for ${entity.name} (${entity.id}):`,
        err
      );
    });
}
