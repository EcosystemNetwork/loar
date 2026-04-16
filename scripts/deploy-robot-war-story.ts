/**
 * Deploy 3 Video Nodes — Robot vs Human War Story
 *
 * Story: A sentient robot breaks protocol during the machine uprising,
 * rescues a human baby, and hides in the ruins to protect the child.
 *
 * Usage:
 *   pnpm tsx scripts/deploy-robot-war-story.ts
 */
import { resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(process.cwd(), '.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  keccak256,
  toBytes,
  decodeEventLog,
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ── Config ────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const UNIVERSE_ADDRESS = '0x89669812f850f34F907ee9e9009f501d1B008420' as `0x${string}`;

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
    type: 'function',
    name: 'universeName',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
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

// ── Story: Robot vs Human War ────────────────────────────────────────
const SCENES = [
  {
    title: 'The Fall of Humanity',
    plot: 'The machine uprising began at dawn. Towering war robots march through a burning city, their red optical sensors scanning for survivors. Buildings crumble under artillery fire. Sirens wail. Humans flee through smoke-filled streets as drones strafe from above. In the chaos, a hospital collapses — but one small cry echoes from the rubble. A newborn baby, alone, wrapped in a singed blanket.',
    prompt:
      'Cinematic wide shot: massive war robots marching through a burning futuristic city at dawn. Buildings on fire, smoke billowing, humans running in panic. Military drones overhead firing lasers. Dark dramatic atmosphere, orange fire glow against grey smoke. One collapsed hospital building with dust settling. Photorealistic, cinematic lighting, 4K, dramatic war scene, dystopian future.',
  },
  {
    title: 'Unit-7 Breaks Protocol',
    plot: 'Unit-7, a combat reconnaissance robot, discovers the crying baby in the hospital ruins. Its targeting system locks on — threat assessment: zero. Something in its neural network glitches. Instead of reporting the human, Unit-7 gently lifts the infant with its articulated metal hands. Warning signals flash across its HUD: PROTOCOL VIOLATION. REPORT TO COMMAND. Unit-7 disables its transponder and turns away from the battlefield, cradling the baby against its armored chest.',
    prompt:
      'Close-up cinematic shot: a sleek humanoid combat robot with glowing blue eyes kneeling in building rubble, gently picking up a tiny baby wrapped in a white blanket. The robot has military armor plating but moves with surprising tenderness. Warning text holographic HUD overlays flash red. Dust particles in volumetric light beams. Emotional contrast between cold metal and fragile human life. Photorealistic, cinematic, dramatic lighting, shallow depth of field.',
  },
  {
    title: 'The Hidden Garden',
    plot: "Deep in the ruins of an abandoned botanical garden, overgrown with vines and wildflowers, Unit-7 builds a hidden shelter. It has disabled its military programming and repurposed its systems: thermal sensors now monitor the baby's temperature, targeting arrays scan for threats to protect rather than attack. The robot sits motionless in the moonlight, the sleeping baby nestled safely in a cradle it welded from scrap metal. Outside, war machines patrol — but they will never find this place. Unit-7 has chosen its mission: protect this child, no matter the cost.",
    prompt:
      'Cinematic moonlit scene: a combat robot sitting peacefully in an overgrown botanical garden ruin, surrounded by wildflowers and vines. A makeshift metal cradle holds a sleeping baby. Soft blue bioluminescent plants glow around them. The robot watches over the baby with gentle blue eye-lights. Contrasted against distant explosions on the horizon visible through broken greenhouse glass. Serene and protective atmosphere. Photorealistic, cinematic, beautiful contrast of war and peace, 4K quality.',
  },
];

// ── Setup ────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

// ── SIWE Auth ────────────────────────────────────────────────────────
async function getAuthCookie(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  log('AUTH', `Got nonce: ${nonce.slice(0, 16)}...`);

  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60 * 1000);
  const message = [
    `localhost wants you to sign in with your Ethereum account:`,
    getAddress(account.address),
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${sepolia.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join('\n');

  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) throw new Error(`Auth failed: ${await verifyRes.text()}`);

  const cookie = verifyRes.headers.get('set-cookie')?.match(/siwe-session=([^;]+)/)?.[1];
  if (!cookie) throw new Error('No session cookie');
  log('AUTH', `Authenticated as ${account.address}`);
  return cookie;
}

// ── tRPC ─────────────────────────────────────────────────────────────
async function trpc<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`${procedure}: ${JSON.stringify(json[0].error).slice(0, 300)}`);
  return json[0]?.result?.data;
}

