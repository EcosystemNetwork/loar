/**
 * Retry scenes 65 and 72 with more neutral prompts.
 * Scene 65: The "four faces" rapid cut kept hitting copyright filter — simplified to abstract imagery.
 * Scene 72: Pure black scene — just retry (previous failure was server error).
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { rehostVideoToPinata, isEphemeralVideoUrl } from './lib/rehost-video';
import { ByteDanceService } from '../apps/server/src/services/bytedance.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9df4dbf6';
const CREATOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const EPISODE_TITLE = 'First Proof: The Unfinished';
const MODEL = 'dreamina-seedance-2-0-260128';

const SCENES = [
  {
    id: 65,
    title: 'Faces in the Light',
    prompt: `Soft cinematic montage. A series of extreme close-up portraits held for a few seconds each, separated by gentle fades. A thoughtful pair of eyes catching warm light. A face half lit by blue glow, tears drying on one cheek. A silhouette of hands resting open and relaxed at a person's sides. A figure outlined in white radiance, turning gently toward softer brightness. Each image dissolves gracefully into the next. Muted ambient color palette, soft blur at edges, contemplative cinematic portraits woven together by light.`,
    hasDialogue: false,
  },
  {
    id: 72,
    title: 'Held Silence',
    prompt: `A purely black cinematic frame held for the full duration. Subtle grain texture across the darkness. Deep quiet. A minimalist meditation on stillness, pure absence of visual information, perfect held void. Cinematic pause used between acts, contemplative empty frame, total darkness with a gentle filmic grain.`,
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

  const app = initializeApp({ credential: cert(sa) }, 'retry-final2-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  const bytedance = new ByteDanceService();

  let ok = 0,
    fail = 0;
  for (const s of SCENES) {
    console.log(`\n-- Scene ${s.id}: ${s.title} --`);
    let attempt = 0;
    let success = false;
    while (attempt < 3 && !success) {
      attempt++;
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
          console.error(`  Attempt ${attempt}/3 FAIL: ${r.error}`);
          if (r.error?.includes('copyright') || r.error?.includes('restrictions')) break; // no point retrying filter
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        // Rehost ephemeral ByteDance URL to Pinata before persisting
        let videoUrl = r.videoUrl;
        if (isEphemeralVideoUrl(videoUrl)) {
          const rehosted = await rehostVideoToPinata(videoUrl, {
            filename: `first-proof-scene-${s.id}.mp4`,
            pinName: `First Proof — ${s.title}`,
          });
          videoUrl = rehosted.url;
          console.log(`    ↳ Rehosted to Pinata: ${videoUrl.slice(0, 70)}`);
        }

        const gid = randomUUID();
        await db.collection('videoGenerations').doc(gid).set({
          id: gid,
          prompt: s.prompt,
          fullPrompt: s.prompt,
          model: MODEL,
          mode: 'text_to_video',
          videoUrl,
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
          mediaUrl: videoUrl,
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
        console.log(`  SUCCESS (attempt ${attempt}): ${r.videoUrl.slice(0, 60)}...`);
        ok++;
        success = true;
      } catch (e: any) {
        console.error(`  Attempt ${attempt}/3 ERR: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (!success) fail++;
  }

  console.log(`\nDone: ${ok} success, ${fail} failed`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
