/**
 * Audio pipeline for the 7 hero universes:
 *
 *   1. Theme music per episode  — fal-ai/stable-audio, 5s clip matching the
 *      universe's tone. Stored on the episode doc as `themeAudioUrl`.
 *
 *   2. Voice sample per major character — fal-ai/kokoro/hexgrad/v0_19 (open
 *      kokoro TTS, dirt cheap). Reads ~2 sentences derived from the entity's
 *      description. Stored on entity doc as `voiceSampleUrl` + a row in
 *      voiceProfiles.
 *
 * Cost: ~$0.05 per stable-audio call × 7 = $0.35.  Kokoro TTS is roughly
 * $0.001 per generation × ~21 calls = $0.02. Total ~$0.37.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';
import * as fal from '@fal-ai/serverless-client';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const BUCKET = 'loar-db.firebasestorage.app';
const PLATFORM_CREATOR = '0x80baf7fffc430cdaced4f1d673f4138d6d493077';
const TARGET_UNIVERSES = [
  '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa',
  '0x8e5cddb763534fe426766e4eb035449fb9e73913',
  '0x341ffa19c0ec8d2c8ef42a360cf799949844262e',
  '0x89669812f850f34f907ee9e9009f501d1b008420',
  '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964',
  '0x36a903899f51096e8a59d5bee018966c995888c1',
  '0x0000000000000000000000000000019d9ab4ae0f',
];
const VOICES_PER_UNIVERSE = 3; // top-3 characters by description length

async function pinAudio(buffer: Buffer, filename: string, mime = 'audio/mpeg'): Promise<string> {
  const safeName = filename.replace(/[/\\.\s]+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `audio/${Date.now()}-${safeName}`;
  const file = getStorage().bucket(BUCKET).file(key);
  await file.save(buffer, {
    contentType: mime,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${BUCKET}/${key}`;
}

async function generateTheme(prompt: string): Promise<{ audioUrl: string }> {
  const r = (await fal.subscribe('fal-ai/stable-audio', {
    input: { prompt, seconds_total: 5 },
    logs: false,
  })) as any;
  const url = r?.audio_file?.url || r?.audio?.url || r?.url;
  if (!url) throw new Error(`stable-audio: no url in ${JSON.stringify(r).slice(0, 300)}`);
  return { audioUrl: url };
}

/**
 * Voice TTS via fal-ai/playai/tts/v3. ElevenLabs free tier exhausted; fal
 * playai tts is robust and on-budget (~$0.01 per call). Returns a temporary
 * URL — caller downloads + repins.
 */
async function generateVoice(text: string): Promise<{ audioUrl: string }> {
  // Open Kokoro TTS via fal — confirmed working on this account 2026-04-27.
  // af_bella is a warm neutral female voice; we're not voice-acting per
  // character, this is a wiki sample so a single consistent voice is fine.
  const r = (await fal.subscribe('fal-ai/kokoro/american-english', {
    input: { prompt: text, voice: 'af_bella', speed: 1.0 },
    logs: false,
  })) as any;
  const url = r?.audio?.url || r?.audio_url || r?.url;
  if (!url) throw new Error(`kokoro: no url in ${JSON.stringify(r).slice(0, 300)}`);
  return { audioUrl: url };
}

function buildThemePrompt(uni: any): string {
  const desc = String(uni.description || '')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  return `Cinematic ambient theme for "${uni.name}". ${desc}. Atmospheric, instrumental, no vocals, evocative of the universe's mood. 5 seconds.`;
}

