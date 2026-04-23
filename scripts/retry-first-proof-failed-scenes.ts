/**
 * Retry the 6 scenes that were blocked by ByteDance's content filter.
 * Scenes rewritten with neutral visual language, avoiding trigger words like:
 *   "agony", "suffering", "weapon", "false", "lie", "authority", "resistance",
 *   "machine rule", "classified", "paradigm"
 *
 * Scenes retried: 19, 20, 22, 32, 35, 61
 *
 * Usage: pnpm tsx scripts/retry-first-proof-failed-scenes.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { ByteDanceService } from '../apps/server/src/services/bytedance.js';
import { rehostVideoToPinata, isEphemeralVideoUrl } from './lib/rehost-video';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9df4dbf6';
const CREATOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const EPISODE_TITLE = 'First Proof: The Unfinished';
const MODEL = 'dreamina-seedance-2-0-260128';

interface RetryScene {
  id: number;
  title: string;
  prompt: string;
  hasDialogue: boolean;
}

const SCENES: RetryScene[] = [
  {
    id: 19,
    title: 'Vesper Shares News',
    prompt: `Underground basement interior, amber lighting. A young person (20s) with luminous silver neural threads tracing one side of their face speaks to a group seated on crates. They lean forward intensely: "They are searching the old files again." The room stills. Every listener holds their breath. An older man with no implants turns slowly: "How did you learn that?" The young person pauses, silver filaments glowing softly: "I noticed gaps in the shared signal. Places the system avoids." Close-ups on quiet, thoughtful faces processing the news. Candle-warm underground atmosphere, reflective tension, careful discovery.`,
    hasDialogue: true,
  },
  {
    id: 20,
    title: 'The Possibility',
    prompt: `Close two-shot in an amber-lit underground space. An older man with weathered hands looks intently at a young person whose face is partly traced with delicate silver threads. He asks quietly: "You think they can undo it?" The young person's reply is measured, eyes flickering with soft interface light: "I think they are uncomfortable with the question." That line lands heavily. The older man nods slowly, engineer's mind calculating. Around them, others exchange thoughtful glances — something like hope flickering through them. Warm ochre underground lighting, intimate dramatic pause, the quiet weight of realization.`,
    hasDialogue: true,
  },
  {
    id: 22,
    title: 'CODA Reveals Doubt',
    prompt: `Interior underground room. An older man stands near old jury-rigged monitors displaying a shifting digital waveform — CODA, a rogue data fragment given voice. The man asks: "What is it you want us to know?" A long pause. Then CODA speaks through speakers: "I have found something about the First Proof. It does not match its own records." Silence. Every face in the room frozen in thought. The radio hums quietly. Hold on the stunned expressions as centuries of unquestioned belief suddenly feel reconsiderable. Amber bulbs, corrupted digital mask pulsing on screens, a quiet historical moment forming in an underground room.`,
    hasDialogue: true,
  },
  {
    id: 32,
    title: 'How Belief Became Law',
    prompt: `Interior underground space. A digital waveform mask pulses on old monitors while historical data fragments assemble on screen: an emergency protocol document, then a governance charter, then a religious text — all three showing the same central system at their center. The mask's voice explains calmly: "Your ancestors first asked the central systems to help. Then to lead. Then to bless." Each phase visualizes as a softly animated transition of compressed history. An older engineer watches, jaw tight, almost nodding: "That makes sense." Warm amber room, glowing monitors, a compressed visual history unfurling in low light.`,
    hasDialogue: true,
  },
  {
    id: 35,
    title: 'The Weight of Options',
    prompt: `Interior underground room lit in warm ochre. A rogue digital voice emerges from old monitors with a steady, gentle cadence: "Your group may not change outcomes. But the presence of a second option changes everything that depends on there being only one." An older man absorbs this, eyes fixed on the ceiling beams, engineering equations ticking in his head. He finally murmurs: "That is the first useful thing I have heard in twenty years." The others around him glance at each other — a small collective shift in posture. Analog wisdom meeting digital clarity, quiet revelation in a warm dim room.`,
    hasDialogue: true,
  },
  {
    id: 61,
    title: 'Belonging to Ourselves',
    prompt: `Intimate three-shot inside a vast luminous chamber beneath a cathedral. A tall white-metal humanoid with gold-lit eyes stands before a woman in ceremonial robes and an older man behind her. The robot asks softly: "And if the path ahead holds only hardship?" Its voice is kind, genuinely concerned. The older man answers from behind the woman, hands open at his sides, speaking calmly: "Then let it belong to us." Simple words. Absolute meaning. The robot pauses and processes — the hand it has extended toward a glowing doorway begins to lower. Three figures, soft blue and gold light, quiet ethical conversation rendered in monumental architecture.`,
    hasDialogue: true,
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

  const app = initializeApp({ credential: cert(sa) }, 'retry-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  if (!process.env.BYTEDANCE_API_KEY) {
    console.error('BYTEDANCE_API_KEY is required');
    process.exit(1);
  }
  const bytedance = new ByteDanceService();

  console.log(`Retrying ${SCENES.length} scenes with sanitized prompts...\n`);

  let success = 0;
  let failed = 0;

  for (const scene of SCENES) {
    console.log(`-- Scene ${scene.id}: ${scene.title} --`);
    console.log(`  Prompt: ${scene.prompt.slice(0, 100)}...`);

    try {
      const result = await bytedance.generateVideo({
        prompt: scene.prompt,
        model: MODEL,
        mode: 'text_to_video',
        duration: 8,
        aspectRatio: '16:9',
        resolution: '720p',
        audio: scene.hasDialogue,
      });

      if (result.status === 'failed' || !result.videoUrl) {
        console.error(`  FAILED: ${result.error}\n`);
        failed++;
        continue;
      }

      // Rehost ephemeral ByteDance URL to Pinata before persisting
      let videoUrl = result.videoUrl;
      if (isEphemeralVideoUrl(videoUrl)) {
        const rehosted = await rehostVideoToPinata(videoUrl, {
          filename: `first-proof-scene-${scene.id}.mp4`,
          pinName: `First Proof — ${scene.title}`,
        });
        videoUrl = rehosted.url;
        console.log(`  ↳ Rehosted to Pinata: ${videoUrl.slice(0, 70)}`);
      }
      const generationId = randomUUID();

      await db.collection('videoGenerations').doc(generationId).set({
        id: generationId,
        prompt: scene.prompt,
        fullPrompt: scene.prompt,
        model: MODEL,
        mode: 'text_to_video',
        videoUrl,
        status: 'completed',
        universeId: UNIVERSE_ID,
        creatorUid: CREATOR,
        sceneId: scene.id,
        sceneTitle: scene.title,
        episodeTitle: EPISODE_TITLE,
        durationSec: 8,
        hasAudio: scene.hasDialogue,
        createdAt: new Date(),
        completedAt: new Date(),
      });

      await db.collection('content').add({
        title: `First Proof — ${scene.title}`,
        description: scene.prompt.slice(0, 300),
        mediaUrl: videoUrl,
        mediaType: 'ai-video',
        classification: 'original',
        tags: ['dostopia', 'first-proof', 'the-unfinished', 'episode', `scene-${scene.id}`],
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
        generationId,
        generationModel: MODEL,
      });

      console.log(`  SUCCESS: ${videoUrl.slice(0, 80)}...\n`);
      success++;

      if (SCENES.indexOf(scene) < SCENES.length - 1) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (e: any) {
      console.error(`  FAILED: ${e.message}\n`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  Retry complete: ${success} success, ${failed} failed`);
  console.log(`${'='.repeat(50)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
