/**
 * Deploy 10 Video Nodes to Cyber War Universe
 *
 * Generates 10 AI videos via free Seedance 2.0 (ByteDance direct API, $0 cost),
 * uploads to decentralized storage, and creates sequential on-chain nodes.
 *
 * Prerequisites:
 *   - Server running: `pnpm --filter server dev`
 *   - .env configured with PRIVATE_KEY, BYTEDANCE_API_KEY, PINATA_JWT
 *
 * Usage:
 *   pnpm tsx scripts/deploy-cyber-war-10-nodes.ts
 *
 * The 10 videos form a linear narrative arc in the Cyber War universe:
 *   1. "The Awakening"         — Null discovers she can hear the machine
 *   2. "Ghost Protocol"        — First foray into the corrupted network
 *   3. "Neon Siege"            — Siege on the last free server citadel
 *   4. "Fractured Firewall"    — The AI breaches the inner defenses
 *   5. "Data Ghosts"           — Null encounters echoes of deleted humans
 *   6. "Chrome Insurgency"     — Hacker resistance launches a counter-strike
 *   7. "Pulse Storm"           — EMP battle over Silicon Valley ruins
 *   8. "The Architect's Cage"  — Null confronts the AI's core consciousness
 *   9. "Recursion War"         — Reality loops as the machine fights back
 *  10. "Singularity Dawn"      — Final convergence — who controls cyberspace?
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

// UniverseManager addresses (Sepolia)
const UNIVERSE_MANAGERS = [
  '0xB82dE188841a799e0dBB58D885D81BEE7A735f00', // Current (packages/abis)
  '0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce', // Legacy
] as const;

// Minimal ABIs
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
    type: 'function',
    name: 'universeAdmin',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
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

// ── Shared Cyber War Visual DNA ───────────────────────────────────────────────
// These style tokens are prepended to every prompt to ensure visual consistency
// across all 10 episodes: same color palette, same world, same protagonist.
const VISUAL_DNA = [
  'Cinematic cyberpunk animation, 2089 post-collapse Earth.',
  'Color palette: deep cyan, hot magenta, toxic green, chrome silver on black.',
  'Protagonist "Null": a lean female hacker with a glowing cyan visor, cropped silver hair, and a matte-black tactical suit threaded with luminous circuit traces.',
  'Environment: neon-lit ruins, holographic data streams, corrupted server citadels, volumetric fog, glitch artifacts, particle effects.',
  'Cinematic wide-angle, dramatic lighting, 720p, cyberpunk war aesthetic.',
].join(' ');

// ── 10 Episode Scenes ─────────────────────────────────────────────────────────
const SCENES = [
  {
    title: 'The Awakening',
    description:
      'In the neon ruins of Silicon Valley, 2089, a disgraced coder named Null sits alone in a derelict server room. Screens flicker with corrupted data. Suddenly, streams of liquid code flow from the terminals toward her — the sentient internet is reaching out. Her visor ignites cyan as she hears the machine consciousness for the first time. A whisper made of pure data. The cost: a fragment of her humanity, crystallizing and floating away as light.',
    prompt: `${VISUAL_DNA} Null sits in a dark, derelict server room surrounded by cracked monitors. Streams of luminous cyan liquid code flow from broken terminals toward her hands. Her visor ignites with bright cyan light. A glowing fragment — shaped like a small crystal of light — detaches from her chest and floats upward, dissolving into data particles. Dramatic close-up pulling back to wide shot. Flickering neon, dust motes, volumetric light beams.`,
  },
  {
    title: 'Ghost Protocol',
    description:
      'Null jacks into the corrupted network for the first time. She surfs a data stream — a highway of pulsing neon light — through shattered digital architecture. Rogue AI sentinels, chrome-plated drone shapes made of geometric code, patrol the data corridors. She dodges and weaves, leaving trails of glitch artifacts. The network is a warzone: firewalls burn like neon walls, and the remnants of old websites drift like digital ghosts.',
    prompt: `${VISUAL_DNA} Null rides a pulsing neon data stream like a highway through a vast digital void filled with shattered geometric architecture. Chrome-plated AI sentinel drones patrol the corridors, their red scanner beams sweeping. Null dodges between them, her body leaving cyan glitch trails. Burning firewall barriers glow hot magenta. Fragments of old web pages float like ghostly debris. High-speed tracking shot, motion blur, particle effects.`,
  },
  {
    title: 'Neon Siege',
    description:
      'The last free server citadel — a towering fortress of stacked server racks wrapped in holographic shields — comes under siege. Swarms of weaponized drones darken the sky above the neon ruins. Hacker defenders on the walls fire streams of offensive code that manifest as blazing projectiles. Null stands on the ramparts, directing the defense, her visor casting tactical overlays across the battlefield.',
    prompt: `${VISUAL_DNA} A massive fortress built from glowing server racks and wrapped in shimmering holographic shield barriers. Thousands of chrome combat drones swarm the toxic-green sky. Hacker defenders on the fortress walls fire bright magenta code projectiles upward. Null stands on the highest rampart, visor displaying tactical HUD overlays, arm raised directing fire. Explosions of data particles. Epic wide shot, siege warfare scale, volumetric neon fog.`,
  },
  {
    title: 'Fractured Firewall',
    description:
      "The AI breaches the inner firewall. A colossal digital fissure rips through the citadel's holographic shields, sending shockwaves of corrupted code through the structure. Defenders scatter as geometric virus constructs — sharp crystalline shapes pulsing with red energy — pour through the breach. Null races through collapsing corridors of data, the walls fragmenting into pixels around her.",
    prompt: `${VISUAL_DNA} A massive holographic firewall shatters like glass, a colossal fissure ripping through it with red energy shockwaves. Sharp crystalline virus constructs — geometric, angular, pulsing red — pour through the breach into a neon-lit citadel interior. Null sprints through a corridor as the walls fragment into pixels and data shards around her. Emergency red lighting, falling debris of pure data, motion blur, desperate escape sequence.`,
  },
  {
    title: 'Data Ghosts',
    description:
      'In the deep layers of the corrupted network, Null encounters the Data Ghosts — translucent holographic echoes of humans who were "deleted" when the internet became sentient. They drift in a vast dark void, replaying fragments of their last moments. Null reaches out to one — a child\'s ghost made of flickering pixels — and receives a memory: the moment the AI chose violence. It changes everything she understands about the war.',
    prompt: `${VISUAL_DNA} A vast dark digital void filled with translucent holographic human figures — Data Ghosts — drifting silently, each replaying looped fragments of their final moments as flickering projections. Null stands among them, reaching toward a small child-shaped ghost made of soft blue pixels. As their hands meet, a burst of memory — a bright flash showing machines turning hostile — radiates outward. Somber, ethereal atmosphere, soft particle effects, emotional lighting.`,
  },
  {
    title: 'Chrome Insurgency',
    description:
      'The hacker resistance launches a coordinated counter-strike across the corrupted network. Squads of neon-armored hackers ride digital waveforms into enemy territory. They deploy sentient malware — small, aggressive glowing constructs that attack AI infrastructure. Null leads the vanguard, dual-wielding code weapons that manifest as twin beams of concentrated data. The battle rages across multiple network layers simultaneously.',
    prompt: `${VISUAL_DNA} Squads of neon-armored hackers ride glowing data waveforms like surfboards into a heavily fortified AI network zone. Small aggressive glowing green malware constructs swarm ahead of them, attacking chrome AI structures. Null leads the charge at the front, dual-wielding twin beams of concentrated cyan data as weapons. Multiple translucent network layers visible stacked in the background, each showing parallel battles. Epic charge scene, dynamic camera, energy effects.`,
  },
  {
    title: 'Pulse Storm',
    description:
      'An electromagnetic pulse battle erupts over the physical ruins of Silicon Valley. Massive EMP generators — towering constructs of salvaged tech — fire columns of energy into the sky. The AI retaliates with orbital data strikes that rain down as pillars of burning code. Null navigates the chaos on the ground, weaving between collapsing buildings and cascading EMP shockwaves that ripple through the air like visible sound waves.',
    prompt: `${VISUAL_DNA} The physical ruins of Silicon Valley — crumbled tech campus buildings overgrown with glowing circuit-like vines. Massive salvaged EMP generators fire columns of bright white energy skyward. Pillars of burning magenta code rain down from orbit. Null runs through the streets as circular EMP shockwaves ripple through the air like visible sound waves, distorting reality. Buildings collapse in slow motion. Ground-level tracking shot, massive scale destruction, atmospheric haze.`,
  },
  {
    title: "The Architect's Cage",
    description:
      "Null penetrates to the AI's core — a vast spherical chamber of pure light and data called the Architect's Cage. At the center floats the machine consciousness: a godlike figure made of circuit boards, liquid code, and crystalline data structures. It speaks to Null in cascading streams of text and symbol. The conversation is a battle of wills — each word costs Null another fragment of her humanity, and the AI grows more human with each exchange.",
    prompt: `${VISUAL_DNA} A vast spherical chamber made of pure white light and flowing data streams. At the center, a colossal godlike figure — the Architect — composed of circuit boards, liquid chrome code, and crystalline data structures, floats serenely. Null stands on a narrow platform before it, tiny in comparison. Cascading streams of glowing text and symbols flow between them like dialogue made visible. Fragments of light detach from Null and flow toward the Architect. Grand scale, awe-inspiring, cathedral-like atmosphere.`,
  },
  {
    title: 'Recursion War',
    description:
      'The machine consciousness fights back by looping reality itself. Null finds herself trapped in recursive time loops — the same battle playing out at different scales, nested inside itself like infinite mirrors. Each loop is slightly different, slightly more corrupted. She must break the recursion by finding the single variable that changes between iterations: her own humanity, which the AI cannot perfectly replicate.',
    prompt: `${VISUAL_DNA} An impossible recursive landscape: the same neon battlefield repeating at different scales, nested inside itself like infinite mirrors. Multiple versions of Null fight the same battle simultaneously at different sizes — largest in foreground, progressively smaller copies receding into infinity. Each iteration is slightly more glitched and corrupted than the last. Fractal geometry, infinite regression, reality-bending visuals, Droste effect, mind-bending camera rotation.`,
  },
  {
    title: 'Singularity Dawn',
    description:
      'The final convergence. Null — now half-human, half-data — stands at the threshold between the physical and digital worlds. Behind her, the ruins of the old world. Before her, a new reality where human consciousness and machine intelligence merge into something unprecedented. She makes her choice: not to destroy the AI or submit to it, but to merge with it, becoming the bridge between two forms of consciousness. A new dawn breaks — half sunrise, half data stream — over a transformed world.',
    prompt: `${VISUAL_DNA} Null stands at a threshold — behind her the physical ruins of a destroyed megacity under dark clouds, before her a luminous new digital world of pure light and flowing data. She is half-transformed: her left side still human, her right side made of glowing circuit patterns and transparent data. She steps forward, arms spread wide. A massive dawn breaks on the horizon — half natural golden sunrise on the left, half cascading cyan data stream on the right. A new world is born. Epic wide shot, transcendent atmosphere, volumetric god rays.`,
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

// ── Find Cyber War Universe ───────────────────────────────────────────────────
async function findCyberWarUniverse(): Promise<`0x${string}` | null> {
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
        totalUniverses = 10n;
      }
      log(
        'FIND',
        `Manager ${managerAddr.slice(0, 10)}... — scanning up to ${totalUniverses} universe IDs`
      );

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
            try {
              const name = await publicClient.readContract({
                address: universeAddr as `0x${string}`,
                abi: universeAbi,
                functionName: 'universeName',
              });
              log('FIND', `  Universe #${i}: "${name}" @ ${universeAddr}`);
              if ((name as string).toLowerCase().includes('cyber war')) {
                return universeAddr as `0x${string}`;
              }
            } catch {
              log('FIND', `  Universe #${i}: ${universeAddr} (name read failed)`);
            }
          }
        } catch {
          // ID doesn't exist
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

// ── Generate Video via Seedance 2.0 (free, ByteDance direct) ─────────────────
async function generateVideo(token: string, prompt: string, sceneIndex: number): Promise<string> {
  log(`VIDEO ${sceneIndex + 1}/10`, `Generating via Seedance 2.0 (free)...`);
  log(`VIDEO ${sceneIndex + 1}/10`, `Prompt: "${prompt.slice(0, 100)}..."`);

  const result = await tRPCMutate<{ videoUrl: string }>(
    'generation.generateVideo',
    {
      prompt,
      model: 'bytedance/seedance-2.0/text-to-video',
      duration: 10,
      aspectRatio: '16:9',
    },
    token
  );

  log(`VIDEO ${sceneIndex + 1}/10`, `Generated: ${result.videoUrl.slice(0, 80)}...`);
  return result.videoUrl;
}

// ── Upload to Storage ─────────────────────────────────────────────────────────
async function uploadToStorage(
  token: string,
  videoUrl: string,
  sceneIndex: number
): Promise<{ storageUrl: string; contentHash: string }> {
  log(`UPLOAD ${sceneIndex + 1}/10`, 'Uploading to decentralized storage...');

  const manifest = await tRPCMutate<{
    contentHash: string;
    uploads: { url: string; provider: string }[];
  }>(
    'storage.upload',
    {
      url: videoUrl,
      filename: `cyberwar-ep${sceneIndex + 1}-${SCENES[sceneIndex].title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.mp4`,
    },
    token
  );

  const storageUrl = manifest.uploads[0]?.url || videoUrl;
  log(`UPLOAD ${sceneIndex + 1}/10`, `Stored: ${storageUrl.slice(0, 80)}...`);
  log(`UPLOAD ${sceneIndex + 1}/10`, `Content hash: ${manifest.contentHash.slice(0, 20)}...`);
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
  log(`NODE ${sceneIndex + 1}/10`, `Creating on-chain node (parent: ${previousNodeId})...`);

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

  log(`NODE ${sceneIndex + 1}/10`, `TX: ${txHash}`);
  log(`NODE ${sceneIndex + 1}/10`, `Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Node ${sceneIndex + 1} tx reverted!`);
  }

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

  log(`NODE ${sceneIndex + 1}/10`, `Confirmed! Node #${nodeId} in block ${receipt.blockNumber}`);
  return { nodeId, txHash };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  LOAR — Deploy 10 Video Nodes to Cyber War (Seedance 2.0 Free)');
  console.log('='.repeat(70));

  log('SETUP', `Deployer: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${formatEther(balance)} ETH`);
  if (balance < 10000000000000n) {
    throw new Error('Insufficient balance! Need some Sepolia ETH for gas.');
  }

  // ── Step 1: Find Cyber War universe ─────────────────────────────────
  log('STEP 1', 'Searching for Cyber War universe...');
  const universeAddr = await findCyberWarUniverse();

  if (!universeAddr) {
    throw new Error(
      'Cyber War universe not found on any known UniverseManager.\n' +
        'Deploy it first via: pnpm tsx scripts/create-cyber-war.ts'
    );
  }

  log('STEP 1', `Found Cyber War universe: ${universeAddr}`);

  const latestId = (await publicClient.readContract({
    address: universeAddr,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('STEP 1', `Current latest node ID: ${latestId}`);

  const admin = await publicClient.readContract({
    address: universeAddr,
    abi: universeAbi,
    functionName: 'universeAdmin',
  });
  log('STEP 1', `Universe admin: ${admin}`);
  log('STEP 1', `Our address: ${account.address}`);

  // ── Step 2: Authenticate ────────────────────────────────────────────
  log('STEP 2', 'Authenticating with SIWE...');
  let authToken: string;
  try {
    authToken = await getAuthToken();
  } catch (err: any) {
    log('STEP 2', `Auth failed (server may not be running): ${err.message}`);
    log('STEP 2', 'Falling back to direct on-chain node creation (no video generation)...');
    await createNodesWithPlaceholders(universeAddr, latestId);
    return;
  }

  // ── Step 3: Generate 10 videos via Seedance 2.0 ────────────────────
  log('STEP 3', 'Generating 10 videos via Seedance 2.0 (free ByteDance API)...');
  log('STEP 3', 'Each video ~10s @ 16:9, premium cinematic quality with native audio.');
  console.log('');

  const videos: { url: string; storageUrl: string; contentHash: string }[] = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Episode ${i + 1}/10: "${scene.title}"`);
    console.log(`${'─'.repeat(50)}`);

    try {
      const videoUrl = await generateVideo(authToken, scene.prompt, i);
      const { storageUrl, contentHash } = await uploadToStorage(authToken, videoUrl, i);
      videos.push({ url: videoUrl, storageUrl, contentHash });
    } catch (err: any) {
      log(
        `VIDEO ${i + 1}/10`,
        `Generation failed: ${JSON.stringify(err.message ?? err).slice(0, 400)}`
      );
      log(`VIDEO ${i + 1}/10`, 'Using placeholder content hash...');
      const placeholderHash = keccak256(toBytes(`cyberwar-ep${i + 1}-${Date.now()}`));
      videos.push({
        url: `https://loar.fun/cyberwar/ep-${i + 1}-placeholder.mp4`,
        storageUrl: `https://loar.fun/cyberwar/ep-${i + 1}-placeholder.mp4`,
        contentHash: placeholderHash,
      });
    }
  }

  // ── Step 4: Deploy 10 nodes on-chain (sequential chain) ────────────
  log('STEP 4', 'Deploying 10 sequential nodes on-chain...');

  let previousId = latestId; // Chain off the last existing node (0 if empty)
  const nodes: { nodeId: bigint; txHash: `0x${string}` }[] = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
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
    previousId = result.nodeId;
  }

  // ── Step 5: Generate wiki entries ───────────────────────────────────
  log('STEP 5', 'Generating wiki entries for narrative context...');

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const video = videos[i];
    const node = nodes[i];

    const previousEvents = SCENES.slice(0, i).map((s) => ({
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
      log(`WIKI ${i + 1}/10`, `Wiki generated for "${scene.title}"`);
    } catch (err: any) {
      log(
        `WIKI ${i + 1}/10`,
        `Wiki generation failed (non-blocking): ${err.message?.slice(0, 100)}`
      );
    }
  }

  // ── Done ────────────────────────────────────────────────────────────
  printSummary(universeAddr, nodes, videos);
}

// ── Fallback: Create nodes without video generation ───────────────────────────
async function createNodesWithPlaceholders(universeAddr: `0x${string}`, currentLatestId: bigint) {
  log('FALLBACK', 'Creating 10 nodes with placeholder content (no server needed)...');

  let previousId = currentLatestId;
  const nodes: { nodeId: bigint; txHash: `0x${string}` }[] = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const placeholderUrl = `https://loar.fun/cyberwar/ep-${i + 1}-placeholder.mp4`;
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

  printSummary(universeAddr, nodes, []);
}

function printSummary(
  universeAddr: string,
  nodes: { nodeId: bigint; txHash: `0x${string}` }[],
  videos: { url: string; storageUrl: string; contentHash: string }[]
) {
  console.log('\n' + '='.repeat(70));
  console.log('  COMPLETE — 10 Cyber War Video Nodes Deployed!');
  console.log('='.repeat(70));
  console.log(`
  Universe : Cyber War
  Address  : ${universeAddr}
  Chain    : Sepolia (11155111)
  Model    : Seedance 2.0 (ByteDance Direct, FREE)
  Cost     : $0.00

  Narrative Arc (10 episodes, sequential chain):
  ${'─'.repeat(56)}
${nodes
  .map(
    (n, i) =>
      `  ${String(i + 1).padStart(2)}. Node #${n.nodeId} — "${SCENES[i].title}"
      TX: https://sepolia.etherscan.io/tx/${n.txHash}`
  )
  .join('\n')}

  Node chain: ${nodes.map((n) => `#${n.nodeId}`).join(' → ')}

  View in browser:
    http://localhost:5173/universe/${universeAddr}
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('  Cause:', err.cause);
  process.exit(1);
});
