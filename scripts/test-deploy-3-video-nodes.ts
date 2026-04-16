/**
 * Deploy 3 Video Nodes to Memeverse
 *
 * Generates 3 AI videos with shared memeverse context, uploads to decentralized
 * storage, and creates sequential on-chain nodes in the Memeverse universe.
 *
 * Prerequisites:
 *   - Server running: `pnpm --filter server dev`
 *   - .env configured with PRIVATE_KEY, FAL_KEY, PINATA_JWT
 *
 * Usage:
 *   pnpm tsx scripts/test-deploy-3-video-nodes.ts
 *
 * The 3 videos form a narrative arc:
 *   1. "The First Meme Awakens" — origin scene
 *   2. "Meme Wars: The Viral Clash" — conflict scene
 *   3. "The Meme Singularity" — convergence/finale
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env ─────────────────────────────────────────────────────────────────
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

// ── Config ────────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// UniverseManager addresses to check (Sepolia)
const UNIVERSE_MANAGERS = [
  '0xB82dE188841a799e0dBB58D885D81BEE7A735f00', // Current (packages/abis)
  '0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce', // Legacy (deploy-universe-tokens.ts)
] as const;

// Load Universe ABI from compiled artifacts (or use inline minimal ABI)
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
    name: 'getFullGraph',
    inputs: [],
    outputs: [
      { name: 'ids', type: 'uint256[]' },
      { name: 'contentHashes', type: 'bytes32[]' },
      { name: 'plotHashes', type: 'bytes32[]' },
      { name: 'previousIds', type: 'uint256[]' },
      { name: 'nextIds', type: 'uint256[][]' },
      { name: 'canonFlags', type: 'bool[]' },
    ],
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
    type: 'function',
    name: 'universeAdmin',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isWhitelisted',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setWhitelisted',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'status', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
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

const universeManagerAbi = [
  {
    type: 'function',
    name: 'getUniverseData',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'universe', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'universeGovernor', type: 'address' },
          { name: 'hook', type: 'address' },
          { name: 'locker', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'latestId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ── 3 Video Scenes (shared Memeverse context) ─────────────────────────────────
const VIDEO_SCENES = [
  {
    title: 'The First Meme Awakens',
    description:
      'In a glitched digital void, neon pixel fragments coalesce into the first conscious meme — a luminous Doge face that opens its eyes for the first time, surrounded by swirling data streams of green Matrix code and floating emoji particles. The meme blinks, confused but alive, as the void fractures into a kaleidoscope of internet culture.',
    prompt:
      'Cinematic 3D animation: A luminous neon Doge face materializes from swirling green Matrix code in a dark digital void. Floating emoji particles and pixel fragments orbit around it. The Doge opens its glowing eyes slowly. Ethereal lighting, cyberpunk aesthetic, particle effects, dramatic camera pull-back revealing an infinite digital landscape. 4K cinematic quality.',
  },
  {
    title: 'Meme Wars: The Viral Clash',
    description:
      'The Memeverse has fractured into rival factions. Doge leads the OG memes against an army of AI-generated deepfake memes threatening to overwrite original culture. Laser beams of upvotes and downvotes clash in a neon battlefield. Pepe rides a rocketship through the chaos while Nyan Cat leaves rainbow trails across the warzone.',
    prompt:
      'Epic battle scene: Neon-lit digital battlefield where classic internet memes clash with glitching AI-generated entities. Laser beams of orange upvotes and blue downvotes crisscross the sky. A glowing Doge leads a charge. Rainbow trails streak across the scene. Explosions of pixel particles. Cinematic wide shot, dramatic lighting, cyberpunk war aesthetic. 4K quality.',
  },
  {
    title: 'The Meme Singularity',
    description:
      'All memes converge into a single cosmic entity — the Meme Singularity. Every viral moment, every shared laugh, every cultural fragment merges into a towering holographic figure made of pure internet consciousness. It speaks in hashtags and breathes in viral loops. The digital universe restructures around it, born anew.',
    prompt:
      'Cosmic convergence: Thousands of glowing meme fragments spiral inward like a galaxy, merging into a colossal holographic humanoid figure made of pure light and data. The figure is composed of recognizable pixel art, emoji, and digital symbols. A shockwave of rainbow energy expands outward, restructuring a dark digital landscape into a vibrant new world. Epic scale, cosmic lighting, transcendent atmosphere. 4K cinematic.',
  },
];

// ── Setup ─────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

// ── SIWE Auth ─────────────────────────────────────────────────────────────────
function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!nonceRes.ok)
    throw new Error(`Failed to get nonce: ${nonceRes.status} ${await nonceRes.text()}`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  log('AUTH', `Got nonce: ${nonce.slice(0, 16)}...`);

  const message = buildSiweMessage({
    domain: 'localhost',
    address: getAddress(account.address),
    uri: 'http://localhost:5173',
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message });

  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });

  if (!verifyRes.ok) {
    throw new Error(`Auth verify failed: ${await verifyRes.text()}`);
  }

  const setCookieHeader = verifyRes.headers.get('set-cookie');
  const tokenMatch = setCookieHeader?.match(/siwe-session=([^;]+)/);
  if (!tokenMatch) throw new Error('No session cookie in verify response');

  log('AUTH', `Authenticated as ${account.address}`);
  return tokenMatch[1];
}

// ── tRPC Helpers ──────────────────────────────────────────────────────────────
async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) {
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 500)}`);
  }
  return json[0]?.result?.data;
}

// ── Find Memeverse Universe ───────────────────────────────────────────────────
async function findMemeverse(): Promise<`0x${string}` | null> {
  for (const managerAddr of UNIVERSE_MANAGERS) {
    try {
      let totalUniverses: bigint;
      try {
        totalUniverses = (await publicClient.readContract({
          address: managerAddr as `0x${string}`,
          abi: universeManagerAbi,
          functionName: 'latestId',
        })) as bigint;
      } catch {
        // latestId might not exist on older contracts — try scanning first few IDs
        totalUniverses = 10n;
      }
      log(
        'FIND',
        `Manager ${managerAddr.slice(0, 10)}... — scanning up to ${totalUniverses} universe IDs`
      );

      // Check universe IDs 0..latestId-1
      for (let i = 0n; i < totalUniverses; i++) {
        try {
          const data = await publicClient.readContract({
            address: managerAddr as `0x${string}`,
            abi: universeManagerAbi,
            functionName: 'getUniverseData',
            args: [i],
          });
          const universeAddr = (data as any).universe || (data as any)[0];
          if (universeAddr && universeAddr !== '0x0000000000000000000000000000000000000000') {
            // Check if this is Memeverse by reading its name
            try {
              const name = await publicClient.readContract({
                address: universeAddr as `0x${string}`,
                abi: universeAbi,
                functionName: 'universeName',
              });
              log('FIND', `  Universe #${i}: "${name}" @ ${universeAddr}`);
              if ((name as string).toLowerCase().includes('meme')) {
                return universeAddr as `0x${string}`;
              }
            } catch {
              log('FIND', `  Universe #${i}: ${universeAddr} (name read failed)`);
            }
          }
        } catch {
          // ID doesn't exist or reverted, skip
        }
      }
    } catch (err: any) {
      log(
        'FIND',
        `Manager ${managerAddr.slice(0, 10)}... not accessible: ${err.message?.slice(0, 100)}`
      );
    }
  }
  return null;
}

// ── Generate Video via tRPC ───────────────────────────────────────────────────
async function generateVideo(token: string, prompt: string, sceneIndex: number): Promise<string> {
  log(`VIDEO ${sceneIndex + 1}`, 'Generating video via Seedance 2.0 Fast (text-to-video)...');
  log(`VIDEO ${sceneIndex + 1}`, `Prompt: "${prompt.slice(0, 80)}..."`);

  const result = await tRPCMutate<{ videoUrl: string }>(
    'generation.generateVideo',
    {
      prompt,
      model: 'bytedance/seedance-2.0/fast/text-to-video',
      duration: 5,
      aspectRatio: '16:9',
    },
    token
  );

  log(`VIDEO ${sceneIndex + 1}`, `Generated: ${result.videoUrl.slice(0, 80)}...`);
  return result.videoUrl;
}

// ── Upload to Storage ─────────────────────────────────────────────────────────
async function uploadToStorage(
  token: string,
  videoUrl: string,
  sceneIndex: number
): Promise<{ storageUrl: string; contentHash: string }> {
  log(`UPLOAD ${sceneIndex + 1}`, 'Uploading to decentralized storage...');

  const manifest = await tRPCMutate<{
    contentHash: string;
    uploads: { url: string; provider: string }[];
  }>(
    'storage.upload',
    {
      url: videoUrl,
      filename: `memeverse-scene-${sceneIndex + 1}-${Date.now()}.mp4`,
    },
    token
  );

  const storageUrl = manifest.uploads[0]?.url || videoUrl;
  log(`UPLOAD ${sceneIndex + 1}`, `Stored: ${storageUrl.slice(0, 80)}...`);
  log(`UPLOAD ${sceneIndex + 1}`, `Content hash: ${manifest.contentHash.slice(0, 20)}...`);
  return { storageUrl, contentHash: manifest.contentHash };
}

// ── Create On-Chain Node ──────────────────────────────────────────────────────
async function createNode(
  universeAddr: `0x${string}`,
  contentHash: string,
  plotDescription: string,
  previousNodeId: bigint,
  videoUrl: string,
  sceneIndex: number
): Promise<{ nodeId: bigint; txHash: `0x${string}` }> {
  log(`NODE ${sceneIndex + 1}`, `Creating on-chain node (parent: ${previousNodeId})...`);

  // Compute hashes
  const contentHashBytes = contentHash.startsWith('0x')
    ? (contentHash as `0x${string}`)
    : (`0x${contentHash}` as `0x${string}`);
  const plotHash = keccak256(toBytes(plotDescription));

  const txHash = await walletClient.writeContract({
    address: universeAddr,
    abi: universeAbi,
    functionName: 'createNode',
    args: [contentHashBytes, plotHash, previousNodeId, videoUrl, plotDescription],
  });

  log(`NODE ${sceneIndex + 1}`, `TX: ${txHash}`);
  log(`NODE ${sceneIndex + 1}`, `Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Node ${sceneIndex + 1} tx reverted!`);
  }

  // Parse NodeCreated event to get real node ID
  let nodeId = 0n;
  for (const logEntry of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });
      if (decoded.eventName === 'NodeCreated') {
        nodeId = BigInt((decoded.args as any).id);
      }
    } catch {}
  }

  log(`NODE ${sceneIndex + 1}`, `Confirmed! Node #${nodeId} in block ${receipt.blockNumber}`);
  return { nodeId, txHash };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  LOAR — Deploy 3 Video Nodes to Memeverse (Sepolia)');
  console.log('='.repeat(70));

  log('SETUP', `Deployer: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${formatEther(balance)} ETH`);
  if (balance < 10000000000000n) {
    throw new Error('Insufficient balance! Need some Sepolia ETH for gas.');
  }

  // ── Step 1: Find Memeverse ──────────────────────────────────────────────
  log('STEP 1', 'Searching for Memeverse universe...');
  let universeAddr = await findMemeverse();

  if (!universeAddr) {
    // Check if there's a universe at known addresses from Firestore/localStorage
    // Try the TIMELINE_ADDRESSES as a fallback
    const fallback = '0x20a882279ea84755cf0264e77590176247503643' as `0x${string}`;
    try {
      const name = await publicClient.readContract({
        address: fallback,
        abi: universeAbi,
        functionName: 'universeName',
      });
      log('STEP 1', `Found fallback universe: "${name}" @ ${fallback}`);
      universeAddr = fallback;
    } catch {
      throw new Error(
        'Memeverse not found on any known UniverseManager or fallback address.\n' +
          'Create a universe first via the web UI or test-create-universe.ts script.'
      );
    }
  }

  log('STEP 1', `Using universe: ${universeAddr}`);

  // Check current state
  const latestId = await publicClient.readContract({
    address: universeAddr,
    abi: universeAbi,
    functionName: 'latestNodeId',
  });
  log('STEP 1', `Current latest node ID: ${latestId}`);

  // Check admin and whitelist
  const admin = await publicClient.readContract({
    address: universeAddr,
    abi: universeAbi,
    functionName: 'universeAdmin',
  });
  log('STEP 1', `Universe admin: ${admin}`);
  log('STEP 1', `Our address: ${account.address}`);

  // ── Step 2: Authenticate ────────────────────────────────────────────────
  log('STEP 2', 'Authenticating with SIWE...');
  let authToken: string;
  try {
    authToken = await getAuthToken();
  } catch (err: any) {
    log('STEP 2', `Auth failed (server may not be running): ${err.message}`);
    log('STEP 2', 'Falling back to direct on-chain node creation (no video generation)...');

    // Create nodes with placeholder URLs directly on-chain
    await createNodesWithPlaceholders(universeAddr, latestId as bigint);
    return;
  }

  // ── Step 3: Generate 3 videos ───────────────────────────────────────────
  log('STEP 3', 'Generating 3 videos with shared Memeverse context...');

  const videos: { url: string; storageUrl: string; contentHash: string }[] = [];

  for (let i = 0; i < VIDEO_SCENES.length; i++) {
    const scene = VIDEO_SCENES[i];
    try {
      const videoUrl = await generateVideo(authToken, scene.prompt, i);

      // Upload to storage
      const { storageUrl, contentHash } = await uploadToStorage(authToken, videoUrl, i);
      videos.push({ url: videoUrl, storageUrl, contentHash });
    } catch (err: any) {
      log(`VIDEO ${i + 1}`, `Generation failed: ${err.message?.slice(0, 200)}`);
      log(`VIDEO ${i + 1}`, 'Using placeholder video URL...');
      // Use a placeholder hash
      const placeholderHash = keccak256(toBytes(`memeverse-scene-${i + 1}-${Date.now()}`));
      videos.push({
        url: `https://placeholder.memeverse/scene-${i + 1}.mp4`,
        storageUrl: `https://placeholder.memeverse/scene-${i + 1}.mp4`,
        contentHash: placeholderHash,
      });
    }
  }

  // ── Step 4: Deploy 3 nodes on-chain (sequential chain) ─────────────────
  log('STEP 4', 'Deploying 3 sequential nodes on-chain...');

  let previousId = latestId as bigint; // Chain off the last existing node (0 if empty)
  const nodes: { nodeId: bigint; txHash: `0x${string}` }[] = [];

  for (let i = 0; i < VIDEO_SCENES.length; i++) {
    const scene = VIDEO_SCENES[i];
    const video = videos[i];

    const result = await createNode(
      universeAddr,
      video.contentHash,
      scene.description,
      previousId,
      video.storageUrl,
      i
    );

    nodes.push(result);
    previousId = result.nodeId; // Chain: each node is child of previous
  }

  // ── Step 5: Generate wiki entries ───────────────────────────────────────
  log('STEP 5', 'Generating wiki entries for narrative context...');

  for (let i = 0; i < VIDEO_SCENES.length; i++) {
    const scene = VIDEO_SCENES[i];
    const video = videos[i];
    const node = nodes[i];

    const previousEvents = VIDEO_SCENES.slice(0, i).map((s) => ({
      title: s.title,
      description: s.description,
    }));

    try {
      await tRPCMutate(
        'wiki.generateFromVideo',
        {
          universeId: universeAddr,
          eventId: String(node.nodeId),
          videoUrl: video.storageUrl,
          title: scene.title,
          description: scene.description,
          previousEvents: previousEvents.length > 0 ? previousEvents : undefined,
        },
        authToken
      );
      log(`WIKI ${i + 1}`, `Wiki generated for "${scene.title}"`);
    } catch (err: any) {
      log(`WIKI ${i + 1}`, `Wiki generation failed (non-blocking): ${err.message?.slice(0, 100)}`);
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────
  printSummary(universeAddr, nodes);
}

// ── Fallback: Create nodes without video generation (no server needed) ────────
async function createNodesWithPlaceholders(universeAddr: `0x${string}`, currentLatestId: bigint) {
  log('FALLBACK', 'Creating 3 nodes with placeholder content (no server needed)...');

  let previousId = currentLatestId;
  const nodes: { nodeId: bigint; txHash: `0x${string}` }[] = [];

  for (let i = 0; i < VIDEO_SCENES.length; i++) {
    const scene = VIDEO_SCENES[i];
    const placeholderUrl = `https://loar.fun/memeverse/scene-${i + 1}-placeholder.mp4`;
    const contentHash = keccak256(toBytes(placeholderUrl));

    const result = await createNode(
      universeAddr,
      contentHash,
      scene.description,
      previousId,
      placeholderUrl,
      i
    );

    nodes.push(result);
    previousId = result.nodeId;
  }

  printSummary(universeAddr, nodes);
}

function printSummary(universeAddr: string, nodes: { nodeId: bigint; txHash: `0x${string}` }[]) {
  console.log('\n' + '='.repeat(70));
  console.log('  COMPLETE — 3 Video Nodes Deployed to Memeverse!');
  console.log('='.repeat(70));
  console.log(`
  Universe: ${universeAddr}
  Chain:    Sepolia (11155111)

  Nodes deployed (sequential chain):
  ${nodes
    .map(
      (n, i) => `  ${i + 1}. Node #${n.nodeId} — "${VIDEO_SCENES[i].title}"
        TX: https://sepolia.etherscan.io/tx/${n.txHash}`
    )
    .join('\n  ')}

  View in browser:
    http://localhost:5173/universe/${universeAddr}

  Narrative arc:
    Node ${nodes[0]?.nodeId} → Node ${nodes[1]?.nodeId} → Node ${nodes[2]?.nodeId}
    "Awakening"    "Conflict"     "Singularity"
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('  Cause:', err.cause);
  process.exit(1);
});
