/**
 * THE VACATION BUNNY UNIVERSE — Pilot: "Butterfly Days in Cannes"
 *
 * Story by YOONJEONG HAN. Dialogue-free. Pixar-style kids' show.
 * Character + prop rules are LOCKED into every prompt.
 *
 * ~50 scenes × 10s = ~8.3 min core footage + music/crossfades = ~10 min final.
 *
 * Prerequisites:
 *   - Universe deployed (create-vacation-bunny.ts) → export BUNNY_ADDR
 *   - Wiki populated (vacation-bunny-wiki.ts)
 *   - Server running (pnpm dev:server)
 *
 * Modes:
 *   GEN_MODE=continuity — sequential i2v, each scene starts from the last
 *                         frame of the previous scene. Slower but cohesive.
 *   GEN_MODE=fast        — parallel t2v batches of BATCH_SIZE. Much faster.
 *
 * Usage:
 *   BUNNY_ADDR=0x... GEN_MODE=continuity pnpm tsx scripts/vacation-bunny-episode.ts
 *   BUNNY_ADDR=0x... GEN_MODE=fast BATCH_SIZE=5 pnpm tsx scripts/vacation-bunny-episode.ts
 *
 * Resume: START_SCENE=S14 env.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  decodeEventLog,
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { execSync } from 'child_process';
import fs from 'fs';
import { tmpdir } from 'os';
import { rehostVideoToPinata } from './lib/rehost-video';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

const UNIVERSE_ADDR = (process.env.BUNNY_ADDR ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const START_SCENE = process.env.START_SCENE ?? 'S01';
const GEN_MODE = (process.env.GEN_MODE ?? 'continuity') as 'continuity' | 'fast';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '5', 10);
const RESUME_FRAME = process.env.RESUME_FRAME ?? '';

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Auth ─────────────────────────────────────────────────────────────────
async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const message = [
    `localhost wants you to sign in with your Ethereum account:`,
    getAddress(account.address),
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:3001`,
    `Version: 1`,
    `Chain ID: ${sepolia.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
    body: JSON.stringify({ message, signature }),
  });
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
}

// ── On-chain ABI ─────────────────────────────────────────────────────────
const universeAbi = [
  {
    type: 'function',
    name: 'createNode',
    inputs: [
      { name: '_contentHash', type: 'bytes32' },
      { name: '_plotHash', type: 'bytes32' },
      { name: '_previous', type: 'uint256' },
      { name: '_link', type: 'string' },
      { name: '_plot', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'latestNodeId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'NodeCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'previous', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'contentHash', type: 'bytes32', indexed: false },
      { name: 'plotHash', type: 'bytes32', indexed: false },
      { name: 'link', type: 'string', indexed: false },
      { name: 'plot', type: 'string', indexed: false },
    ],
  },
] as const;

// ── Frame extraction for scene continuity ───────────────────────────────
async function extractLastFrame(videoUrl: string, label: string): Promise<string | null> {
  try {
    const tmpFile = `${tmpdir()}/bunny-frame-${Date.now()}.jpg`;
    const tmpVid = `${tmpdir()}/bunny-vid-${Date.now()}.mp4`;
    const dlRes = await fetch(videoUrl);
    if (!dlRes.ok) return null;
    fs.writeFileSync(tmpVid, Buffer.from(await dlRes.arrayBuffer()));
    execSync(`ffmpeg -y -sseof -0.1 -i "${tmpVid}" -frames:v 1 -q:v 2 "${tmpFile}" 2>/dev/null`, {
      timeout: 15_000,
    });
    fs.unlinkSync(tmpVid);
    if (!fs.existsSync(tmpFile)) return null;
    const frameBuffer = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    log(label, `Extracted frame (${(frameBuffer.length / 1024).toFixed(0)}KB)`);

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      return `data:image/jpeg;base64,${frameBuffer.toString('base64')}`;
    }
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([frameBuffer], { type: 'image/jpeg' }),
      `frame-${Date.now()}.jpg`
    );
    formData.append('pinataMetadata', JSON.stringify({ name: `bunny-frame-${label}` }));
    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: formData,
    });
    if (!pinataRes.ok) return null;
    const { IpfsHash } = (await pinataRes.json()) as { IpfsHash: string };
    const gateway = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
    return `${gateway}/ipfs/${IpfsHash}`;
  } catch (err: any) {
    log(label, `Frame extraction failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

// ── Prompt sanitizer: strips brand words that trigger copyright filter ──
function sanitizePrompt(prompt: string, attempt: number): string {
  if (attempt === 0) return prompt;
  let p = prompt
    .replace(/Pixar-style/gi, 'premium 3D animated feature')
    .replace(/Pixar/gi, 'premium 3D animation');
  if (attempt >= 2) {
    p = p
      .replace(/Cannes/gi, 'a sunny Mediterranean town')
      .replace(/Croisette/gi, 'seaside promenade')
      .replace(/Château de Cannes/gi, 'an old stone castle')
      .replace(/Mediterranean/gi, 'sparkling blue');
  }
  return p;
}

// ── ByteDance Seedance 2.0 ─────────────────────────────────────────────
async function generateVideo(
  prompt: string,
  label: string,
  startImage?: string | null
): Promise<string> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const sanitized = sanitizePrompt(prompt, attempt);
    if (attempt > 0) log(label, `Retry ${attempt}/${MAX_RETRIES - 1} (sanitized)...`);
    else log(label, startImage ? 'Generating (i2v continuity)...' : 'Generating (t2v)...');

    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    if (startImage) content.push({ type: 'image_url', image_url: { url: startImage } });
    content.push({ type: 'text', text: sanitized });

    const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
      body: JSON.stringify({
        model: 'dreamina-seedance-2-0-260128',
        content,
        duration: 10,
        aspect_ratio: '16:9',
        resolution: '720p',
        generate_audio: false,
      }),
    });
    if (!taskRes.ok) {
      const errText = await taskRes.text().catch(() => '');
      if (
        startImage &&
        (errText.includes('PrivacyInformation') ||
          errText.includes('real person') ||
          errText.includes('SensitiveContent'))
      ) {
        log(label, 'Frame rejected — falling back to t2v');
        startImage = null;
        continue;
      }
      throw new Error(`ByteDance ${taskRes.status}: ${errText.slice(0, 200)}`);
    }
    const { id: taskId } = (await taskRes.json()) as any;
    if (!taskId) throw new Error('No task ID');
    log(label, `Task: ${taskId}`);

    let blocked = false;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(`${BD_BASE}/contents/generations/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
      });
      if (!poll.ok) continue;
      const s = (await poll.json()) as any;
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

// ── On-chain node creation ─────────────────────────────────────────────
async function createNode(
  contentHash: string,
  plot: string,
  previousId: bigint,
  link: string,
  label: string
) {
  const chBytes = keccak256(toBytes(contentHash)) as `0x${string}`;
  const plotHash = keccak256(toBytes(plot));
  const txHash = await walletClient.writeContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'createNode',
    args: [chBytes, plotHash, previousId, link, plot],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== 'success') throw new Error('TX reverted');
  let nodeId = 0n;
  for (const l of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeAbi, data: l.data, topics: l.topics });
      if (d.eventName === 'NodeCreated') nodeId = BigInt((d.args as any).id);
    } catch {}
  }
  log(label, `Node #${nodeId}`);
  return nodeId;
}

// ── Scene definitions ───────────────────────────────────────────────────
function buildScenes() {
  // ── Locked character & world DNA (injected into every prompt) ──
  const STYLE =
    'Pixar-style 3D animated kids show, soft painterly textures, cinematic lighting, soft depth of field, dreamy glow, warm pastel palette, emotional storytelling, child-friendly, no text no watermark.';

  const JUDY =
    'JUDY: tall adult mother bunny, soft white fluffy fur, deep purple eyes, long floppy ears. Wearing a dark navy-purple silky sleeveless knee-length dress with soft sheen. A tiny WHITE butterfly pendant on a delicate silver chain rests on her chest (never removed, moves with her breath).';

  const BABY =
    'BABY BUNNY: small toddler bunny, soft cream-yellow fur, bright purple eyes, short round ears, adorable tiny stature. Wearing a baby-yellow long-sleeve tutu dress that flares when she moves, with a small sparkly silver tiara between her ears. A tiny PURPLE butterfly pendant on a delicate silver chain rests on her chest (never removed).';

  const JUDY_SLEEP =
    'JUDY: soft white fluffy fur, deep purple eyes, wearing a light soft lavender sleep set. NO pendant during sleep.';

  const BABY_SLEEP =
    'BABY BUNNY: cream-yellow fur, bright purple eyes, wearing a pastel pink and buttery yellow two-piece pajama set. NO tiara (placed on bedside table). NO pendant during sleep.';

  const BABY_OLDER =
    'OLDER BABY BUNNY (after-credits): slightly taller young-teen bunny, same cream-yellow fur, same bright purple eyes, wearing a fitted baby-yellow dress (no tutu puff), NO tiara. Still wearing the tiny purple butterfly pendant on a silver chain.';

  const APARTMENT =
    'The Cannes apartment: cozy top-floor French Riviera interior. White wooden bed with pastel pink and yellow linens. Antique full-length gold-framed mirror. Tall French window with soft white curtains opening to Mediterranean sea view. Warm apricot morning light or soft blue moonlight.';

  const BAKERY =
    'La Petite Boulangerie: tiny charming Cannes bakery. Pale pink striped awning, gold script lettering. Glass pastry case of golden croissants and rainbow macarons. Copper espresso machine on marble counter.';

  const BEACH =
    'Parasol Beach Restaurant: luxury Cannes beachfront dining. Buttery-yellow parasols over wooden deck tables with crisp white linen cloths. Turquoise Mediterranean sea lapping white sand below. Crystal glasses, sailboats in the distance.';

  const CASTLE =
    'Château de Cannes: medieval stone castle on a hill above old-town Cannes. Warm sunlit beige stone. Tall circular watchtower with narrow windows and spiral stone staircase inside. Mediterranean view in the distance. Cypress trees.';

  const CAROUSEL =
    'Night Carousel: magical seaside carousel on the Cannes promenade at night. Warm incandescent bulbs lining every arch. Pastel and gold horses, including one POLISHED BLACK WOODEN HORSE with gold trim. Soap bubbles floating through the air catching carousel light. Palm trees silhouetted against navy night sky.';

  const GELATO =
    'Glacerie Riviera: tiny charming Cannes gelato shop. Pale mint-green walls. Curved glass display case of colorful gelato in rainbow order. Gold mini-spoons, waffle cones in wicker basket. Warm evening light.';

  const PROMENADE =
    'Cannes Croisette oceanfront promenade: tall palm trees, pale stone balustrade, Mediterranean sea. Golden hour warm peach light or soft evening lamp glow.';

  const PENDANTS =
    'Key prop: two tiny butterfly pendants — one WHITE enamel worn by Judy, one PURPLE enamel worn by Baby Bunny, each on delicate silver chains. They catch light during emotional moments.';

  // ── 50 scenes across 7 acts + after-credits ──
  return [
    // ═══════════════════════════════════════════════════════════════════════
    // SCENE 1 — MORNING MAGIC (0:00–1:30) — Soft piano
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S01',
      title: 'Morning Light Floods the Apartment',
      plot: 'WS: warm sunlight fills the cozy Cannes apartment. The day begins in gentle silence.',
      prompt: `${STYLE} ${APARTMENT} Wide establishing shot of the Cannes apartment as warm apricot morning sunlight pours through the tall French window and soft white curtains billow gently. The room slowly brightens — the pastel bed, the antique mirror reflecting sunlight, the bedside table. Two small sleeping shapes under pastel pink covers on the bed. Soft slow camera push-in. Quiet, peaceful, the day beginning. No dialogue, pure visual tenderness.`,
    },
    {
      id: 'S02',
      title: 'Baby Bunny Asleep — Pendant on Chest',
      plot: 'CU of Baby Bunny asleep in her pastel pajamas. The purple pendant rests naturally on her chest. Tiara placed carefully on the bedside table.',
      prompt: `${STYLE} ${BABY_SLEEP} ${APARTMENT} Extreme close-up of Baby Bunny sleeping peacefully, cheek squished against a soft pillow. Her tiny purple butterfly pendant is OFF her neck, resting on the bedside table beside her sparkly silver tiara — both in soft morning light. Her pastel pink and yellow pajamas are slightly rumpled. Gentle breathing. Pure tenderness. Slow soft focus macro shot.`,
    },
    {
      id: 'S03',
      title: 'Judy Asleep — White Pendant on Table',
      plot: "CU of Judy asleep in soft sleepwear. Her white butterfly pendant rests on the bedside table next to her daughter's purple one.",
      prompt: `${STYLE} ${JUDY_SLEEP} ${APARTMENT} Close-up of Judy asleep, soft lavender sleep-set, one hand curled near her face, her long floppy ears splayed on the pillow. On the bedside table beside her: her tiny white butterfly pendant next to Baby Bunny's tiny purple butterfly pendant and the small silver tiara — all three catching a ray of morning light. Peaceful breathing. Slow macro shot of both pendants side by side on the table.`,
    },
    {
      id: 'S04',
      title: 'They Wake Up — Shared Smile',
      plot: 'Judy wakes and smiles. Baby Bunny wakes excitedly. They lock eyes. They hop out of bed together.',
      prompt: `${STYLE} ${JUDY_SLEEP} ${BABY_SLEEP} ${APARTMENT} Medium shot on the bed. Judy's eyes flutter open first — soft smile as she looks over. Baby Bunny's eyes SNAP open, bright purple and instantly excited. They look at each other and both smile — that private shared mother-daughter smile. Then Baby Bunny bounces up on the mattress while Judy laughs silently and sits up. Warm morning light. Gentle waking joy.`,
    },
    {
      id: 'S05',
      title: 'Outfit Montage — Yellow Tutu & Navy Silky Dress',
      plot: 'Quick montage: Baby bunny choosing her yellow tutu, Judy putting on her navy silky dress, Baby bunny placing tiara back on. Pendants go on together.',
      prompt: `${STYLE} ${APARTMENT} Quick playful montage of outfit-picking. Baby Bunny (cream-yellow fur, bright purple eyes) holding up her baby-yellow tutu dress with excitement, then pulling it on, the tulle flaring. Judy (white fluffy fur, deep purple eyes) slipping into her dark navy-purple silky dress, smoothing the fabric. Baby Bunny placing her silver tiara carefully between her ears in the mirror. Both CLASPING their butterfly pendants on — white for Judy, purple for Baby Bunny — at the same moment, a little ceremony. Playful, joyful, warm morning light, cartoon montage energy.`,
    },
    {
      id: 'S06',
      title: 'Mirror Moment — Color Contrast',
      plot: 'OTS: Both stand in front of the antique mirror. Yellow vs. deep navy-purple. Pendants resting, catching the light.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${APARTMENT} Over-the-shoulder mirror shot. Baby Bunny in her baby-yellow tutu dress stands in front of Judy, who wears her dark navy-purple silky dress. The color contrast is striking — butter yellow against deep navy. Both look at their reflection with soft contentment. The white pendant on Judy's chest and the purple pendant on Baby Bunny's chest are clearly visible, catching a sparkle of morning light. Mirror reflection sharp and warm. Pixar-perfect emotional moment.`,
    },
    {
      id: 'S07',
      title: 'Sparkle Makeup — Judy Applies to Herself',
      plot: 'CU of Judy applying soft sparkle to her eyebrows. Baby bunny watches, fascinated.',
      prompt: `${STYLE} ${JUDY} ${APARTMENT} Close-up of Judy's face as she gently applies sparkle makeup along her eyebrow with a tiny soft brush. Her deep purple eyes are focused. Soft golden light catches the sparkle particles. Over her shoulder: Baby Bunny watching intently, bright purple eyes wide with fascination, cream-yellow fur slightly fluffy. Soft piano moment. Gentle, quiet, mother-daughter ritual.`,
    },
    {
      id: 'S08',
      title: 'Baby Bunny Gets Sparkle Too',
      plot: 'Baby Bunny excitedly gestures asking for makeup. Judy smiles warmly and adds sparkle to her eyebrows. Baby Bunny lights up.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${APARTMENT} Baby Bunny pointing excitedly at her own little brow, looking up at Judy with pleading bright purple eyes. Judy laughs silently, kneels down, and very gently applies soft sparkle to Baby Bunny's tiny brow with the soft brush. Close-up: Baby Bunny's face as the sparkle settles — her eyes widen with wonder, a huge smile breaks across her face. The purple butterfly pendant catches the sparkle light. Pure Pixar adorable-ness. Soft piano.`,
    },
    {
      id: 'S09',
      title: 'Mirror Selfie Playtime — Peace Sign & Spin',
      plot: 'Music becomes playful. Reflection shot centered. Peace sign, Baby Bunny spins (tutu flares), cheek-to-cheek, princess pose.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${APARTMENT} Centered mirror reflection — both bunnies framed. Quick playful cuts: Baby Bunny throwing a tiny peace sign with her paw, grinning. Baby Bunny SPINNING — her yellow tutu flaring beautifully, tiara sparkling, purple pendant swinging. Judy posing stylishly with a hand on hip. Cheek-to-cheek shot with huge smiles. Baby Bunny striking a princess pose, Judy mirroring it. Playful zoom pops, slight handheld energy, both pendants swaying. Cartoon joy. Playful upbeat music moment.`,
    },
    {
      id: 'S10',
      title: 'Shared Smile Beat',
      plot: 'They pause. A soft shared smile in the mirror. Necklaces rest, catching light.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${APARTMENT} The pause after the playful poses. Slow push-in on the mirror reflection. Judy and Baby Bunny look at each other's reflection — no more playing, just a soft quiet shared smile. The room is still. Baby Bunny's purple pendant and Judy's white pendant both resting on their chests, catching one ray of golden morning light, a tiny shimmer. Emotional warmth. The bond visible without words.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCENE 2 — BAKERY RITUAL (1:30–2:30) — Soft piano
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S11',
      title: 'Cannes Morning Street',
      plot: 'WS of the Cannes morning street. Judy and Baby Bunny walk hand-in-hand.',
      prompt: `${STYLE} ${JUDY} ${BABY} Wide tracking shot of a sunlit Cannes old-town street — terracotta rooftops, pastel shutters, a bougainvillea vine. Judy and Baby Bunny walk hand-in-hand down the street together, Baby Bunny's tutu bouncing with each small step, Judy's navy dress flowing. Both pendants visible. Their backs to camera, golden-hour morning light. Peaceful walking rhythm. No dialogue.`,
    },
    {
      id: 'S12',
      title: 'Bakery Interior — Latte & Milk',
      plot: 'Inside the bakery. CU of latte foam being poured. CU of milk poured into a small glass.',
      prompt: `${STYLE} ${BAKERY} Extreme close-up shots: golden latte foam swirling as steamed milk is poured. Then: a small glass cup filling with creamy white milk from a pitcher. Macro shots with shallow depth of field. Warm morning bakery atmosphere, soft copper-machine glow in background. No characters yet — pure sensory texture. Soft piano.`,
    },
    {
      id: 'S13',
      title: 'Pastry Wonder — Baby Bunny Reacts',
      plot: 'OTS shot of Baby Bunny reacting to the pastries, wide-eyed with wonder.',
      prompt: `${STYLE} ${BABY} ${BAKERY} Over-the-shoulder shot from behind Baby Bunny, standing on her tiptoes to peer into the glass pastry case. Reflection in the glass shows her face — bright purple eyes wide with wonder, mouth slightly open. Rainbow macarons, golden croissants, pain au chocolat glisten inside. Her tiny paw presses gently against the glass. The purple butterfly pendant catches the warm bakery light. Pure childlike wonder.`,
    },
    {
      id: 'S14',
      title: 'Croissant Shared',
      plot: 'Judy breaks a warm croissant in half. Baby Bunny claps happily with both paws.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${BAKERY} Medium shot at a small round bakery table. Judy gently breaks a golden flaky croissant in half, steam rising. Baby Bunny's tiny paws clap together with delight, her bright purple eyes sparkling. Judy hands her the larger piece with a soft smile. Warm light, buttery textures, the first bite moment. Both pendants visible. Gentle, heartwarming.`,
    },
    {
      id: 'S15',
      title: 'Milk Moustache — Watching',
      plot: 'Judy watches Baby Bunny drinking milk. A tiny milk moustache forms. Judy smiles.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${BAKERY} Close-up on Baby Bunny holding her small milk glass with both paws, drinking with intense concentration. A white milk moustache forms above her lip. She lowers the glass, revealing it — her bright purple eyes blink with delighted surprise. Pan to Judy watching across the table with a soft silent laugh, her face full of love. Both pendants resting on chests, morning light catching them. Precious wordless moment.`,
    },
    {
      id: 'S16',
      title: 'Pendants Catch Morning Light',
      plot: 'CU of both pendants resting on their chests, catching the morning light side by side.',
      prompt: `${STYLE} ${PENDANTS} ${BAKERY} Extreme macro close-up: the tiny white butterfly pendant on Judy's chest (navy silky dress fabric behind) and the tiny purple butterfly pendant on Baby Bunny's chest (baby-yellow tutu fabric behind), cross-cut together. Warm morning bakery light catches both, subtle shimmer on the enamel wings. Dreamy shallow depth of field. The silent visual theme of the show.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCENE 3 — LUXURY BEACH LUNCH (2:30–4:00) — Light orchestral
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S17',
      title: 'Beach Restaurant — Yellow Parasols',
      plot: 'WS of the beach restaurant with rows of yellow parasols. Ocean view.',
      prompt: `${STYLE} ${BEACH} Wide establishing shot of the luxury Cannes beach restaurant at lunchtime. Rows of buttery-yellow parasols shade white linen tables on a wooden deck. Turquoise Mediterranean sea laps white sand just beyond. Distant sailboats drift on the horizon. Warm midday sun. Crystal glasses gleam on tables. Peaceful seaside affluence. No characters yet. Light orchestral music moment.`,
    },
    {
      id: 'S18',
      title: 'Table Setup — Ocean View',
      plot: 'OTS ocean view from their corner table. Frites, a crystal cocktail, a crystal apple juice.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${BEACH} Over-the-shoulder shot from behind Judy and Baby Bunny seated side-by-side at a corner table, facing the ocean. The turquoise sea spreads out before them. On the white linen tablecloth: a plate of golden crisp frites (french fries), a crystal cocktail glass with soft pink drink for Judy, a crystal apple-juice glass for Baby Bunny. Their backs to camera, Judy's navy dress and Baby Bunny's yellow tutu framing the ocean view. Both pendants on chests. Idyllic vacation moment.`,
    },
    {
      id: 'S19',
      title: 'The Clink — Crystal Glasses',
      plot: "CU of Judy's cocktail glass and Baby Bunny's apple juice glass gently clinking. Pendants catch light.",
      prompt: `${STYLE} ${JUDY} ${BABY} ${BEACH} Tight macro close-up of two crystal glasses meeting — Judy's pink cocktail glass and Baby Bunny's crystal apple-juice glass. They TINK together gently. Micro droplets shimmer. In the soft bokeh, both their smiling faces are visible. Both pendants catch the sunlight in the soft background. Elegant silent cheers. Orchestral swell.`,
    },
    {
      id: 'S20',
      title: 'The Seagull Swoops',
      plot: 'A plump seagull swoops onto the table, snatches one fry, and stares.',
      prompt: `${STYLE} ${BEACH} Wide shot of the table mid-lunch. Suddenly — a plump scruffy cartoon Mediterranean seagull (large expressive eyes, orange beak, white-and-grey feathers) DROPS out of the sky and lands on the edge of the table with a comic thud. He GRABS one golden fry in his beak with impossible speed. He freezes, fry in beak, and looks directly at Baby Bunny with smug cheeky eyes. Time stops. Comic energy.`,
    },
    {
      id: 'S21',
      title: 'Baby Bunny Shocked',
      plot: 'CU of Baby Bunny, mouth open in total disbelief.',
      prompt: `${STYLE} ${BABY} ${BEACH} Extreme close-up of Baby Bunny's face — her mouth O-shaped in comic shock, her bright purple eyes enormous, her tiny paws frozen mid-reach for the fries. Her tiara trembles a little. The purple pendant catches the sun as she inhales sharply. Pure Pixar comic reaction timing.`,
    },
    {
      id: 'S22',
      title: 'Baby Bunny Rises Bravely',
      plot: 'Low-angle: Baby Bunny stands bravely on her chair, tiny paw raised.',
      prompt: `${STYLE} ${BABY} ${BEACH} Dramatic LOW ANGLE hero shot of Baby Bunny standing up on her wooden restaurant chair, her baby-yellow tutu flaring heroically. Her tiny paw is raised in a fist. Her face is set with princess-warrior determination — bright purple eyes blazing, silver tiara catching the sun like a crown, purple pendant swinging. Behind her: the smug seagull with the fry. Comic epic scale, cartoon hero pose. Light orchestral brass moment.`,
    },
    {
      id: 'S23',
      title: 'The Chase',
      plot: 'Tracking: Baby Bunny chases the seagull across the restaurant deck with tiny hops.',
      prompt: `${STYLE} ${BABY} ${BEACH} Tracking shot across the restaurant deck: Baby Bunny tiny-hopping as fast as she can after the plump seagull, who flaps away comically with the fry still in his beak. Her yellow tutu bounces with every hop, her tiara slightly tilted, her purple pendant flying. Other restaurant tables blur past. The seagull flaps heavily toward the ocean. Pure cartoon chase energy, hilarious determination. Light orchestral playful.`,
    },
    {
      id: 'S24',
      title: 'Resolution — Judy Laughs Silently',
      plot: 'Baby Bunny returns proud. Judy laughs silently, paw over her mouth.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${BEACH} Medium shot at the table. Baby Bunny walks back triumphantly, tiny chest puffed out, tutu bouncing. Across the table, Judy has her paw over her mouth, shoulders shaking in silent helpless laughter, deep purple eyes bright with joyful tears. Baby Bunny climbs back onto her chair with pride. Both pendants catching afternoon light. Shared delight, wordless mother-daughter moment. Soft orchestral resolution.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCENE 4 — CASTLE & TOWER (4:00–6:00) — Light orchestral → emotional
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S25',
      title: 'The Castle on the Hill',
      plot: 'WS of the Château de Cannes on its hill.',
      prompt: `${STYLE} ${CASTLE} Wide establishing shot from below: the picturesque medieval stone castle of old-town Cannes perched high on the hill, warm beige stone glowing in afternoon sun, the tall circular watchtower rising above cypress trees. The Mediterranean sea sparkles in the background. Cinematic low-angle hero establishing shot. Light orchestral building.`,
    },
    {
      id: 'S26',
      title: 'Walking Up Hand-in-Hand',
      plot: 'Tracking: Judy and Baby Bunny walking up the stone path together.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Side tracking shot of Judy and Baby Bunny walking hand-in-hand up worn stone steps lined with cypress trees, the castle rising ahead. Baby Bunny looks up in amazement at the huge walls, bright purple eyes wide. Judy smiles down at her. Both pendants visible, bouncing slightly with each step. Warm sunset-gold light filtering through cypresses. Soft orchestral hope.`,
    },
    {
      id: 'S27',
      title: 'Baby Bunny Amazed',
      prompt: `${STYLE} ${BABY} ${CASTLE} Close-up of Baby Bunny's face tilted all the way up, mouth slightly open with awe, bright purple eyes reflecting the enormous castle walls above her. The tiara catches sun, the purple pendant glints. The camera slowly circles behind her head and tilts up, revealing what she sees — the tall circular watchtower rising into the blue sky. Pure childlike wonder at scale.`,
      plot: 'CU of Baby Bunny amazed. Reveal of the tower above.',
    },
    {
      id: 'S28',
      title: 'Spiral Staircase Climb',
      plot: 'Spiral upward shot inside the tower as they climb.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Dramatic spiral UPWARD shot looking up through the center of a stone spiral staircase inside the watchtower. Tiny figures of Judy and Baby Bunny visible far below on the steps, holding hands, climbing steadily. Narrow medieval windows let in shafts of golden afternoon light. The spiral twists up and up. Baby Bunny's yellow tutu is the brightest thing in the stone tower. Epic scale, tender climb. Orchestral building.`,
    },
    {
      id: 'S29',
      title: 'Small Steps Climbing',
      plot: 'CU of their small steps on stone.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Low macro close-up on the worn medieval stone steps. Baby Bunny's tiny feet take careful hops, one step at a time, her yellow tutu hem brushing stone. Judy's slightly larger feet follow patiently behind in her navy-purple dress hem. A beam of warm light cuts across the stone. Quiet determination, small victories. Soft orchestral.`,
    },
    {
      id: 'S30',
      title: 'Princess Spin — Tutu Expands',
      plot: 'Slow-motion spin. Yellow tutu expands beautifully in a shaft of sunlight.',
      prompt: `${STYLE} ${BABY} ${CASTLE} Inside the tower on a landing, a shaft of golden afternoon sunlight pours through a narrow arrow-slit window. Baby Bunny steps into the light and SPINS in SLOW MOTION. Her baby-yellow tutu expands like a blooming flower, the tulle glowing translucent in the sunbeam, dust motes dancing. Her tiara sparkles, her purple pendant floats outward from her chest, her face is turned up with pure joy. Transcendent Pixar moment. Orchestral soaring.`,
    },
    {
      id: 'S31',
      title: '360° Top of Tower',
      plot: 'WS 360° Cannes view from the top of the tower.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Spectacular WIDE 360° shot: top of the stone watchtower, panoramic view of all of Cannes and the Mediterranean coast spread below — pastel rooftops, the curving Croisette, the turquoise sea stretching to the horizon, distant islands. Judy and Baby Bunny standing together on the parapet, tiny silhouettes against the huge sky. Baby Bunny with arms spread wide, yellow tutu rippling in the breeze. Epic, breathtaking. Orchestral climax.`,
    },
    {
      id: 'S32',
      title: "Judy's Emotional Moment",
      plot: 'CU of Judy with slight tears. She kisses Baby Bunny on the head.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Close-up on Judy's face at the top of the tower. Her deep purple eyes are shining — the faintest sheen of tears. She looks down at Baby Bunny next to her with overwhelming love. She bends and presses a soft slow kiss to the top of Baby Bunny's head between her ears. Baby Bunny closes her eyes and holds tight to Judy's dress. Wind gently moves both their ears. Both pendants catch the sun brightly, shimmering. The emotional peak of the episode. Pure silent love.`,
    },
    {
      id: 'S33',
      title: 'Pendants Side-by-Side — Soft Glow',
      plot: 'Key shot: pendants side-by-side with a soft glow.',
      prompt: `${STYLE} ${PENDANTS} ${CASTLE} Extreme macro close-up of the two butterfly pendants — white on Judy's chest, purple on Baby Bunny's chest — as they stand embracing on the tower. The pendants are SIDE BY SIDE in the frame, their wings almost touching. A warm golden light radiates from the space between them — a subtle magical glow, the visual soul of the show. Mediterranean horizon blurred in background. Single held emotional image. Orchestral sustain.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCENE 5 — CAROUSEL NIGHTS (6:00–7:30) — Dreamy waltz
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S34',
      title: 'Night Carousel Glow',
      plot: 'WS: the night carousel glowing, bubbles floating.',
      prompt: `${STYLE} ${CAROUSEL} Wide magical establishing shot of the glowing Cannes seaside carousel at night. Warm incandescent bulbs line every arch. Pastel and gold horses in mid-rotation. Iridescent soap bubbles drift through the air catching the lights. Palm trees silhouetted against a deep navy sky. The Mediterranean glints darkly behind. Enchanted fairytale atmosphere. Dreamy waltz music begins.`,
    },
    {
      id: 'S35',
      title: 'Baby Bunny Runs to Carousel',
      plot: 'Tracking: Baby Bunny runs excitedly toward the carousel.',
      prompt: `${STYLE} ${BABY} ${CAROUSEL} Tracking shot following Baby Bunny from behind as she RUNS excitedly toward the glowing carousel, her baby-yellow tutu bouncing wildly, tiara tilted, purple pendant flying. Bubbles drift around her. The carousel lights reflect in her path. Pure childhood excitement. Dreamy waltz lifts.`,
    },
    {
      id: 'S36',
      title: 'She Points — the Black Horse',
      plot: 'CU: Baby Bunny points to the black horse with gold trim.',
      prompt: `${STYLE} ${BABY} ${CAROUSEL} Close-up of Baby Bunny at the carousel edge, her tiny paw extending in an excited point. The camera follows her point — and there, mid-rotation, is the POLISHED BLACK WOODEN HORSE with gold trim, glossy and regal among the pastel horses. Her bright purple eyes lock onto it. Her pendant swings with her pointing motion. Decisive, she has chosen. Waltz builds.`,
    },
    {
      id: 'S37',
      title: 'The Ride — Circular Camera',
      plot: 'Circular camera motion around Baby Bunny on the black horse.',
      prompt: `${STYLE} ${BABY} ${CAROUSEL} Slow magical CIRCULAR CAMERA motion around Baby Bunny seated on the glossy black horse mid-ride. Her face is lit alternately by warm amber carousel bulbs and cool blue night sky. Her yellow tutu billows as the horse rises and falls. Her tiny paws grip the gold pole. Bright purple eyes reflecting carousel lights. Purple pendant glowing. Bubbles drift past her face. Pure magic. Dreamy waltz swells.`,
    },
    {
      id: 'S38',
      title: 'Judy Joins — Mother Rides Too',
      prompt: `${STYLE} ${JUDY} ${BABY} ${CAROUSEL} Over-the-shoulder shot from Judy watching from the edge — then Judy's silent grin as she decides. Cut to: Judy elegantly climbing onto the white horse next to Baby Bunny's black one, mid-rotation. Navy silky dress flowing. Their eyes meet across the horses, both grinning. Baby Bunny laughs silently with delight. Both pendants catch carousel light. Slow dreamy motion.`,
      plot: 'OTS Judy decides. Cut to Judy on the white horse beside Baby Bunny.',
    },
    {
      id: 'S39',
      title: 'Slow-Mo Bubbles and Glowing Dress',
      plot: 'Slow-motion: bubbles + glowing tutu. Zoom out to drone carousel shot.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${CAROUSEL} Extreme slow-motion beat: iridescent soap bubbles drifting past Baby Bunny's face, each bubble catching carousel light with rainbow reflections. Her baby-yellow tutu glows translucent from the internal carousel lighting. She turns her face up to the bubbles, laughing silently. Then the camera pulls BACK AND UP — a drone shot revealing the entire carousel from above, spinning in the night, palm trees around it, the dark sea behind. The whole glowing jewel of a scene. Waltz climax.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCENE 6 — GELATO EVENING (7:30–8:30) — Emotional piano
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S40',
      title: 'Gelato Case — Matcha & Chocolate',
      plot: 'CU: matcha & chocolate gelato in the display case.',
      prompt: `${STYLE} ${GELATO} Close-up macro shot into the curved gelato display glass: scoops of vibrant green matcha gelato and rich dark chocolate gelato side by side, perfectly textured, reflective. Gold spoons stacked beside. Warm evening light from the storefront. Food-photography beauty. Emotional piano begins.`,
    },
    {
      id: 'S41',
      title: 'Choosing Flavors',
      plot: 'OTS shot: Judy points matcha, Baby Bunny points chocolate.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${GELATO} Over-the-shoulder shot from behind the counter. Judy's paw points gracefully at the matcha. Baby Bunny's tiny paw points decisively at the chocolate. The gelato attendant (a friendly cartoon human or bunny, off-angle) scoops. Their reflections show soft smiles. Both pendants on chests. Warm evening amber light. Emotional piano swells softly.`,
    },
    {
      id: 'S42',
      title: 'Messy Chocolate — Judy Cleans',
      plot: 'Baby Bunny gets chocolate on her cheek. Judy gently cleans it.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${GELATO} Close-up medium shot outside the gelato shop. Baby Bunny has a streak of dark chocolate gelato on her cream-yellow cheek, still happily licking her scoop on a waffle cone. Judy, with her green matcha scoop in one paw, gently dabs the chocolate off Baby Bunny's cheek with a tiny napkin, the tenderest maternal gesture. Baby Bunny freezes mid-lick, grinning. Both pendants catch the lamplight. Quiet piano tenderness.`,
    },
    {
      id: 'S43',
      title: 'Sitting by the Ocean — Pendants Tap',
      plot: 'WS sitting by the ocean. Detail: their necklaces lightly tap as they lean together.',
      prompt: `${STYLE} ${JUDY} ${BABY} ${PROMENADE} ${PENDANTS} Wide shot of Judy and Baby Bunny seated side-by-side on a pale stone bench overlooking the Mediterranean at dusk. Judy with her matcha cone, Baby Bunny with her chocolate. Soft pink-orange evening sky reflecting on water. Then cut to macro close-up: as Baby Bunny leans her head against Judy's arm, their two butterfly pendants (white and purple) LIGHTLY TAP each other, a tiny chime of metal. The smallest most intimate moment. Piano gentle.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCENE 7 — NIGHT REFLECTION (8:30–10:00) — Emotional → minimal ambient
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S44',
      title: 'Quiet Apartment at Night',
      plot: 'WS: quiet apartment in soft moonlight.',
      prompt: `${STYLE} ${APARTMENT} Wide interior shot of the Cannes apartment at night. Soft silver-blue moonlight streams through the tall French window onto the white bed with pastel linens. A small bedside lamp glows warmly. Everything is hushed. The antique mirror reflects the moonlight. Peaceful, sacred stillness. Emotional piano fading to minimal.`,
    },
    {
      id: 'S45',
      title: 'Baby Bunny Asleep in Pajamas',
      plot: 'CU of Baby Bunny asleep in pastel pajamas. Tiara on table. NO pendant.',
      prompt: `${STYLE} ${BABY_SLEEP} ${APARTMENT} Close-up of Baby Bunny sleeping curled on her side, pastel pajamas rumpled, cream-yellow fur soft in moonlight. Her cheek is pressed against her pillow, her little paw tucked under her chin. Her chest is BARE (NO pendant). On the bedside table beside her: her sparkly silver tiara resting neatly, and next to it — her tiny purple butterfly pendant. Gentle breathing. Moonlit peace. Piano hush.`,
    },
    {
      id: 'S46',
      title: 'Judy Watching — No Pendant',
      plot: 'OTS of Judy watching her sleep. Judy also not wearing the butterfly necklace.',
      prompt: `${STYLE} ${JUDY_SLEEP} ${APARTMENT} Over-the-shoulder shot: Judy sits on the edge of the bed in her soft lavender sleep-set, watching Baby Bunny sleep. Her white fluffy fur lit softly by moonlight. Her chest is BARE (NO pendant). Her deep purple eyes are full of quiet love — the kind only a mother has at the end of a perfect day. Her paw gently smooths the blanket. Emotional piano.`,
    },
    {
      id: 'S47',
      title: 'Memory Montage — Mirror, Bakery, Beach',
      plot: 'Montage: mirror selfies, bakery joy, beach bravery — flashing softly.',
      prompt: `${STYLE} Dreamy memory-montage sequence, soft crossfades: (1) the mirror selfie with Baby Bunny's peace sign and Judy smiling, (2) Baby Bunny's milk moustache at the bakery, (3) Baby Bunny standing on the restaurant chair chasing the seagull with her fist raised. Each image is softly glowing, slightly hazy, like a memory. Warm colors, emotional piano, rapid soft fades. The day replaying.`,
    },
    {
      id: 'S48',
      title: 'Memory Montage — Tower, Carousel',
      plot: 'Montage continues: tower view, carousel lights.',
      prompt: `${STYLE} Dreamy memory-montage continues, soft crossfades: (1) Judy kissing Baby Bunny's head at the top of the tower with both pendants shimmering, (2) Baby Bunny on the glossy black carousel horse with bubbles drifting past her glowing tutu, (3) the two pendants tapping on the ocean bench at sunset. Each image softly luminous. Emotional piano reaches its tenderest note. The last of the day's memories.`,
    },
    {
      id: 'S49',
      title: 'Final Shot — Two Pendants on Bedside',
      plot: 'CU: white + purple pendants resting close together on bedside table. Soft glow → fade to black.',
      prompt: `${STYLE} ${PENDANTS} ${APARTMENT} Final extreme macro close-up: the tiny WHITE butterfly pendant and the tiny PURPLE butterfly pendant resting side by side on the white wooden bedside table in soft moonlight. Their silver chains curl together. A tiny warm magical glow emanates from the space between them — a subtle shimmer that says: the bond stays, even when the pendants come off. The camera holds, holds, holds. Then slowly FADES TO BLACK. Minimal ambient, single piano note. The end of the day.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // TITLE CARD
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S50',
      title: 'Title Card — Butterfly Days in Cannes',
      plot: 'Title card: "Butterfly Days in Cannes". Story by YOONJEONG HAN.',
      prompt: `${STYLE} Black background. Soft handwritten-style golden script title appears letter by letter: "BUTTERFLY DAYS IN CANNES". Beneath it, in smaller elegant font, "Story by YOONJEONG HAN". Around the title, tiny silhouettes of butterflies drift gently upward, one white, one purple, glowing softly. Warm still closing card. Ambient piano held note.`,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // AFTER-CREDITS — "A MEMORY THAT STAYED" — Pixar-style callback
    // ═══════════════════════════════════════════════════════════════════════
    {
      id: 'S51',
      title: 'After-Credits — Older Baby Bunny at the Mirror',
      plot: 'Slightly older Baby Bunny stands at a mirror alone. Still wearing purple pendant.',
      prompt: `${STYLE} ${BABY_OLDER} An antique gold-framed mirror in a new room (cream walls, warm lamp). A slightly older Baby Bunny stands in front of it alone. Her cream-yellow fur is a little longer, she's taller, her yellow dress is more fitted (no tutu puff), NO tiara, but the tiny purple butterfly pendant is still on her chest. She meets her own gaze in the mirror with quiet confidence. Calm emotional tone, soft piano.`,
    },
    {
      id: 'S52',
      title: 'She Applies Her Own Sparkle Makeup',
      plot: 'She gently adds sparkle to her own eyebrows, the same way Judy once did.',
      prompt: `${STYLE} ${BABY_OLDER} Close-up of older Baby Bunny at the mirror, carefully lifting a tiny soft makeup brush to her own brow. She applies a soft line of sparkle along her eyebrow with the exact same careful motion Judy once used on her. Her bright purple eyes focused. The purple butterfly pendant on her chest catches the light. Soft piano. A ritual passed down.`,
    },
    {
      id: 'S53',
      title: 'Judy Appears Behind Her',
      plot: 'OTS: Judy appears behind her in the mirror. They look at each other in reflection.',
      prompt: `${STYLE} ${JUDY} ${BABY_OLDER} Over-the-shoulder mirror shot. The older Baby Bunny finishes her sparkle — and then Judy appears softly behind her, navy silky dress, white butterfly pendant still on her chest (never removed). Their eyes meet in the reflection. A slow soft shared smile passes between them — calmer, older, more meaningful than any morning mirror moment. The same bond, just grown. Emotional piano swells gently.`,
    },
    {
      id: 'S54',
      title: 'Final Callback Pose',
      plot: 'One soft, simple pose together. No longer playful — calm and meaningful.',
      prompt: `${STYLE} ${JUDY} ${BABY_OLDER} Mirror shot: Judy and older Baby Bunny stand cheek-to-cheek (she is almost as tall as Judy now) and do one soft simple pose together — a gentle smile, slightly tilted heads. Not playful like before — calm, meaningful, the grown-up echo of the morning mirror ritual. Both pendants visible, lightly touching. Quiet piano.`,
    },
    {
      id: 'S55',
      title: 'Beach at Sunrise — Walking Side-by-Side',
      plot: 'WS: beach at sunrise. They walk side-by-side, almost the same height.',
      prompt: `${STYLE} ${JUDY} ${BABY_OLDER} Wide shot of a pristine Mediterranean beach at sunrise — soft pink-gold sky, gentle waves, empty white sand. Judy and the older Baby Bunny walk side-by-side toward the camera (or away), almost the same height now. Judy's navy dress, the older Baby Bunny's fitted yellow dress. Their matching pendants visible. Their shadows stretch long on the sand behind them. Final ambient note.`,
    },
    {
      id: 'S56',
      title: 'Pendants Sway and Touch — Butterfly Glow',
      plot: 'CU: purple pendant + white pendant sway and lightly touch. Butterfly glow rises. Fade to black.',
      prompt: `${STYLE} ${PENDANTS} Macro close-up at chest height as they walk side by side on the sunrise beach: the white butterfly pendant (Judy's) and the purple butterfly pendant (older Baby Bunny's) sway with each step and GENTLY TOUCH at one moment, a tiny chime. Then — magically — a soft butterfly-shaped GLOW rises from between them, drifts upward toward the sunrise sky, a tiny white butterfly and a tiny purple butterfly silhouette rising together. The screen slowly FADES TO BLACK. Final held note. The story is over. The bond remains.`,
    },
  ];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  VACATION BUNNY — Pilot: "Butterfly Days in Cannes"');
  console.log("  Dialogue-free Pixar-style kids' show");
  console.log('  Story by YOONJEONG HAN');
  console.log(`  Seedance 2.0 → On-chain | Mode: ${GEN_MODE.toUpperCase()}`);
  console.log('═'.repeat(60));

  if (UNIVERSE_ADDR === '0x0000000000000000000000000000000000000000') {
    console.error('\n  ERROR: Set BUNNY_ADDR env var to the deployed universe address.');
    process.exit(1);
  }
  if (!BYTEDANCE_API_KEY) {
    console.error('\n  ERROR: BYTEDANCE_API_KEY not set.');
    process.exit(1);
  }

  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const SCENES = buildScenes();

  const startIdx = SCENES.findIndex((s) => s.id === START_SCENE);
  if (startIdx < 0) {
    console.error(`  ERROR: START_SCENE=${START_SCENE} not found.`);
    process.exit(1);
  }
  if (startIdx > 0) log('RESUME', `Skipping to ${START_SCENE} (${startIdx + 1}/${SCENES.length})`);

  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH`);

  const latestId = (await publicClient.readContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('SETUP', `Latest node: #${latestId}`);

  let previousId = latestId;
  const results: Array<{ id: string; title: string; nodeId: bigint; videoUrl: string }> = [];
  let lastFrameUrl: string | null = RESUME_FRAME || null;

  if (lastFrameUrl) log('RESUME', `Frame from previous run: ${lastFrameUrl}`);
  log(
    'MODE',
    GEN_MODE === 'continuity'
      ? 'CONTINUITY — sequential i2v chaining'
      : `FAST — parallel t2v batches of ${BATCH_SIZE}`
  );

  if (GEN_MODE === 'continuity') {
    for (let i = startIdx; i < SCENES.length; i++) {
      const scene = SCENES[i];
      const label = `${scene.id} (${i + 1}/${SCENES.length})`;

      console.log(`\n${'═'.repeat(55)}`);
      console.log(`  ${scene.id}: ${scene.title}`);
      console.log(`${'═'.repeat(55)}`);

      try {
        const ephemeralUrl = await generateVideo(scene.prompt, label, lastFrameUrl);
        log(label, `Rehosting to Pinata...`);
        const pin = await rehostVideoToPinata(ephemeralUrl, {
          filename: `bunny-${scene.id}.mp4`,
          pinName: `vacation-bunny/${scene.id}`,
        });
        log(label, `Pinned: ${pin.cid} (${(pin.size / 1024 / 1024).toFixed(1)}MB)`);
        const contentHash = `bunny-${scene.id}-${Date.now()}`;
        const nodeId = await createNode(contentHash, scene.plot, previousId, pin.url, label);
        previousId = nodeId;
        results.push({ id: scene.id, title: scene.title, nodeId, videoUrl: pin.url });
        log(label, `DONE — Node #${nodeId}`);
        lastFrameUrl = await extractLastFrame(pin.url, `${scene.id} FRAME`);
      } catch (err: any) {
        log(label, `FAILED: ${err.message?.slice(0, 200)}`);
      }

      if (i < SCENES.length - 1) await sleep(2000);
    }
  } else {
    for (let batchStart = startIdx; batchStart < SCENES.length; batchStart += BATCH_SIZE) {
      const batch = SCENES.slice(batchStart, Math.min(batchStart + BATCH_SIZE, SCENES.length));
      console.log(`\n${'═'.repeat(55)}`);
      console.log(
        `  BATCH: ${batch[0].id}–${batch[batch.length - 1].id} (${batch.length} parallel)`
      );
      console.log(`${'═'.repeat(55)}`);

      const videoResults = await Promise.allSettled(
        batch.map((scene, idx) => {
          const label = `${scene.id} (${batchStart + idx + 1}/${SCENES.length})`;
          const startImg = idx === 0 ? lastFrameUrl : null;
          return generateVideo(scene.prompt, label, startImg).then((url) => ({
            scene,
            url,
            label,
          }));
        })
      );

      let lastVideoUrl: string | null = null;
      for (let j = 0; j < videoResults.length; j++) {
        const result = videoResults[j];
        const scene = batch[j];
        const label = `${scene.id} (${batchStart + j + 1}/${SCENES.length})`;
        if (result.status === 'fulfilled') {
          try {
            log(label, `Rehosting to Pinata...`);
            const pin = await rehostVideoToPinata(result.value.url, {
              filename: `bunny-${scene.id}.mp4`,
              pinName: `vacation-bunny/${scene.id}`,
            });
            log(label, `Pinned: ${pin.cid} (${(pin.size / 1024 / 1024).toFixed(1)}MB)`);
            const contentHash = `bunny-${scene.id}-${Date.now()}`;
            const nodeId = await createNode(contentHash, scene.plot, previousId, pin.url, label);
            previousId = nodeId;
            results.push({
              id: scene.id,
              title: scene.title,
              nodeId,
              videoUrl: pin.url,
            });
            lastVideoUrl = pin.url;
            log(label, `DONE — Node #${nodeId}`);
          } catch (err: any) {
            log(label, `CHAIN FAILED: ${err.message?.slice(0, 200)}`);
          }
        } else {
          log(label, `VIDEO FAILED: ${(result.reason as Error)?.message?.slice(0, 200)}`);
        }
      }

      if (lastVideoUrl) {
        lastFrameUrl = await extractLastFrame(lastVideoUrl, `${batch[batch.length - 1].id} FRAME`);
      }

      log('BATCH', `Completed ${batch[0].id}–${batch[batch.length - 1].id}`);
      if (batchStart + BATCH_SIZE < SCENES.length) await sleep(2000);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  VACATION BUNNY — Pilot Generation Complete');
  console.log('═'.repeat(60));
  console.log(`  Scenes completed: ${results.length}/${SCENES.length - startIdx}`);
  console.log(
    `  Total footage: ~${results.length * 10}s (~${Math.round((results.length * 10) / 60)} min)`
  );
  if (results.length > 0) {
    console.log(`  Node chain: ${results.map((r) => `#${r.nodeId}`).join(' → ')}`);
  }
  console.log('');
  for (const r of results) {
    console.log(`  ${r.id} | ${r.title.padEnd(40)} | Node #${r.nodeId}`);
  }
  console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  Next: audio pipeline for music + SFX + final stitch\n`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
