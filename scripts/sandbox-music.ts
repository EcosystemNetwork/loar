/**
 * Sandbox Music Generator
 *
 * Generates music using FAL AI, uploads to Firebase Storage,
 * and publishes to both the gallery (content collection) and wiki (mediaAttachments).
 *
 * Usage:
 *   npx tsx scripts/sandbox-music.ts
 *   npx tsx scripts/sandbox-music.ts --prompt "epic orchestral battle theme" --model stable-audio --duration 30
 *   npx tsx scripts/sandbox-music.ts --prompt "lo-fi chill hip hop beat" --model musicgen --duration 15
 *   npx tsx scripts/sandbox-music.ts --prompt "thunderstorm rain ambient" --model stable-audio --duration 47 --sound
 *   npx tsx scripts/sandbox-music.ts --prompt "battle drums" --entity ENTITY_ID --universe UNIVERSE_ID
 */

import * as fal from '@fal-ai/serverless-client';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Load env from monorepo root
config({ path: resolve(__dirname, '../.env') });

// ── CLI Args ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (args[i] === '--sound') {
      opts['sound'] = 'true';
    }
  }

  return {
    prompt:
      opts.prompt ||
      'Cinematic orchestral theme with soaring strings, deep brass, and ethereal choir — building from quiet mystery to triumphant climax',
    model: (opts.model as 'stable-audio' | 'musicgen' | 'musicgen-stereo') || 'stable-audio',
    duration: parseInt(opts.duration || '30', 10),
    sound: opts.sound === 'true',
    entityId: opts.entity || undefined,
    universeId: opts.universe || undefined,
  };
}

// ── Model mapping ────────────────────────────────────────────────────

const MODEL_MAP = {
  'stable-audio': 'fal-ai/stable-audio',
  musicgen: 'fal-ai/musicgen/large',
  'musicgen-stereo': 'fal-ai/musicgen/stereo-large',
} as const;

const MODEL_INFO = {
  'stable-audio': {
    id: 'stable-audio-2',
    name: 'Stable Audio 2.0',
    maxDuration: 47,
    quality: 'Premium',
    cost: 0.04,
  },
  musicgen: {
    id: 'musicgen-large',
    name: 'MusicGen Large',
    maxDuration: 30,
    quality: 'Standard',
    cost: 0.02,
  },
  'musicgen-stereo': {
    id: 'musicgen-stereo-large',
    name: 'MusicGen Stereo',
    maxDuration: 30,
    quality: 'Standard',
    cost: 0.03,
  },
};

const SANDBOX_CREATOR = 'sandbox-pipeline';

// ── Firebase Init ────────────────────────────────────────────────────

function initFirebase() {
  let serviceAccount: any;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (!serviceAccount.project_id || serviceAccount.project_id === '...') {
        serviceAccount = undefined;
      }
    } catch {
      // fall through
    }
  }

  if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const { readFileSync } = require('fs');
      const absPath = resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
    } catch (err: any) {
      console.warn(`  Failed to read service account file: ${err.message}`);
    }
  }

  if (!serviceAccount) {
    console.error(
      '  FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_PATH not configured — cannot publish to gallery/wiki.'
    );
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || '';
  const bucket = bucketName ? getStorage(app).bucket(bucketName) : null;

  return { db, bucket, bucketName };
}

// ── Upload to Firebase Storage (optional — falls back to provider URL) ──

async function tryUploadToStorage(
  bucket: any,
  bucketName: string,
  buffer: Buffer,
  filename: string
): Promise<string | null> {
  try {
    const key = `videos/${filename}`;
    const file = bucket.file(key);

    const ext = filename.split('.').pop()?.toLowerCase();
    const contentType = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';

    await file.save(buffer, {
      contentType,
      metadata: { cacheControl: 'public, max-age=31536000' },
    });
    await file.makePublic();

    return `https://storage.googleapis.com/${bucketName}/${key}`;
  } catch (err: any) {
    console.warn(
      `         Storage upload failed (using provider URL): ${err.message?.slice(0, 80)}`
    );
    return null;
  }
}

// ── Publish to Gallery (content collection) ──────────────────────────