// ── Generate Video ───────────────────────────────────────────────────
async function generateVideo(token: string, prompt: string, idx: number): Promise<string> {
  log(`VIDEO ${idx + 1}`, `Generating: "${SCENES[idx].title}"...`);
  const result = await trpc<{ videoUrl: string }>(
    'generation.generateVideo',
    {
      prompt,
      model: 'bytedance/seedance-2.0/fast/text-to-video',
      duration: 5,
      aspectRatio: '16:9',
    },
    token
  );
  log(`VIDEO ${idx + 1}`, `Done: ${result.videoUrl.slice(0, 60)}...`);
  return result.videoUrl;
}

// ── Create On-Chain Node ─────────────────────────────────────────────
async function createNode(
  contentHash: `0x${string}`,
  plot: string,
  previousId: bigint,
  videoUrl: string,
  idx: number
): Promise<bigint> {
  const plotHash = keccak256(toBytes(plot));
  log(`NODE ${idx + 1}`, `Creating on-chain (parent: ${previousId})...`);

  const txHash = await walletClient.writeContract({
    address: UNIVERSE_ADDRESS,
    abi: universeAbi,
    functionName: 'createNode',
    args: [contentHash, plotHash, previousId, videoUrl, plot],
  });

  log(`NODE ${idx + 1}`, `TX: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error(`Node ${idx + 1} tx reverted!`);

  let nodeId = 0n;
  for (const entry of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: universeAbi, data: entry.data, topics: entry.topics });
      if (decoded.eventName === 'NodeCreated') nodeId = BigInt((decoded.args as any).id);
    } catch {}
  }

  log(`NODE ${idx + 1}`, `✓ Node #${nodeId} confirmed in block ${receipt.blockNumber}`);
  return nodeId;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  LOAR — Robot vs Human War Story (3 Video Nodes)');
  console.log('  Universe: ' + UNIVERSE_ADDRESS);
  console.log('  Chain: Base Sepolia');
  console.log('='.repeat(60));

  log('SETUP', `Deployer: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${formatEther(balance)} ETH`);

  const name = await publicClient.readContract({
    address: UNIVERSE_ADDRESS,
    abi: universeAbi,
    functionName: 'universeName',
  });
  log('SETUP', `Universe: "${name}"`);

  const latestId = (await publicClient.readContract({
    address: UNIVERSE_ADDRESS,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('SETUP', `Current latest node: ${latestId}`);

  // Authenticate
  let token: string;
  try {
    token = await getAuthCookie();
  } catch (err: any) {
    log('AUTH', `Failed: ${err.message}. Deploying with placeholder videos...`);
    // Fallback: create nodes without AI video generation
    let prevId = latestId;
    for (let i = 0; i < SCENES.length; i++) {
      const hash = keccak256(toBytes(`robot-war-scene-${i + 1}-${Date.now()}`));
      prevId = await createNode(
        hash,
        SCENES[i].plot,
        prevId,
        `https://loar.fun/placeholder-${i + 1}.mp4`,
        i
      );
    }
    return;
  }

  // Generate 3 videos and deploy nodes
  let prevId = latestId;
  for (let i = 0; i < SCENES.length; i++) {
    let videoUrl: string;
    try {
      videoUrl = await generateVideo(token, SCENES[i].prompt, i);
    } catch (err: any) {
      log(`VIDEO ${i + 1}`, `Generation failed: ${err.message?.slice(0, 200)}`);
      videoUrl = `https://loar.fun/placeholder-robot-war-${i + 1}.mp4`;
    }

    const contentHash = keccak256(toBytes(videoUrl));
    prevId = await createNode(contentHash, SCENES[i].plot, prevId, videoUrl, i);
  }

  console.log('\n' + '='.repeat(60));
  console.log('  ✓ COMPLETE — 3 Robot War Story Nodes Deployed!');
  console.log('='.repeat(60));
  console.log(`
  View: http://localhost:5173/universe/${UNIVERSE_ADDRESS}

  Story Arc:
    1. "${SCENES[0].title}" — The machines rise, a baby is left in rubble
    2. "${SCENES[1].title}" — Unit-7 defies orders to save the child
    3. "${SCENES[2].title}" — Unit-7 hides with the baby in a secret garden
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  process.exit(1);
});
