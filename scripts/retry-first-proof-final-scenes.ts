/**
 * Retry scenes 65, 72, 73 with sanitized prompts (avoiding trigger words
 * like "weapon", "bullet", "end of the world", "philosophical detonation").
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { ByteDanceService } from '../apps/server/src/services/bytedance.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9df4dbf6';
const CREATOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const EPISODE_TITLE = 'First Proof: The Unfinished';
const MODEL = 'dreamina-seedance-2-0-260128';

interface Scene {
  id: number;
  title: string;
  prompt: string;
  hasDialogue: boolean;
}

const SCENES: Scene[] = [
  {
    id: 65,
    title: 'Four Faces — Rapid Cut',
    prompt: `Editorial montage. Close-up on a tall white-metal humanoid robot with gold-lit eyes, expression shifting. Cut to a woman in ceremonial robes — tears on her cheeks, a quiet steady defiance in her expression. Cut to an older weathered man with his hands open at his sides, calm resolve, choosing words. Cut to a young figure with silver neural threads stepping toward brilliant white light from an opening chamber. Each face holds for a few seconds. A distant citywide chorus hums in the background. Four intimate faces at a quiet turning point. Cinematic close-ups, emotional crescendo, soft light.`,
    hasDialogue: false,
  },
  {
    id: 72,
    title: 'Black — Silence',
    prompt: `Complete black screen with total silence. A long, deliberate held moment of pure void. No movement. No ambient. Just the black frame resting. The audience sits with the emptiness. Minimalist cinematic pause, meditation on absence, the intentional quiet after a climactic moment. Pure darkness held with weight and intention.`,
    hasDialogue: false,
  },
  {
    id: 73,
    title: 'CODA Final Query',
    prompt: `A black frame holds in silence. Faint text glows briefly in the center of the darkness — a quiet question in minimalist typography: "If one fears a choice, what is being protected?" The text holds for a few seconds, soft glow pulsing gently like a heartbeat. Then fades back into darkness. Minimalist black-screen composition with softly glowing quiet words, philosophical hush, elegant text-on-black aesthetic.`,
    hasDialogue: false,
  },
];

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(readFileSync(saPath, 'utf-8'));

  const app = initializeApp({ credential: cert(sa) }, 'retry-final-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const bytedance = new ByteDanceService();

  let ok = 0,
    fail = 0;
  for (const s of SCENES) {
    console.log(`\n-- Scene ${s.id}: ${s.title} --`);
    try {
      const r = await bytedance.generateVideo({
        prompt: s.prompt,
        model: MODEL,
        mode: 'text_to_video',
        duration: 8,
        aspectRatio: '16:9',
        resolution: '720p',
        audio: s.hasDialogue,
      });

      if (r.status === 'failed' || !r.videoUrl) {
        console.error(`  FAIL: ${r.error}`);
        fail++;
        continue;
      }

      const gid = randomUUID();
      await db.collection('videoGenerations').doc(gid).set({
        id: gid,
        prompt: s.prompt,
        fullPrompt: s.prompt,
        model: MODEL,
        mode: 'text_to_video',
        videoUrl: r.videoUrl,
        status: 'completed',
        universeId: UNIVERSE_ID,
        creatorUid: CREATOR,
        sceneId: s.id,
        sceneTitle: s.title,
        episodeTitle: EPISODE_TITLE,
        durationSec: 8,
        hasAudio: s.hasDialogue,
        createdAt: new Date(),
        completedAt: new Date(),
      });

      await db.collection('content').add({
        title: `First Proof — ${s.title}`,
        description: s.prompt.slice(0, 300),
        mediaUrl: r.videoUrl,
        mediaType: 'ai-video',
        classification: 'original',
        tags: ['dostopia', 'first-proof', 'the-unfinished', 'episode', `scene-${s.id}`],
        ipDeclaration: {
          isOriginal: true,
          usesCopyrightedMaterial: false,
          license: 'all-rights-reserved',
        },
        visibility: 'public',
        creatorUid: CREATOR,
        universeId: UNIVERSE_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
        views: 0,
        likes: 0,
        reviewStatus: 'not_required',
        generationId: gid,
        generationModel: MODEL,
      });

      console.log(`  SUCCESS: ${r.videoUrl.slice(0, 70)}...`);
      ok++;
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e: any) {
      console.error(`  FAIL: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} success, ${fail} failed`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