async function publishToGallery(
  db: FirebaseFirestore.Firestore,
  opts: {
    generationId: string;
    prompt: string;
    audioUrl: string;
    model: string;
    universeId?: string;
    isSound: boolean;
  }
) {
  const now = new Date();
  const ref = await db.collection('content').add({
    title: opts.prompt.slice(0, 100) || 'Generated Music',
    description: opts.prompt,
    mediaUrl: opts.audioUrl,
    thumbnailUrl: null,
    mediaType: 'audio',
    classification: 'original',
    tags: opts.isSound ? ['sound-effect', 'sandbox'] : ['music', 'sandbox'],
    ipDeclaration: {
      isOriginal: true,
      usesCopyrightedMaterial: false,
      license: 'all-rights-reserved',
    },
    visibility: 'public',
    creatorUid: SANDBOX_CREATOR,
    ...(opts.universeId ? { universeId: opts.universeId } : {}),
    createdAt: now,
    updatedAt: now,
    views: 0,
    likes: 0,
    reviewStatus: 'not_required',
    generationId: opts.generationId,
    generationModel: opts.model,
  });
  return ref.id;
}

// ── Publish to Wiki (mediaAttachments collection) ────────────────────

async function publishToWiki(
  db: FirebaseFirestore.Firestore,
  opts: {
    generationId: string;
    prompt: string;
    audioUrl: string;
    fileSize: number;
    entityId?: string;
    universeId?: string;
    isSound: boolean;
  }
) {
  // Determine target — attach to entity if provided, otherwise universe, otherwise standalone
  let targetType: string;
  let targetId: string;
  let targetName = '';

  if (opts.entityId) {
    targetType = 'entity';
    targetId = opts.entityId;
    // Try to look up entity name
    try {
      const entityDoc = await db.collection('entities').doc(opts.entityId).get();
      if (entityDoc.exists) {
        targetName = entityDoc.data()?.name ?? '';
      }
    } catch {
      // best-effort
    }
  } else if (opts.universeId) {
    targetType = 'universe';
    targetId = opts.universeId;
  } else {
    // No target — still create the attachment as a standalone music piece
    targetType = 'entity';
    targetId = 'sandbox-music';
    targetName = 'Sandbox Music';
  }

  const id = randomUUID();
  const now = new Date();
  const ext = opts.audioUrl.includes('.wav') ? 'wav' : 'mp3';

  await db
    .collection('mediaAttachments')
    .doc(id)
    .set({
      contentHash: `gen:${opts.generationId}:${opts.isSound ? 'sound' : 'music'}`,
      originalFilename: `${opts.isSound ? 'sound' : 'music'}-${opts.generationId}.${ext}`,
      mimeType: ext === 'wav' ? 'audio/wav' : 'audio/mpeg',
      size: opts.fileSize,
      url: opts.audioUrl,
      targetType,
      targetId,
      targetName,
      category: opts.isSound ? 'sound' : 'music',
      label: `${opts.isSound ? 'Sound' : 'Music'} — ${opts.prompt.slice(0, 60)}`,
      subCategory: null,
      version: 1,
      variantOf: null,
      variantLabel: null,
      sortOrder: 0,
      generationId: opts.generationId,
      creator: SANDBOX_CREATOR,
      createdAt: now,
      updatedAt: now,
    });

  return id;
}

// ── Save generation record (audioGenerations) ────────────────────────

