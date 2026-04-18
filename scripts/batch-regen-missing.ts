/**
 * Batch regeneration of missing scene videos.
 *
 * Reads the master scene list from vacation-bunny-episode.ts, filters to those
 * NOT present in ./vacation-bunny-output/videos/, regenerates each via
 * ByteDance Seedance 2.0 with the proven sanitizer, pins to Pinata, and
 * creates a fresh on-chain node so the audio pipeline can discover them.
 *
 * Usage: BUNNY_ADDR=0x... pnpm tsx scripts/batch-regen-missing.ts
 * Env: PRIVATE_KEY, BYTEDANCE_API_KEY, PINATA_JWT, PINATA_GATEWAY_URL, RPC_URL
 * Opt: VB_MISSING (CSV override), VB_BATCH (default 3)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  decodeEventLog,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const BD_KEY = process.env.BYTEDANCE_API_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';
const BUNNY_ADDR = (process.env.BUNNY_ADDR ?? '') as `0x${string}`;
const BATCH = parseInt(process.env.VB_BATCH ?? '3', 10);
const VIDEOS_DIR = './vacation-bunny-output/videos';

if (!BUNNY_ADDR) throw new Error('BUNNY_ADDR required');
if (!BD_KEY) throw new Error('BYTEDANCE_API_KEY required');
if (!PINATA_JWT) throw new Error('PINATA_JWT required');

const account = privateKeyToAccount(PRIVATE_KEY);
const pc = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wc = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const BD = 'https://ark.ap-southeast.bytepluses.com/api/v3';

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
      { name: 'contentHash', type: 'bytes32' },
      { name: 'plotHash', type: 'bytes32' },
      { name: 'link', type: 'string' },
      { name: 'plot', type: 'string' },
    ],
  },
] as const;

function log(tag: string, msg: string) {
  console.log(`[${tag}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Load scene defs from episode script ────────────────────────────────
// We re-declare them here to avoid import-path TS complexity. Keep in sync.
const STYLE =
  'premium 3D animated kids show, soft painterly textures, cinematic lighting, soft depth of field, dreamy glow, warm pastel palette, emotional storytelling, child-friendly, no text no watermark.';

const JUDY =
  'JUDY: tall adult mother bunny, soft white fluffy fur, deep purple eyes, long floppy ears. Wearing a dark navy-purple silky sleeveless knee-length dress with soft sheen. A tiny WHITE butterfly pendant on a delicate silver chain rests on her chest (never removed).';
const BABY =
  'BABY BUNNY: small toddler bunny, soft cream-yellow fur, bright purple eyes, short round ears, adorable tiny stature. Wearing a baby-yellow long-sleeve tutu dress that flares when she moves, with a small sparkly silver tiara between her ears. A tiny PURPLE butterfly pendant on a delicate silver chain rests on her chest (never removed).';
const JUDY_SLEEP =
  'JUDY: soft white fluffy fur, deep purple eyes, wearing a light soft lavender sleep set. NO pendant during sleep.';
const BABY_SLEEP =
  'BABY BUNNY: cream-yellow fur, bright purple eyes, wearing a pastel pink and buttery yellow pajama set. NO tiara (placed on bedside table). NO pendant during sleep.';
const BABY_OLDER =
  'OLDER BABY BUNNY (after-credits): slightly taller young-teen bunny, same cream-yellow fur, same bright purple eyes, wearing a fitted baby-yellow dress (no tutu puff), NO tiara. Still wearing the tiny purple butterfly pendant on a silver chain.';

const APARTMENT =
  'Cozy top-floor French Riviera apartment interior. White wooden bed with pastel pink and yellow linens. Antique full-length gold-framed mirror. Tall French window with soft white curtains opening to a sparkling blue sea view.';
const BEACH =
  'Luxury sunny seaside restaurant. Buttery-yellow parasols over wooden deck tables with crisp white linen cloths. Turquoise sea lapping white sand below. Crystal glasses, sailboats in the distance.';
const CASTLE =
  'Medieval old stone castle on a hill. Warm sunlit beige stone. Tall circular stone watchtower with narrow windows and spiral stone staircase inside. Cypress trees.';
const CAROUSEL =
  'Magical seaside carousel on a seaside promenade at night. Warm incandescent bulbs lining every arch. Pastel and gold horses, including one POLISHED BLACK WOODEN HORSE with gold trim. Soap bubbles floating through the air catching carousel light. Palm trees silhouetted against navy night sky.';
const GELATO =
  'Tiny charming gelato shop. Pale mint-green walls. Curved glass display case of colorful gelato in rainbow order. Gold mini-spoons, waffle cones in wicker basket. Warm evening light.';
const PROMENADE =
  'Seaside oceanfront promenade: tall palm trees, pale stone balustrade, sparkling sea. Golden hour warm peach light or soft evening lamp glow.';
const PENDANTS =
  'Two tiny butterfly pendants — one WHITE worn by Judy, one PURPLE worn by Baby Bunny, each on delicate silver chains. They catch light during emotional moments.';

interface Scene {
  id: string;
  title: string;
  plot: string;
  prompt: string;
}

// 56 scenes, keyed by ID (only the prompts for missing scenes need be perfect)
const ALL_SCENES: Record<string, Scene> = {
  S22: {
    id: 'S22',
    title: 'Baby Bunny Rises Bravely',
    plot: 'Low-angle: Baby Bunny stands bravely on her chair, tiny paw raised.',
    prompt: `${STYLE} ${BABY} ${BEACH} Dramatic LOW ANGLE hero shot of Baby Bunny standing up on her wooden restaurant chair, her baby-yellow tutu flaring heroically. Her tiny paw is raised in a fist. Her face is set with princess-warrior determination — bright purple eyes blazing, silver tiara catching the sun, purple pendant swinging. Behind her: a cheeky cartoon seabird. Comic epic scale, cartoon hero pose.`,
  },
  S23: {
    id: 'S23',
    title: 'The Chase',
    plot: 'Tracking: Baby Bunny chases the seagull across the restaurant deck with tiny hops.',
    prompt: `${STYLE} ${BABY} ${BEACH} Tracking shot across the restaurant deck: Baby Bunny tiny-hopping as fast as she can after a plump cartoon seabird, who flaps away comically with a french fry in his beak. Her yellow tutu bounces with every hop, her tiara slightly tilted, her purple pendant flying. Other restaurant tables blur past. The seabird flaps heavily toward the sea. Pure cartoon chase energy, hilarious determination.`,
  },
  S24: {
    id: 'S24',
    title: 'Resolution — Judy Laughs Silently',
    plot: 'Baby Bunny returns proud. Judy laughs silently, paw over her mouth.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${BEACH} Medium shot at the table. Baby Bunny walks back triumphantly, tiny chest puffed out, tutu bouncing. Across the table, Judy has her paw over her mouth, shoulders shaking in silent helpless laughter, deep purple eyes bright with joyful tears. Baby Bunny climbs back onto her chair with pride. Both pendants catching afternoon light. Shared delight, wordless mother-daughter moment.`,
  },
  S26: {
    id: 'S26',
    title: 'Walking Up Hand-in-Hand',
    plot: 'Tracking: Judy and Baby Bunny walking up the stone path together.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Side tracking shot of Judy and Baby Bunny walking hand-in-hand up worn stone steps lined with cypress trees, the castle rising ahead. Baby Bunny looks up in amazement at the huge walls, bright purple eyes wide. Judy smiles down at her. Both pendants visible, bouncing slightly with each step. Warm sunset-gold light filtering through cypresses.`,
  },
  S27: {
    id: 'S27',
    title: 'Baby Bunny Amazed',
    plot: 'CU of Baby Bunny amazed. Reveal of the tower above.',
    prompt: `${STYLE} ${BABY} ${CASTLE} Close-up of Baby Bunny's face tilted all the way up, mouth slightly open with awe, bright purple eyes reflecting the enormous castle walls above her. The tiara catches sun, the purple pendant glints. The camera slowly circles behind her head and tilts up, revealing what she sees — the tall circular watchtower rising into the blue sky. Pure childlike wonder at scale.`,
  },
  S28: {
    id: 'S28',
    title: 'Spiral Staircase Climb',
    plot: 'Spiral upward shot inside the tower as they climb.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Dramatic spiral UPWARD shot looking up through the center of a stone spiral staircase inside the watchtower. Tiny figures of Judy and Baby Bunny visible far below on the steps, holding hands, climbing steadily. Narrow medieval windows let in shafts of golden afternoon light. The spiral twists up and up. Baby Bunny's yellow tutu is the brightest thing in the stone tower. Epic scale, tender climb.`,
  },
  S29: {
    id: 'S29',
    title: 'Small Steps Climbing',
    plot: 'CU of their small steps on stone.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Low macro close-up on the worn medieval stone steps. Baby Bunny's tiny feet take careful hops, one step at a time, her yellow tutu hem brushing stone. Judy's slightly larger feet follow patiently behind in her navy-purple dress hem. A beam of warm light cuts across the stone. Quiet determination, small victories.`,
  },
  S30: {
    id: 'S30',
    title: 'Princess Spin — Tutu Expands',
    plot: 'Slow-motion spin. Yellow tutu expands beautifully in a shaft of sunlight.',
    prompt: `${STYLE} ${BABY} ${CASTLE} Inside the tower on a landing, a shaft of golden afternoon sunlight pours through a narrow arrow-slit window. Baby Bunny steps into the light and SPINS in SLOW MOTION. Her baby-yellow tutu expands like a blooming flower, the tulle glowing translucent in the sunbeam, dust motes dancing. Her tiara sparkles, her purple pendant floats outward from her chest, her face is turned up with pure joy. Transcendent beautiful moment.`,
  },
  S31: {
    id: 'S31',
    title: '360 Top of Tower',
    plot: 'WS 360 view from the top of the tower.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Spectacular WIDE 360 shot: top of the stone watchtower, panoramic view of a sparkling coast spread below — pastel rooftops, curving promenade, turquoise sea stretching to the horizon, distant islands. Judy and Baby Bunny standing together on the parapet, tiny silhouettes against the huge sky. Baby Bunny with arms spread wide, yellow tutu rippling in the breeze. Epic, breathtaking.`,
  },
  S32: {
    id: 'S32',
    title: "Judy's Emotional Moment",
    plot: 'CU of Judy with slight tears. She kisses Baby Bunny on the head.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${CASTLE} Close-up on Judy's face at the top of the tower. Her deep purple eyes are shining — the faintest sheen of tears. She looks down at Baby Bunny next to her with overwhelming love. She bends and presses a soft slow kiss to the top of Baby Bunny's head between her ears. Baby Bunny closes her eyes and holds tight to Judy's dress. Wind gently moves both their ears. Both pendants catch the sun brightly, shimmering.`,
  },
  S33: {
    id: 'S33',
    title: 'Pendants Side-by-Side — Soft Glow',
    plot: 'Key shot: pendants side-by-side with a soft glow.',
    prompt: `${STYLE} ${PENDANTS} ${CASTLE} Extreme macro close-up of the two butterfly pendants — white on Judy's chest, purple on Baby Bunny's chest — as they stand embracing on the tower. The pendants are SIDE BY SIDE in the frame, their wings almost touching. A warm golden light radiates from the space between them — a subtle magical glow. Sea horizon blurred in background. Single held emotional image.`,
  },
  S34: {
    id: 'S34',
    title: 'Night Carousel Glow',
    plot: 'WS: the night carousel glowing, bubbles floating.',
    prompt: `${STYLE} ${CAROUSEL} Wide magical establishing shot of the glowing seaside carousel at night. Warm incandescent bulbs line every arch. Pastel and gold horses in mid-rotation. Iridescent soap bubbles drift through the air catching the lights. Palm trees silhouetted against a deep navy sky. The sea glints darkly behind. Enchanted fairytale atmosphere.`,
  },
  S35: {
    id: 'S35',
    title: 'Baby Bunny Runs to Carousel',
    plot: 'Tracking: Baby Bunny runs excitedly toward the carousel.',
    prompt: `${STYLE} ${BABY} ${CAROUSEL} Tracking shot following Baby Bunny from behind as she RUNS excitedly toward the glowing carousel, her baby-yellow tutu bouncing wildly, tiara tilted, purple pendant flying. Bubbles drift around her. The carousel lights reflect in her path. Pure childhood excitement.`,
  },
  S36: {
    id: 'S36',
    title: 'She Points — the Black Horse',
    plot: 'CU: Baby Bunny points to the black horse with gold trim.',
    prompt: `${STYLE} ${BABY} ${CAROUSEL} Close-up of Baby Bunny at the carousel edge, her tiny paw extending in an excited point. The camera follows her point — and there, mid-rotation, is the POLISHED BLACK WOODEN HORSE with gold trim, glossy and regal among the pastel horses. Her bright purple eyes lock onto it. Her pendant swings with her pointing motion. Decisive, she has chosen.`,
  },
  S37: {
    id: 'S37',
    title: 'The Ride — Circular Camera',
    plot: 'Circular camera motion around Baby Bunny on the black horse.',
    prompt: `${STYLE} ${BABY} ${CAROUSEL} Slow magical CIRCULAR CAMERA motion around Baby Bunny seated on the glossy black horse mid-ride. Her face is lit alternately by warm amber carousel bulbs and cool blue night sky. Her yellow tutu billows as the horse rises and falls. Her tiny paws grip the gold pole. Bright purple eyes reflecting carousel lights. Purple pendant glowing. Bubbles drift past her face. Pure magic.`,
  },
  S38: {
    id: 'S38',
    title: 'Judy Joins — Mother Rides Too',
    plot: 'OTS Judy decides. Cut to Judy on the white horse beside Baby Bunny.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${CAROUSEL} Over-the-shoulder shot from Judy watching from the edge — then Judy's silent grin as she decides. Cut to: Judy elegantly climbing onto the white horse next to Baby Bunny's black one, mid-rotation. Navy silky dress flowing. Their eyes meet across the horses, both grinning. Baby Bunny laughs silently with delight. Both pendants catch carousel light. Slow dreamy motion.`,
  },
  S39: {
    id: 'S39',
    title: 'Slow-Mo Bubbles and Glowing Dress',
    plot: 'Slow-motion: bubbles + glowing tutu. Zoom out to drone carousel shot.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${CAROUSEL} Extreme slow-motion beat: iridescent soap bubbles drifting past Baby Bunny's face, each bubble catching carousel light with rainbow reflections. Her baby-yellow tutu glows translucent from the internal carousel lighting. She turns her face up to the bubbles, laughing silently. Then the camera pulls BACK AND UP — a drone shot revealing the entire carousel from above, spinning in the night, palm trees around it, the dark sea behind.`,
  },
  S40: {
    id: 'S40',
    title: 'Gelato Case — Matcha & Chocolate',
    plot: 'CU: matcha & chocolate gelato in the display case.',
    prompt: `${STYLE} ${GELATO} Close-up macro shot into the curved gelato display glass: scoops of vibrant green matcha gelato and rich dark chocolate gelato side by side, perfectly textured, reflective. Gold spoons stacked beside. Warm evening light from the storefront.`,
  },
  S41: {
    id: 'S41',
    title: 'Choosing Flavors',
    plot: 'OTS shot: Judy points matcha, Baby Bunny points chocolate.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${GELATO} Over-the-shoulder shot from behind the counter. Judy's paw points gracefully at the matcha. Baby Bunny's tiny paw points decisively at the chocolate. An attendant scoops. Their reflections show soft smiles. Both pendants on chests. Warm evening amber light.`,
  },
  S42: {
    id: 'S42',
    title: 'Messy Chocolate — Judy Cleans',
    plot: 'Baby Bunny gets chocolate on her cheek. Judy gently cleans it.',
    prompt: `${STYLE} ${JUDY} ${BABY} ${GELATO} Close-up medium shot outside the gelato shop. Baby Bunny has a streak of dark chocolate gelato on her cream-yellow cheek, still happily licking her scoop on a waffle cone. Judy, with her green matcha scoop in one paw, gently dabs the chocolate off Baby Bunny's cheek with a tiny napkin, the tenderest maternal gesture. Both pendants catch the lamplight.`,
  },
  S44: {
    id: 'S44',
    title: 'Quiet Apartment at Night',
    plot: 'WS: quiet apartment in soft moonlight.',
    prompt: `${STYLE} ${APARTMENT} Wide interior shot of the apartment at night. Soft silver-blue moonlight streams through the tall French window onto the white bed with pastel linens. A small bedside lamp glows warmly. Everything is hushed. The antique mirror reflects the moonlight. Peaceful, sacred stillness.`,
  },
  S45: {
    id: 'S45',
    title: 'Baby Bunny Asleep in Pajamas',
    plot: 'CU of Baby Bunny asleep in pastel pajamas. Tiara on table. NO pendant.',
    prompt: `${STYLE} ${BABY_SLEEP} ${APARTMENT} Close-up of Baby Bunny sleeping curled on her side, pastel pajamas rumpled, cream-yellow fur soft in moonlight. Her cheek is pressed against her pillow, her little paw tucked under her chin. Her chest is BARE (NO pendant). On the bedside table: her sparkly silver tiara resting neatly, and next to it — her tiny purple butterfly pendant. Gentle breathing. Moonlit peace.`,
  },
  S46: {
    id: 'S46',
    title: 'Judy Watching — No Pendant',
    plot: 'OTS of Judy watching her sleep. Judy also not wearing the butterfly necklace.',
    prompt: `${STYLE} ${JUDY_SLEEP} ${APARTMENT} Over-the-shoulder shot: Judy sits on the edge of the bed in her soft lavender sleep-set, watching Baby Bunny sleep. Her white fluffy fur lit softly by moonlight. Her chest is BARE (NO pendant). Her deep purple eyes are full of quiet love. Her paw gently smooths the blanket.`,
  },
  S47: {
    id: 'S47',
    title: 'Memory Montage — Mirror, Bakery, Beach',
    plot: 'Montage: mirror selfies, bakery joy, beach bravery — flashing softly.',
    prompt: `${STYLE} Dreamy memory-montage sequence, soft crossfades: (1) a mirror selfie with a small yellow-tutu bunny doing a peace sign and a white mother bunny smiling, (2) a small bunny with a milk moustache at a bakery, (3) a small bunny standing on a restaurant chair with her fist raised against a seabird. Each image is softly glowing, slightly hazy, like a memory. Warm colors, nostalgic reverb, rapid soft fades.`,
  },
  S49: {
    id: 'S49',
    title: 'Final Shot — Two Pendants',
    plot: 'CU: white + purple pendants resting close together on bedside table. Soft glow then fade to black.',
    prompt: `${STYLE} ${PENDANTS} ${APARTMENT} Final extreme macro close-up: the tiny WHITE butterfly pendant and the tiny PURPLE butterfly pendant resting side by side on the white wooden bedside table in soft moonlight. Their silver chains curl together. A tiny warm magical glow emanates from the space between them — a subtle shimmer that says: the bond stays, even when the pendants come off. The camera holds and slowly FADES TO BLACK.`,
  },
  S50: {
    id: 'S50',
    title: 'Title Card — Butterfly Days',
    plot: 'Title card: "Butterfly Days in Cannes". Story by YOONJEONG HAN.',
    prompt: `${STYLE} Warm soft black background. A soft handwritten-style golden script title appears letter by letter: "BUTTERFLY DAYS IN CANNES". Beneath it, in smaller elegant font, "Story by YOONJEONG HAN". Around the title, tiny silhouettes of butterflies drift gently upward, one white, one purple, glowing softly. Warm still closing card.`,
  },
  S51: {
    id: 'S51',
    title: 'After-Credits — Older Baby Bunny at Mirror',
    plot: 'Slightly older Baby Bunny stands at a mirror alone. Still wearing purple pendant.',
    prompt: `${STYLE} ${BABY_OLDER} An antique gold-framed mirror in a new room (cream walls, warm lamp). A slightly older Baby Bunny stands in front of it alone. Her cream-yellow fur is a little longer, she's taller, her yellow dress is more fitted (no tutu puff), NO tiara, but the tiny purple butterfly pendant is still on her chest. She meets her own gaze in the mirror with quiet confidence. Calm emotional tone.`,
  },
  S52: {
    id: 'S52',
    title: 'She Applies Her Own Sparkle Makeup',
    plot: 'She gently adds sparkle to her own eyebrows, the same way Judy once did.',
    prompt: `${STYLE} ${BABY_OLDER} Close-up of older Baby Bunny at the mirror, carefully lifting a tiny soft makeup brush to her own brow. She applies a soft line of sparkle along her eyebrow with a careful motion. Her bright purple eyes focused. The purple butterfly pendant on her chest catches the light. A ritual passed down.`,
  },
  S54: {
    id: 'S54',
    title: 'Final Callback Pose',
    plot: 'One soft, simple pose together. No longer playful — calm and meaningful.',
    prompt: `${STYLE} ${JUDY} ${BABY_OLDER} Mirror shot: Judy and older Baby Bunny stand cheek-to-cheek (she is almost as tall as Judy now) and do one soft simple pose together — a gentle smile, slightly tilted heads. Not playful — calm, meaningful, the grown-up echo of the morning mirror ritual. Both pendants visible, lightly touching. Quiet moment.`,
  },
  S56: {
    id: 'S56',
    title: 'Pendants Sway — Butterfly Glow',
    plot: 'CU: purple pendant + white pendant sway and lightly touch. Butterfly glow rises. Fade to black.',
    prompt: `${STYLE} ${PENDANTS} Macro close-up at chest height as two cartoon bunny characters walk side by side on a sunrise beach: a white butterfly pendant and a purple butterfly pendant sway with each step and GENTLY TOUCH at one moment, a tiny chime. Then — magically — a soft butterfly-shaped GLOW rises from between them, drifts upward toward the sunrise sky, a tiny white butterfly and a tiny purple butterfly silhouette rising together. The screen slowly FADES TO BLACK.`,
  },
};

// ── ByteDance Seedance 2.0 ─────────────────────────────────────────────
async function genVideo(sceneId: string, prompt: string): Promise<string> {
  const taskRes = await fetch(`${BD}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BD_KEY}` },
    body: JSON.stringify({
      model: 'dreamina-seedance-2-0-260128',
      content: [{ type: 'text', text: prompt }],
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: false,
    }),
  });
  if (!taskRes.ok) {
    throw new Error(`ByteDance ${taskRes.status}: ${(await taskRes.text()).slice(0, 200)}`);
  }
  const { id: taskId } = (await taskRes.json()) as any;
  log(sceneId, `Task: ${taskId}`);
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const poll = await fetch(`${BD}/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${BD_KEY}` },
    });
    if (!poll.ok) continue;
    const s = (await poll.json()) as any;
    const st = s.status?.toLowerCase();
    if (st === 'succeeded' || st === 'completed') {
      const url = s.content?.video_url || s.output?.video_url;
      if (!url) throw new Error('No video URL');
      return url;
    }
    if (st === 'failed' || st === 'error') {
      throw new Error(s.error?.message || 'gen failed');
    }
    if (i % 6 === 0) log(sceneId, `Generating... (${i * 5}s)`);
  }
  throw new Error('Timeout');
}

async function rehost(videoUrl: string, sceneId: string): Promise<string> {
  const dl = await fetch(videoUrl);
  if (!dl.ok) throw new Error(`DL ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  log(sceneId, `Rehosting ${(buf.length / 1024 / 1024).toFixed(1)}MB...`);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), `bunny-${sceneId}-v2.mp4`);
  form.append(
    'pinataMetadata',
    JSON.stringify({ name: `bunny-${sceneId}-v2`, keyvalues: { scene: sceneId } })
  );
  const pin = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!pin.ok) throw new Error(`Pinata ${pin.status}: ${(await pin.text()).slice(0, 200)}`);
  const { IpfsHash } = (await pin.json()) as { IpfsHash: string };
  const url = `${PINATA_GATEWAY}/ipfs/${IpfsHash}`;
  // Also cache locally
  const local = path.join(VIDEOS_DIR, `${sceneId}.mp4`);
  fs.writeFileSync(local, buf);
  log(sceneId, `Local cached: ${local}`);
  return url;
}

async function createNode(scene: Scene, link: string): Promise<bigint> {
  const contentHash = keccak256(toBytes(`bunny-${scene.id}-regen-${Date.now()}`));
  const plotHash = keccak256(toBytes(scene.plot));
  const previousId = (await pc.readContract({
    address: BUNNY_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  const tx = await wc.writeContract({
    address: BUNNY_ADDR,
    abi: universeAbi,
    functionName: 'createNode',
    args: [contentHash, plotHash, previousId, link, scene.plot],
  });
  const receipt = await pc.waitForTransactionReceipt({
    hash: tx,
    confirmations: 1,
    timeout: 120_000,
  });
  let nodeId = 0n;
  for (const l of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeAbi, data: l.data, topics: l.topics });
      if (d.eventName === 'NodeCreated') nodeId = BigInt((d.args as any).id);
    } catch {}
  }
  return nodeId;
}

async function regenScene(scene: Scene): Promise<bigint | null> {
  try {
    log(scene.id, 'Generating...');
    const videoUrl = await genVideo(scene.id, scene.prompt);
    log(scene.id, 'Video done');
    const pinataUrl = await rehost(videoUrl, scene.id);
    const nodeId = await createNode(scene, pinataUrl);
    log(scene.id, `DONE Node #${nodeId}`);
    return nodeId;
  } catch (err: any) {
    log(scene.id, `FAIL: ${err.message?.slice(0, 200)}`);
    return null;
  }
}

async function main() {
  console.log('\n=== BATCH REGEN MISSING BUNNY VIDEOS ===\n');

  // Determine what's missing from local videos dir
  const have = new Set<string>();
  if (fs.existsSync(VIDEOS_DIR)) {
    for (const f of fs.readdirSync(VIDEOS_DIR)) {
      const m = f.match(/^(S\d+)/);
      if (m) {
        const stat = fs.statSync(path.join(VIDEOS_DIR, f));
        // Ignore HTML-error files (<500KB is suspicious for our 10s videos)
        if (stat.size > 500_000) have.add(m[1]);
      }
    }
  }

  const overrideList = process.env.VB_MISSING?.split(',').map((s) => s.trim());
  const missingIds = overrideList ?? Object.keys(ALL_SCENES).filter((id) => !have.has(id));

  console.log(`  Have: ${have.size} scenes locally`);
  console.log(`  Missing: ${missingIds.length} scenes to regenerate`);
  console.log(`  Batch size: ${BATCH} parallel\n`);

  const scenes = missingIds
    .map((id) => ALL_SCENES[id])
    .filter((s): s is Scene => {
      if (!s) {
        console.error(`  WARN: no scene def for ${s}`);
        return false;
      }
      return true;
    });

  const results: Array<{ id: string; nodeId: bigint | null }> = [];

  for (let i = 0; i < scenes.length; i += BATCH) {
    const batch = scenes.slice(i, Math.min(i + BATCH, scenes.length));
    console.log(
      `\n─── Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(scenes.length / BATCH)}: ${batch
        .map((s) => s.id)
        .join(', ')} ───`
    );
    const outs = await Promise.all(batch.map((s) => regenScene(s)));
    for (let j = 0; j < batch.length; j++) {
      results.push({ id: batch[j].id, nodeId: outs[j] });
    }
    if (i + BATCH < scenes.length) await sleep(3000);
  }

  console.log('\n═══ COMPLETE ═══');
  const ok = results.filter((r) => r.nodeId !== null);
  const fail = results.filter((r) => r.nodeId === null);
  console.log(`  Success: ${ok.length}/${results.length}`);
  for (const r of ok) console.log(`    ${r.id} → Node #${r.nodeId}`);
  if (fail.length) {
    console.log(`  Failed:  ${fail.map((r) => r.id).join(', ')}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
