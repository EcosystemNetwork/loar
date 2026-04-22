/**
 * One-shot repair: regenerate videos for Vacation Bunny nodes 2, 3, 4 via
 * Seedance, rehost to Pinata, and write `nodeMediaOverrides` docs so the UI
 * renders the fresh URLs.
 *
 * Why: these three nodes were minted with 24-hour-signed Seedance URLs that
 * have since expired (HTTP 403). The on-chain contentHash / event is immutable,
 * so we patch via the off-chain override collection — same pattern that
 * repin-bunny-node1.ts already uses for node 1.
 *
 * Prompts are inlined from scripts/vacation-bunny-episode.ts (the canonical
 * SCENES array). Copying rather than importing because the episode script
 * auto-executes main() on load.
 *
 * Usage: pnpm tsx scripts/regen-bunny-nodes-2-4.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import admin from 'firebase-admin';
import { rehostVideoToPinata } from './lib/rehost-video';

const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY;
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY =
  process.env.PINATA_GATEWAY_URL ?? 'https://peach-impressive-moth-978.mypinata.cloud';
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;
const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!BYTEDANCE_API_KEY) throw new Error('BYTEDANCE_API_KEY missing');
if (!PINATA_JWT) throw new Error('PINATA_JWT missing');
if (!FIREBASE_SERVICE_ACCOUNT && !FIREBASE_SERVICE_ACCOUNT_PATH) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH required');
}

const UNIVERSE_ADDR = '0x8e5cDdb763534Fe426766e4eB035449fB9e73913'.toLowerCase();
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

const STYLE =
  'Pixar-style 3D animated kids show, soft painterly textures, cinematic lighting, soft depth of field, dreamy glow, warm pastel palette, emotional storytelling, child-friendly, no text no watermark.';
const APARTMENT =
  'The Cannes apartment: cozy top-floor French Riviera interior. White wooden bed with pastel pink and yellow linens. Antique full-length gold-framed mirror. Tall French window with soft white curtains opening to Mediterranean sea view. Warm apricot morning light or soft blue moonlight.';
const JUDY_SLEEP =
  'JUDY: soft white fluffy fur, deep purple eyes, wearing a light soft lavender sleep set. NO pendant during sleep.';
const BABY_SLEEP =
  'BABY BUNNY: cream-yellow fur, bright purple eyes, wearing a pastel pink and buttery yellow two-piece pajama set. NO tiara (placed on bedside table). NO pendant during sleep.';

interface Scene {
  id: string;
  nodeId: number;
  title: string;
  prompt: string;
}

const SCENES: Scene[] = [
  {
    id: 'S02',
    nodeId: 2,
    title: 'Baby Bunny Asleep — Pendant on Chest',
    prompt: `${STYLE} ${BABY_SLEEP} ${APARTMENT} Extreme close-up of Baby Bunny sleeping peacefully, cheek squished against a soft pillow. Her tiny purple butterfly pendant is OFF her neck, resting on the bedside table beside her sparkly silver tiara — both in soft morning light. Her pastel pink and yellow pajamas are slightly rumpled. Gentle breathing. Pure tenderness. Slow soft focus macro shot.`,
  },
  {
    id: 'S03',
    nodeId: 3,
    title: 'Judy Asleep — White Pendant on Table',
    prompt: `${STYLE} ${JUDY_SLEEP} ${APARTMENT} Close-up of Judy asleep, soft lavender sleep-set, one hand curled near her face, her long floppy ears splayed on the pillow. On the bedside table beside her: her tiny white butterfly pendant next to Baby Bunny's tiny purple butterfly pendant and the small silver tiara — all three catching a ray of morning light. Peaceful breathing. Slow macro shot of both pendants side by side on the table.`,
  },
  {
    id: 'S04',
    nodeId: 4,
    title: 'They Wake Up — Shared Smile',
    prompt: `${STYLE} ${JUDY_SLEEP} ${BABY_SLEEP} ${APARTMENT} Medium shot on the bed. Judy's eyes flutter open first — soft smile as she looks over. Baby Bunny's eyes SNAP open, bright purple and instantly excited. They look at each other and both smile — that private shared mother-daughter smile. Then Baby Bunny bounces up on the mattress while Judy laughs silently and sits up. Warm morning light. Gentle waking joy.`,
  },
];

const REASON =
  'Node minted with a 24h-signed Seedance URL; regenerated and re-pinned to IPFS after the signature expired.';

function loadServiceAccount(): admin.ServiceAccount {
  if (FIREBASE_SERVICE_ACCOUNT) return JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  return JSON.parse(readFileSync(path.resolve(FIREBASE_SERVICE_ACCOUNT_PATH!), 'utf-8'));
}

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizePrompt(prompt: string, attempt: number): string {
  if (attempt === 0) return prompt;
  let p = prompt
    .replace(/Pixar-style/gi, 'premium 3D animated feature')
    .replace(/Pixar/gi, 'premium 3D animation');
  if (attempt >= 2) {
    p = p
      .replace(/Cannes/gi, 'a sunny Mediterranean town')
      .replace(/Mediterranean/gi, 'sparkling blue');
  }
  return p;
}

async function generateVideo(prompt: string, label: string): Promise<string> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const sanitized = sanitizePrompt(prompt, attempt);
    log(label, attempt === 0 ? 'Generating (t2v)...' : `Retry ${attempt} (sanitized)...`);

    const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
      body: JSON.stringify({
        model: 'dreamina-seedance-2-0-260128',
        content: [{ type: 'text', text: sanitized }],
        duration: 10,
        aspect_ratio: '16:9',
        resolution: '720p',
        generate_audio: false,
      }),
    });
    if (!taskRes.ok) {
      const errText = await taskRes.text().catch(() => '');
      throw new Error(`ByteDance ${taskRes.status}: ${errText.slice(0, 200)}`);
    }
    const { id: taskId } = (await taskRes.json()) as { id?: string };
    if (!taskId) throw new Error('No task ID');
    log(label, `Task: ${taskId}`);

    let blocked = false;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(`${BD_BASE}/contents/generations/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
      });
      if (!poll.ok) continue;
      const s = (await poll.json()) as {
        status?: string;
        content?: { video_url?: string };
        output?: { video_url?: string };
        error?: { message?: string };
      };
      const st = s.status?.toLowerCase();
      if (st === 'succeeded' || st === 'completed') {
        const url = s.content?.video_url || s.output?.video_url;
        if (!url) throw new Error('No video URL');
        log(label, 'Video done');
        return url;
      }
      if (st === 'failed' || st === 'error') {
        const msg = s.error?.message || 'failed';
        if (msg.includes('copyright') || msg.includes('restrictions')) {
          blocked = true;
          break;
        }
        throw new Error(msg);
      }
      if (i % 6 === 0) log(label, `Generating... (${i * 5}s)`);
    }
    if (!blocked) throw new Error('Timeout');
    await sleep(2000);
  }
  throw new Error('All retries exhausted');
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  }
  const db = admin.firestore();

  const results: Array<{ scene: Scene; videoLink: string }> = [];

  for (const scene of SCENES) {
    const label = `${scene.id} (node ${scene.nodeId})`;
    console.log(`\n${'═'.repeat(55)}\n  ${scene.id}: ${scene.title}\n${'═'.repeat(55)}`);

    const ephemeralUrl = await generateVideo(scene.prompt, label);
    log(label, 'Rehosting to Pinata...');
    const pin = await rehostVideoToPinata(ephemeralUrl, {
      filename: `bunny-${scene.id}.mp4`,
      pinName: `vacation-bunny/${scene.id}-regen`,
      gatewayUrl: PINATA_GATEWAY,
    });
    log(label, `Pinned: ${pin.cid} (${(pin.size / 1024 / 1024).toFixed(1)}MB)`);

    const docId = `${UNIVERSE_ADDR}:${scene.nodeId}`;
    await db.collection('nodeMediaOverrides').doc(docId).set(
      {
        universeAddress: UNIVERSE_ADDR,
        nodeId: scene.nodeId,
        videoLink: pin.url,
        reason: REASON,
        updatedAt: new Date(),
        updatedBy: 'regen-bunny-nodes-2-4.ts',
      },
      { merge: true }
    );
    log(label, `Override written: nodeMediaOverrides/${docId}`);
    results.push({ scene, videoLink: pin.url });
  }

  console.log(
    `\n${'═'.repeat(55)}\n  DONE — ${results.length}/${SCENES.length} regenerated\n${'═'.repeat(55)}`
  );
  for (const r of results) {
    console.log(`  ${r.scene.id} | node ${r.scene.nodeId} | ${r.videoLink}`);
  }
}

main().catch((e) => {
  console.error('[regen] FAILED:', e);
  process.exit(1);
});