async function saveGenerationRecord(
  db: FirebaseFirestore.Firestore,
  opts: {
    generationId: string;
    prompt: string;
    audioUrl: string;
    model: (typeof MODEL_INFO)[keyof typeof MODEL_INFO];
    durationSec: number;
    latencyMs: number;
    isSound: boolean;
    entityId?: string;
    universeId?: string;
  }
) {
  await db
    .collection('audioGenerations')
    .doc(opts.generationId)
    .set({
      id: opts.generationId,
      userId: SANDBOX_CREATOR,
      entityId: opts.entityId || null,
      universeId: opts.universeId || null,
      routingMode: 'manual',
      requestedModelId: opts.model.id,
      finalModelId: opts.model.id,
      provider: 'fal',
      status: 'completed',
      prompt: opts.prompt,
      mode: opts.isSound ? 'text_to_sound' : 'text_to_music',
      durationSec: opts.durationSec,
      genre: null,
      style: null,
      providerCostUsd: opts.model.cost,
      fiatPriceUsd: 0,
      loarPriceUsd: 0,
      creditsCharged: 0,
      marginUsd: 0,
      routingReasonCode: 'manual_user_selection',
      latencyMs: opts.latencyMs,
      audioUrl: opts.audioUrl,
      permanentAudioUrl: opts.audioUrl,
      createdAt: new Date(),
      completedAt: new Date(),
    });
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!process.env.FAL_KEY) {
    console.error('FAL_KEY not found in .env — cannot generate music.');
    process.exit(1);
  }

  fal.config({ credentials: process.env.FAL_KEY });

  const info = MODEL_INFO[opts.model];
  const falModel = MODEL_MAP[opts.model];
  const duration = Math.min(opts.duration, info.maxDuration);
  const genId = randomUUID();

  console.log('\n  Music Generation (Sandbox Mode)');
  console.log('  ================================');
  console.log(`  Model:    ${info.name} (${info.quality})`);
  console.log(`  Prompt:   ${opts.prompt.slice(0, 80)}${opts.prompt.length > 80 ? '...' : ''}`);
  console.log(`  Duration: ${duration}s`);
  console.log(`  Mode:     ${opts.sound ? 'Sound Effect' : 'Music'}`);
  if (opts.entityId) console.log(`  Entity:   ${opts.entityId}`);
  if (opts.universeId) console.log(`  Universe: ${opts.universeId}`);
  console.log(`  ID:       ${genId}`);
  console.log('');

  // ── Step 1: Generate audio via FAL ──────────────────────────────────
  const startTime = Date.now();
  console.log('  [1/4] Generating audio...');

  const input: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.model === 'stable-audio') {
    input.seconds_total = duration;
    input.steps = 100;
  } else {
    input.duration = duration;
  }

  try {
    const result = await fal.subscribe(falModel, { input, logs: true });
    const data = (result as any).data || result;

    // Extract audio URL
    let audioUrl: string | undefined;
    if (data.audio_file?.url) audioUrl = data.audio_file.url;
    else if (data.audio?.url) audioUrl = data.audio.url;
    else if (data.audio_url) audioUrl = data.audio_url;
    else if (data.url) audioUrl = data.url;
    else if (typeof data.audio === 'string') audioUrl = data.audio;

    if (!audioUrl) {
      console.error('  No audio URL in response. Keys:', Object.keys(data).join(', '));
      process.exit(1);
    }

    const latencyMs = Date.now() - startTime;
    console.log(`         Done in ${(latencyMs / 1000).toFixed(1)}s`);

    // ── Step 2: Download audio ────────────────────────────────────────
    console.log('  [2/4] Downloading audio...');
    const response = await fetch(audioUrl);
    if (!response.ok) {
      console.error(`  Download failed: ${response.status} ${response.statusText}`);
      process.exit(1);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save locally
    const outDir = resolve(__dirname, '../.pipeline-output');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = opts.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    const ext = audioUrl.includes('.wav') ? 'wav' : 'mp3';
    const localFilename = `music-${slug}-${timestamp}.${ext}`;
    writeFileSync(resolve(outDir, localFilename), buffer);
    console.log(
      `         Local: .pipeline-output/${localFilename} (${(buffer.length / 1024).toFixed(0)} KB)`
    );

    // ── Step 3: Upload to Firebase Storage (or use provider URL) ──────
    console.log('  [3/4] Initializing Firebase & uploading...');
    const { db, bucket, bucketName } = initFirebase();

    let permanentUrl = audioUrl; // fallback to provider CDN URL
    if (bucket && bucketName) {
      const storageFilename = `music-${genId}.${ext}`;
      const uploaded = await tryUploadToStorage(bucket, bucketName, buffer, storageFilename);
      if (uploaded) permanentUrl = uploaded;
    } else {
      console.log('         No storage bucket — using provider URL directly');
    }
    console.log(`         URL: ${permanentUrl}`);

    // ── Step 4: Publish to gallery + wiki + generation record ─────────
    console.log('  [4/4] Publishing to gallery & wiki...');

    const [galleryId, attachmentId] = await Promise.all([
      publishToGallery(db, {
        generationId: genId,
        prompt: opts.prompt,
        audioUrl: permanentUrl,
        model: info.id,
        universeId: opts.universeId,
        isSound: opts.sound,
      }),
      publishToWiki(db, {
        generationId: genId,
        prompt: opts.prompt,
        audioUrl: permanentUrl,
        fileSize: buffer.length,
        entityId: opts.entityId,
        universeId: opts.universeId,
        isSound: opts.sound,
      }),
      saveGenerationRecord(db, {
        generationId: genId,
        prompt: opts.prompt,
        audioUrl: permanentUrl,
        model: info,
        durationSec: duration,
        latencyMs,
        isSound: opts.sound,
        entityId: opts.entityId,
        universeId: opts.universeId,
      }),
    ]);

    console.log(`         Gallery entry:  ${galleryId}`);
    console.log(`         Attachment:     ${attachmentId}`);
    console.log(`         Generation:     ${genId}`);

    console.log('\n  All done! Music is live in gallery and wiki.\n');
  } catch (error: any) {
    console.error('\n  Generation failed:', error.message || error);
    process.exit(1);
  }
}

main();
