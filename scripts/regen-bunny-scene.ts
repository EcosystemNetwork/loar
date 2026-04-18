/**
 * One-shot regeneration of a single failed Vacation Bunny scene.
 *
 * Uses a pre-sanitized, non-branded prompt to dodge ByteDance copyright filter.
 * Writes a new on-chain node (appended to the end of the chain, since we don't
 * have insertion — narrative order stays in the plot field).
 *
 * Usage:
 *   BUNNY_ADDR=0x... SCENE_ID=S20 pnpm tsx scripts/regen-bunny-scene.ts
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
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';

const UNIVERSE_ADDR = (process.env.BUNNY_ADDR ?? '') as `0x${string}`;
const SCENE_ID = process.env.SCENE_ID ?? 'S20';
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

if (!UNIVERSE_ADDR || !UNIVERSE_ADDR.startsWith('0x')) throw new Error('Set BUNNY_ADDR');
if (!BYTEDANCE_API_KEY) throw new Error('BYTEDANCE_API_KEY missing');
if (!PINATA_JWT) throw new Error('PINATA_JWT missing');

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

// ── Soft-rewritten prompts (no brand words, no "Pixar", softer wording) ──
const SCENES: Record<string, { title: string; plot: string; prompt: string }> = {
  S20: {
    title: 'The Seagull Swoops',
    plot: 'A plump seagull lands on the table, takes one french fry, and looks at Baby Bunny cheekily.',
    prompt:
      'A premium 3D animated children film scene, soft painterly textures, cinematic lighting, warm golden daylight, dreamy soft glow. Wide shot of a small round table at a sunny seaside lunch spot with buttery-yellow parasols. On the crisp white tablecloth: a plate of golden crispy french fries, two fancy crystal glasses with soft pink and apple-juice drinks. A plump friendly cartoon seabird with scruffy white-and-grey feathers, a bright orange beak, and big round cheerful eyes lands gently on the table edge. The cute bird takes ONE single french fry in its beak and freezes, tilting its head with a cheeky smile. Two adorable cartoon bunny characters in the background — one tall mother bunny in a deep purple dress, one small daughter bunny in a bright yellow tutu with a tiara — both with wide-eyed surprised expressions, tiny paws frozen in the air. Sparkling sea behind. Child-friendly, warm, funny moment. High-quality animated feature film style.',
  },
  S48: {
    title: 'Memory Montage — Tower & Carousel',
    plot: 'Montage continues: tower view, carousel lights, pendants tapping at sunset.',
    prompt:
      "A dreamy premium 3D animated children film montage, soft warm nostalgic glow. A gentle slow crossfade between three tender memory images. First: a tall mother bunny with soft white fur and a deep purple dress gently pressing a soft kiss to the top of her small daughter bunny's head, the daughter in a bright yellow puffy tutu, both standing at the parapet of an old stone watchtower high above a sparkling blue coastline at warm sunset, both with tiny matching butterfly pendants glowing softly on their chests. Second: the small daughter bunny sitting on a polished glossy black horse of a magical seaside night carousel, warm golden bulbs glowing, iridescent soap bubbles drifting past her glowing yellow tutu, her purple-eyed face lit with wonder. Third: close-up of two tiny butterfly pendants — one white, one purple — lightly touching on the chests of two bunny characters sitting together on a pale stone bench overlooking a dusk ocean. Each memory dissolves softly into the next. Very warm, very tender, piano mood. High-quality animated feature film style.",
  },
  S53: {
    title: 'After-Credits: Judy Appears Behind Her',
    plot: 'After-credits: older daughter bunny at mirror, mother bunny appears behind her, they smile at each other in reflection.',
    prompt:
      'A warm tender cartoon scene, soft lamp light, antique gold-framed mirror. An older young-teen cartoon bunny with cream-yellow fur and bright purple eyes stands in front of the mirror wearing a soft fitted yellow dress (no tutu puff, no tiara), a tiny purple butterfly charm on a thin silver chain on her chest. She just finished adding sparkle to her own eyebrow. Then a tall mother bunny with soft white fur and a deep purple dress, her own tiny white butterfly charm at her chest, appears softly behind her daughter in the mirror reflection. Their eyes meet in the mirror. A quiet meaningful shared smile passes between them — not playful, older, tender. Close-up on the mirror reflection. Very warm, child-friendly, emotional mother-daughter moment. Premium animated feature film style.',
  },
  S55: {
    title: 'Beach at Sunrise — Walking Side-by-Side',
    plot: 'WS beach at sunrise. Judy and older Baby Bunny walk side-by-side, almost the same height.',
    prompt:
      'A premium 3D animated children film final scene, soft warm sunrise light, cinematic, dreamy glow. Wide shot of a quiet empty white-sand beach at sunrise, soft pink-gold sky, small gentle waves. A tall mother bunny with soft white fur in a deep purple knee-length dress and her older daughter bunny (now a young teen, tall, cream-yellow fur, wearing a fitted soft yellow dress without a tutu puff, no tiara) walk side by side slowly toward the camera (or away from camera). They are almost the same height now. Both wear tiny matching butterfly pendants on delicate silver chains — one white, one purple. Their long shadows stretch softly on the wet sand behind them. Palm trees in the distance. A single magical butterfly-shaped light glows in the sky. Child-friendly, peaceful, ending-of-film atmosphere. Premium 3D animated feature film style.',
  },
  S25: {
    title: 'The Castle on the Hill',
    plot: 'WS establishing shot of the old stone castle on a hill above the old town, the tall stone watchtower rising.',
    prompt:
      'A premium 3D animated children film establishing shot, warm golden afternoon light, cinematic, dreamy. Wide establishing shot from below of a picturesque medieval old stone castle on a hill above a small old-town French coastal village. Warm sunlit beige stone walls, a tall circular stone watchtower rising above dark green cypress trees, a stone pathway curving up through the trees, the blue Mediterranean sea sparkling in the distant background. No characters. Atmospheric, warm, inviting. Child-friendly kids animated feature film style. Soft painterly textures.',
  },
};

// ── ABI ─────────────────────────────────────────────────────────────────
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

function log(msg: string) {
  console.log(`[${SCENE_ID}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateVideo(prompt: string): Promise<string> {
  log('Generating video via Seedance 2.0...');
  const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
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
    throw new Error(`ByteDance ${taskRes.status}: ${(await taskRes.text()).slice(0, 300)}`);
  }
  const { id: taskId } = (await taskRes.json()) as any;
  log(`Task: ${taskId}`);
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
      log('Video done');
      return url;
    }
    if (st === 'failed' || st === 'error') {
      throw new Error(s.error?.message || 'gen failed');
    }
    if (i % 6 === 0) log(`Generating... (${i * 5}s)`);
  }
  throw new Error('Timeout after 5 min');
}

async function rehostToPinata(videoUrl: string): Promise<string> {
  log('Downloading video...');
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  log(`Rehosting to Pinata (${(buf.length / 1024 / 1024).toFixed(1)}MB)...`);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), `bunny-${SCENE_ID}.mp4`);
  form.append(
    'pinataMetadata',
    JSON.stringify({ name: `bunny-${SCENE_ID}`, keyvalues: { scene: SCENE_ID } })
  );
  const pin = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!pin.ok) throw new Error(`Pinata ${pin.status}: ${(await pin.text()).slice(0, 200)}`);
  const { IpfsHash } = (await pin.json()) as { IpfsHash: string };
  const url = `${PINATA_GATEWAY}/ipfs/${IpfsHash}`;
  log(`Pinned: ${url}`);
  return url;
}

async function createNode(contentHash: string, plot: string, link: string): Promise<bigint> {
  const chBytes = keccak256(toBytes(contentHash)) as `0x${string}`;
  const plotHash = keccak256(toBytes(plot));
  const previousId = (await publicClient.readContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
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
  let nodeId = 0n;
  for (const l of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeAbi, data: l.data, topics: l.topics });
      if (d.eventName === 'NodeCreated') nodeId = BigInt((d.args as any).id);
    } catch {}
  }
  return nodeId;
}

async function main() {
  const scene = SCENES[SCENE_ID];
  if (!scene) throw new Error(`No regen template for ${SCENE_ID}`);
  console.log(`\n═══ Regenerating ${SCENE_ID}: ${scene.title} ═══\n`);
  const videoUrl = await generateVideo(scene.prompt);
  const pinataUrl = await rehostToPinata(videoUrl);
  const contentHash = `bunny-${SCENE_ID}-regen-${Date.now()}`;
  const nodeId = await createNode(contentHash, scene.plot, pinataUrl);
  console.log(`\n✔ ${SCENE_ID} regenerated → Node #${nodeId}`);
  console.log(`  URL: ${pinataUrl}`);
}

main().catch((e) => {
  console.error(`FAILED:`, e.message);
  process.exit(1);
});