function buildVoiceLine(entity: any, uniName: string): string {
  const desc = String(entity.description || '').replace(/\s+/g, ' ');
  // Take the first ~140 chars as the spoken intro — usually a tight character beat.
  const intro = desc
    .split(/(?<=[.!?])\s+/)
    .slice(0, 1)
    .join(' ')
    .slice(0, 200);
  return `From ${uniName}. I am ${entity.name}. ${intro}`;
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
  fal.config({ credentials: process.env.FAL_KEY });

  // ── 1. Theme per universe ──
  console.log('\n──────────── THEMES (stable-audio) ────────────');
  const universes: Array<{ addr: string; data: any }> = [];
  for (const addr of TARGET_UNIVERSES) {
    const doc = await db.collection('cinematicUniverses').doc(addr).get();
    if (doc.exists) universes.push({ addr, data: doc.data() });
  }

  for (const { addr, data } of universes) {
    // Skip universes whose latest canon episode already has a themeAudioUrl —
    // an earlier run of this script set it and we don't want to double-charge.
    const epSnapPre = await db
      .collection('episodes')
      .where('universeId', '==', addr)
      .where('isCanon', '==', true)
      .get();
    const hasTheme = epSnapPre.docs.some((d) => !!(d.data() as any).themeAudioUrl);
    if (hasTheme) {
      console.log(`▶ ${data.name}  — theme already attached, skipping.`);
      continue;
    }

    const prompt = buildThemePrompt(data);
    console.log(`▶ ${data.name}`);
    if (!APPLY) {
      console.log(`  prompt: ${prompt.slice(0, 100)}…`);
      continue;
    }
    try {
      const { audioUrl } = await generateTheme(prompt);
      const dl = await fetch(audioUrl);
      if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      const finalUrl = await pinAudio(buf, `theme-${data.name}.mp3`);
      // Attach to the latest canon episode for this universe
      const epSnap = await db
        .collection('episodes')
        .where('universeId', '==', addr)
        .where('isCanon', '==', true)
        .get();
      let latestEp: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let latestTs = 0;
      for (const d of epSnap.docs) {
        const t = (d.data().createdAt as any)?.toMillis?.() ?? 0;
        if (t > latestTs) {
          latestTs = t;
          latestEp = d;
        }
      }
      if (latestEp) {
        await latestEp.ref.update({ themeAudioUrl: finalUrl });
        console.log(
          `  ✓ theme attached to episode ${latestEp.id.slice(0, 8)}…  ${finalUrl.slice(0, 70)}…`
        );
      } else {
        console.log(`  ⚠ no canon episode found, theme stored standalone: ${finalUrl}`);
      }

      // Also write to soundNodes so it surfaces in the universe's audio gallery
      await db.collection('soundNodes').add({
        universeId: addr,
        kind: 'theme',
        audioUrl: finalUrl,
        title: `${data.name} — Theme`,
        creator: PLATFORM_CREATOR,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e: any) {
      console.log(`  ✗ ${e.message?.slice(0, 100)}`);
    }
  }

  // ── 2. Voice samples per major character ──
  console.log('\n──────────── VOICE SAMPLES (kokoro TTS) ────────────');
  for (const { addr, data } of universes) {
    const snap = await db.collection('entities').where('universeAddress', '==', addr).get();
    const persons = snap.docs
      .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }))
      .filter((e) => e.kind === 'person' && !e.voiceSampleUrl)
      .sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0))
      .slice(0, VOICES_PER_UNIVERSE);

    console.log(`▶ ${data.name}  (${persons.length} characters)`);
    for (const p of persons) {
      const text = buildVoiceLine(p, data.name);
      if (!APPLY) {
        console.log(`  ${p.name}:  "${text.slice(0, 80)}…"`);
        continue;
      }
      try {
        const { audioUrl } = await generateVoice(text);
        const dl = await fetch(audioUrl);
        if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        const ext = audioUrl.toLowerCase().includes('.wav') ? 'wav' : 'mp3';
        const mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
        const finalUrl = await pinAudio(buf, `voice-${data.name}-${p.name}.${ext}`, mime);
        await p.ref.update({ voiceSampleUrl: finalUrl });

        // voiceProfiles collection — wiki page reads this
        await db.collection('voiceProfiles').add({
          id: randomUUID(),
          universeId: addr,
          entityId: p.id,
          characterName: p.name,
          previewUrl: finalUrl,
          previewText: text,
          provider: 'fal-kokoro',
          voiceId: 'af_bella',
          creator: PLATFORM_CREATOR,
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log(`  ✓ ${p.name}  ${finalUrl.slice(0, 70)}…`);
      } catch (e: any) {
        console.log(`  ✗ ${p.name}  — ${e.message?.slice(0, 100)}`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
