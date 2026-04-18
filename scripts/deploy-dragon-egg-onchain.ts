/**
 * Dragon Egg — full production on-chain deploy.
 *
 * Flow (no corners cut):
 *   1. Fetch the 2 existing video URLs + cover image from the stale Firestore
 *      universe record (0x...5d6003)
 *   2. Re-pin the videos to Pinata IPFS (their signed ByteDance URLs expire)
 *   3. Deploy a real Universe contract via UniverseManager.createUniverseWithToken
 *      on Base Sepolia (token symbol: EGG)
 *   4. Register the real universe in Firestore via SIWE + universes.create tRPC
 *   5. Compute contentHash (SHA-256) + plotHash (keccak256) for each video
 *   6. Call Universe.createNode() twice — Egg Scene (root), then Egg Hatching (child)
 *   7. Re-seed 15 entities on the real universe address
 *   8. Mark the stale universe for cleanup (user confirms before delete)
 *
 * Usage:
 *   pnpm tsx scripts/deploy-dragon-egg-onchain.ts
 *
 * Required env:
 *   PRIVATE_KEY, PINATA_JWT, RPC_URL_BASE_SEPOLIA (or RPC_84532),
 *   VITE_SERVER_URL, FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { randomUUID, createHash } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  keccak256,
  toBytes,
  parseAbiItem,
  type Address,
  type Log,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ────────────────────────────────────────────────────────────────────
const CHAIN = baseSepolia;
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL =
  process.env.RPC_84532 ??
  process.env.RPC_URL_BASE_SEPOLIA ??
  'https://base-sepolia-rpc.publicnode.com';
const SERVER_URL = (process.env.VITE_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:3001').split(',')[0].trim();
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';

if (!PRIVATE_KEY || PRIVATE_KEY === '0x') throw new Error('PRIVATE_KEY not set');
if (!PINATA_JWT) throw new Error('PINATA_JWT not set');

// Canonical contract addresses (from deployments/base-sepolia.json via rebuild-deployments.ts)
const deployment = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'deployments/base-sepolia.json'), 'utf-8')
);
const UNIVERSE_MANAGER = getAddress(deployment.contracts.UniverseManager) as Address;
const HOOK = getAddress(deployment.contracts.LoarHookStaticFee) as Address;
const LOCKER = getAddress(deployment.contracts.LoarLpLockerMultiple) as Address;
const WETH = '0x4200000000000000000000000000000000000006' as const; // Base Sepolia WETH

// Universe metadata
const STALE_UNIVERSE_ID = '0x0000000000000000000000000000019d9e5d6003';
const UNIVERSE_NAME = 'Dragon Egg';
const TOKEN_SYMBOL = 'EGG';
const UNIVERSE_DESCRIPTION = `Welcome to Dragon Egg — a universe dedicated to the most sacred and mysterious objects in all of fantasy: the eggs of dragons.

Every video in this universe captures dragon eggs in their infinite variety. Shimmering scales of molten gold catching firelight in a volcanic nest. Ice-blue eggs resting in glacial caverns, pulsing with frost magic. Obsidian shells cracking with internal flame as a hatchling stirs for the first time.

Dragon Egg is a visual meditation on potential, mystery, and the moment before everything changes.`;

// Uniswap v4 pool config (same as existing create-universe-with-token.ts)
const STARTING_TICK = -230400;
const TICK_SPACING = 200;

// ── Contract ABIs ─────────────────────────────────────────────────────────────
const umArtifact = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
    'utf-8'
  )
);
const universeManagerAbi = umArtifact.abi;

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
    outputs: [{ type: 'uint256' }],
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

// ── Setup ─────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });

// Firebase Admin
const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(serviceAccount) }, `dragon-egg-deploy-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

function log(step: string, msg: string) {
  console.log(`  [${step.padEnd(8)}] ${msg}`);
}

// ── Step 1: Load stale universe data ──────────────────────────────────────────

interface StaleData {
  coverImageUrl: string;
  videoEggScene: { url: string; title: string; description: string; contentId: string };
  videoHatching: { url: string; title: string; description: string; contentId: string };
}

async function loadStaleUniverseData(): Promise<StaleData> {
  log('LOAD', `Fetching cover image from stale universe ${STALE_UNIVERSE_ID}...`);

  const uDoc = await db.collection('cinematicUniverses').doc(STALE_UNIVERSE_ID).get();
  if (!uDoc.exists) throw new Error(`Stale universe ${STALE_UNIVERSE_ID} not found`);
  const coverImageUrl = uDoc.data()?.image_url as string;
  if (!coverImageUrl) throw new Error('Cover image URL missing from stale universe');
  log('LOAD', `Cover image: ${coverImageUrl.slice(0, 60)}...`);

  // Videos were tagged 'dragon-egg' but their universeId field is stale (points
  // at Fogline's old fake address due to a prior run). Find them by tag instead.
  log('LOAD', `Finding Dragon Egg videos by tag...`);
  const contentSnap = await db
    .collection('content')
    .where('tags', 'array-contains', 'dragon-egg')
    .get();

  const videos = contentSnap.docs.filter((d) => d.data().mediaType === 'ai-video');
  if (videos.length < 2) throw new Error(`Expected ≥2 'dragon-egg' videos, got ${videos.length}`);

  let eggScene: StaleData['videoEggScene'] | null = null;
  let hatching: StaleData['videoHatching'] | null = null;

  for (const doc of videos) {
    const d = doc.data();
    const item = {
      url: d.mediaUrl as string,
      title: d.title as string,
      description: d.description as string,
      contentId: doc.id,
    };
    if (d.title.toLowerCase().includes('hatch')) hatching = item;
    else eggScene = item;
  }

  if (!eggScene || !hatching) throw new Error('Could not identify egg + hatching scenes by title');
  log('LOAD', `Egg Scene:    ${eggScene.title} (${eggScene.contentId})`);
  log('LOAD', `Hatching:     ${hatching.title} (${hatching.contentId})`);
  return { coverImageUrl, videoEggScene: eggScene, videoHatching: hatching };
}

// ── Step 2: Re-pin videos to Pinata (ByteDance URLs expire) ───────────────────

async function pinUrlToPinata(
  videoUrl: string,
  filename: string
): Promise<{ url: string; cid: string; contentHash: string; mimeType: string }> {
  log('IPFS', `Fetching ${filename}...`);
  const res = await fetch(videoUrl);
  if (!res.ok)
    throw new Error(`Video fetch failed: HTTP ${res.status} (ByteDance URL may have expired)`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') ?? 'video/mp4';
  log('IPFS', `Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Compute SHA-256 content hash (canonical ID, used on-chain)
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  // Upload to Pinata
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append('pinataMetadata', JSON.stringify({ name: filename, keyvalues: { contentHash } }));

  const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!pinRes.ok) {
    const err = await pinRes.text().catch(() => pinRes.statusText);
    throw new Error(`Pinata upload failed ${pinRes.status}: ${err.slice(0, 200)}`);
  }
  const { IpfsHash: cid } = (await pinRes.json()) as { IpfsHash: string };
  const url = `${PINATA_GATEWAY}/ipfs/${cid}`;
  log('IPFS', `Pinned: ${cid} (hash=${contentHash.slice(0, 16)}...)`);
  return { url, cid, contentHash, mimeType };
}

// ── Step 3: Deploy Universe + Token on Base Sepolia ───────────────────────────

interface DeployResult {
  txHash: `0x${string}`;
  universeAddress: Address;
  tokenAddress: Address;
  governorAddress: Address;
  universeId: bigint | null;
  mintTxHash: `0x${string}`;
}

async function deployOnChain(imageUrl: string): Promise<DeployResult> {
  log('CHAIN', `Deployer: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  log('CHAIN', `Balance: ${formatEther(balance)} ETH on ${CHAIN.name}`);

  const mintFee = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;
  log('CHAIN', `Mint fee: ${formatEther(mintFee)} ETH`);

  if (balance < mintFee + 10000000000000000n) {
    throw new Error(
      `Need ≥ ${formatEther(mintFee + 10000000000000000n)} ETH, have ${formatEther(balance)}`
    );
  }

  const poolData = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'loarFee', type: 'uint24' },
          { name: 'pairedFee', type: 'uint24' },
        ],
      },
    ],
    [{ loarFee: 3000, pairedFee: 3000 }]
  );

  const deploymentConfig = {
    tokenConfig: {
      tokenAdmin: account.address,
      name: UNIVERSE_NAME,
      symbol: TOKEN_SYMBOL,
      imageURL: imageUrl,
      metadata: `Governance token for ${UNIVERSE_NAME}`,
      context: UNIVERSE_DESCRIPTION,
    },
    poolConfig: {
      hook: HOOK,
      pairedToken: WETH,
      tickIfToken0IsLoar: STARTING_TICK,
      tickSpacing: TICK_SPACING,
      poolData,
    },
    lockerConfig: {
      locker: LOCKER,
      rewardAdmins: [account.address],
      rewardRecipients: [account.address],
      rewardBps: [10000],
      tickLower: [STARTING_TICK],
      tickUpper: [0],
      positionBps: [10000],
      lockerData: '0x' as `0x${string}`,
    },
    allocationConfig: { curveBps: 8000, creatorBps: 1000, treasuryBps: 500, communityBps: 500 },
  };

  let txHash: `0x${string}`;
  let mintTxHash: `0x${string}`;
  let universeAddress: Address | undefined;
  let tokenAddress: Address | undefined;
  let governorAddress: Address | undefined;
  let universeId: bigint | null = null;

  try {
    log('CHAIN', 'Simulating atomic createUniverseWithToken...');
    await publicClient.simulateContract({
      account,
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'createUniverseWithToken',
      args: [
        UNIVERSE_NAME,
        imageUrl,
        UNIVERSE_DESCRIPTION,
        0,
        0,
        account.address,
        deploymentConfig,
      ],
      value: mintFee,
    });
    log('CHAIN', 'Simulation passed — sending atomic tx...');
    txHash = await walletClient.writeContract({
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'createUniverseWithToken',
      args: [
        UNIVERSE_NAME,
        imageUrl,
        UNIVERSE_DESCRIPTION,
        0,
        0,
        account.address,
        deploymentConfig,
      ],
      value: mintFee,
    });
    mintTxHash = txHash;
  } catch (err: any) {
    log(
      'CHAIN',
      `Atomic reverted (${err.shortMessage ?? err.message?.slice(0, 80)}) — two-step flow`
    );
    log('CHAIN', '1/2: Creating universe...');
    mintTxHash = await walletClient.writeContract({
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'createUniverse',
      args: [UNIVERSE_NAME, imageUrl, UNIVERSE_DESCRIPTION, 0, 0, account.address],
      value: mintFee,
    });
    const r1 = await publicClient.waitForTransactionReceipt({ hash: mintTxHash, timeout: 120_000 });
    if (r1.status !== 'success') throw new Error('createUniverse reverted');
    for (const le of r1.logs) {
      try {
        const d = decodeEventLog({ abi: universeManagerAbi, data: le.data, topics: le.topics });
        if (d.eventName === 'UniverseCreated') universeAddress = (d.args as any).universe;
        if (d.eventName === 'UniverseLpSeed') universeId = (d.args as any).universeId;
      } catch {}
    }
    if (!universeAddress) throw new Error('UniverseCreated event not found in receipt');
    if (universeId === null) {
      const logs = await publicClient.getLogs({
        address: UNIVERSE_MANAGER,
        event: parseAbiItem('event UniverseCreated(address universe, address creator)'),
        fromBlock: BigInt(deployment.startBlock),
        toBlock: 'latest',
      });
      universeId = BigInt(logs.length - 1);
    }
    log('CHAIN', `Universe: ${universeAddress} (ID ${universeId}) — mint tx ${mintTxHash}`);
    log('CHAIN', '2/2: Deploying token...');
    await publicClient.simulateContract({
      account,
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'deployUniverseToken',
      args: [deploymentConfig, universeId],
    });
    txHash = await walletClient.writeContract({
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'deployUniverseToken',
      args: [deploymentConfig, universeId],
    });
  }

  log('CHAIN', `TX: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== 'success') throw new Error(`Tx reverted: ${txHash}`);
  log('CHAIN', `Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

  for (const le of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeManagerAbi, data: le.data, topics: le.topics });
      if (d.eventName === 'UniverseCreated' && !universeAddress)
        universeAddress = (d.args as any).universe;
      if (d.eventName === 'UniverseLpSeed' && universeId === null)
        universeId = (d.args as any).universeId;
      if (d.eventName === 'TokenCreated') {
        tokenAddress = (d.args as any).tokenAddress;
        governorAddress = (d.args as any).governor;
      }
    } catch {}
  }

  if (!universeAddress || !tokenAddress || !governorAddress) {
    throw new Error(
      `Missing events: universe=${universeAddress}, token=${tokenAddress}, gov=${governorAddress}`
    );
  }

  log('CHAIN', `UniverseAddress: ${universeAddress}`);
  log('CHAIN', `TokenAddress:    ${tokenAddress} ($${TOKEN_SYMBOL})`);
  log('CHAIN', `Governor:        ${governorAddress}`);
  return { txHash, mintTxHash, universeAddress, tokenAddress, governorAddress, universeId };
}

// ── Step 4: Register in Firestore via SIWE ────────────────────────────────────

function buildSiweMessage(address: string, nonce: string): string {
  const domain = new URL(SERVER_URL).hostname;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${SERVER_URL}`,
    `Version: 1`,
    `Chain ID: ${CHAIN.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function registerInFirestore(deploy: DeployResult, imageUrl: string): Promise<string> {
  log('REGISTER', 'Getting SIWE nonce...');
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!nonceRes.ok) throw new Error(`Nonce fetch: ${nonceRes.status}`);
  const { nonce: authNonce } = (await nonceRes.json()) as { nonce: string };

  log('REGISTER', 'Signing SIWE...');
  const siwe = buildSiweMessage(getAddress(account.address), authNonce);
  const sig = await account.signMessage({ message: siwe });

  log('REGISTER', `Verifying (Origin=${ORIGIN})...`);
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ message: siwe, signature: sig }),
  });
  if (!verifyRes.ok)
    throw new Error(`Verify failed ${verifyRes.status}: ${await verifyRes.text()}`);
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const jwt = setCookie.match(/siwe-session=([^;]+)/)?.[1];
  if (!jwt) throw new Error('No session cookie');
  log('REGISTER', 'Authenticated');

  log('REGISTER', 'Getting universe creation nonce...');
  const cnRes = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${jwt}`, Origin: ORIGIN } }
  );
  const cnData = (await cnRes.json()) as any[];
  const createNonce = cnData[0]?.result?.data?.nonce;
  if (!createNonce) throw new Error(`No creation nonce: ${JSON.stringify(cnData).slice(0, 200)}`);

  const ts = Math.floor(Date.now() / 1000);
  const createMsg = `Create universe as ${account.address} at ${ts} nonce:${createNonce}`;
  const createSig = await account.signMessage({ message: createMsg });

  log('REGISTER', 'Creating Firestore doc...');
  const cRes = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, Origin: ORIGIN },
    body: JSON.stringify({
      '0': {
        address: deploy.universeAddress,
        creator: account.address,
        name: UNIVERSE_NAME,
        tokenAddress: deploy.tokenAddress,
        governanceAddress: deploy.governorAddress,
        imageUrl,
        description: UNIVERSE_DESCRIPTION,
        onChainUniverseId: deploy.universeId?.toString(),
        mintTxHash: deploy.mintTxHash,
        chainId: CHAIN.id,
        signature: createSig,
        message: createMsg,
        nonce: createNonce,
      },
    }),
  });
  const cData = (await cRes.json()) as any[];
  if (cData[0]?.error) throw new Error(`universes.create: ${JSON.stringify(cData[0].error)}`);
  const result = cData[0]?.result?.data;
  const id = result?.data?.id ?? result?.id;
  log('REGISTER', `Firestore ID: ${id}`);
  log('REGISTER', `Credits awarded: ${result?.mintCreditsAwarded ?? 0}`);
  return id;
}

// ── Step 5: Create timeline nodes on-chain ────────────────────────────────────

function parseNodeCreated(logs: readonly Log[]): { nodeId: bigint; previous: bigint } | null {
  for (const le of logs) {
    try {
      const d = decodeEventLog({ abi: universeAbi, data: le.data, topics: le.topics });
      if (d.eventName === 'NodeCreated') {
        return { nodeId: BigInt((d.args as any).id), previous: BigInt((d.args as any).previous) };
      }
    } catch {}
  }
  return null;
}

async function createNodeOnChain(
  universeAddress: Address,
  contentHash: string,
  description: string,
  videoUrl: string,
  previousNodeId: bigint
): Promise<{ nodeId: bigint; txHash: `0x${string}` }> {
  const contentHashBytes = `0x${contentHash}` as `0x${string}`;
  const plotHash = keccak256(toBytes(description));

  log('NODE', `Simulating createNode(prev=${previousNodeId})...`);
  await publicClient.simulateContract({
    account,
    address: universeAddress,
    abi: universeAbi,
    functionName: 'createNode',
    args: [contentHashBytes, plotHash, previousNodeId, videoUrl, description],
  });

  const txHash = await walletClient.writeContract({
    address: universeAddress,
    abi: universeAbi,
    functionName: 'createNode',
    args: [contentHashBytes, plotHash, previousNodeId, videoUrl, description],
  });
  log('NODE', `TX: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error(`createNode reverted: ${txHash}`);

  const parsed = parseNodeCreated(receipt.logs);
  if (!parsed) throw new Error('NodeCreated event missing from receipt');
  log('NODE', `Created node ${parsed.nodeId} (prev=${parsed.previous}, gas=${receipt.gasUsed})`);
  return { nodeId: parsed.nodeId, txHash };
}

// ── Step 6: Re-seed entities + update content to point at real universe ───────

async function reseedEntitiesAndContent(
  realUniverseAddress: string,
  eggNode: {
    nodeId: bigint;
    txHash: string;
    pinUrl: string;
    contentHash: string;
    description: string;
    title: string;
  },
  hatchNode: {
    nodeId: bigint;
    txHash: string;
    pinUrl: string;
    contentHash: string;
    description: string;
    title: string;
  }
): Promise<void> {
  const realId = realUniverseAddress.toLowerCase();
  const now = new Date();

  log('SEED', `Updating entities → universeAddress=${realId}...`);
  const entSnap = await db
    .collection('entities')
    .where('universeAddress', '==', STALE_UNIVERSE_ID)
    .get();
  for (const doc of entSnap.docs) {
    await doc.ref.update({ universeAddress: realId, updatedAt: now });
  }
  log('SEED', `Moved ${entSnap.size} entities to real universe`);

  log('SEED', `Adding new content records + videoGenerations tied to real universe...`);
  for (const node of [eggNode, hatchNode]) {
    const generationId = randomUUID();
    await db.collection('videoGenerations').doc(generationId).set({
      id: generationId,
      prompt: node.description,
      model: 'seedance-2.0',
      mode: 'text_to_video',
      videoUrl: node.pinUrl,
      status: 'completed',
      universeId: realId,
      creatorUid: account.address.toLowerCase(),
      sceneTitle: node.title,
      durationSec: 8,
      hasAudio: true,
      onChainNodeId: node.nodeId.toString(),
      onChainTxHash: node.txHash,
      contentHash: node.contentHash,
      createdAt: now,
      completedAt: now,
    });

    await db.collection('content').add({
      title: node.title,
      description: node.description.slice(0, 300),
      mediaUrl: node.pinUrl,
      mediaType: 'ai-video',
      classification: 'original',
      tags: [
        'dragon-egg',
        'episode-1',
        node.title.toLowerCase().includes('hatch') ? 'hatching' : 'egg',
      ],
      ipDeclaration: {
        isOriginal: true,
        usesCopyrightedMaterial: false,
        license: 'all-rights-reserved',
      },
      visibility: 'public',
      creatorUid: account.address.toLowerCase(),
      universeId: realId,
      contentHash: node.contentHash,
      onChainNodeId: node.nodeId.toString(),
      createdAt: now,
      updatedAt: now,
      views: 0,
      likes: 0,
      reviewStatus: 'not_required',
      generationId,
      generationModel: 'seedance-2.0',
    });
  }
  log('SEED', `Wrote 2 new content + videoGenerations records`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  DRAGON EGG — PRODUCTION ON-CHAIN DEPLOY');
  console.log('═'.repeat(70));
  console.log(`  Chain:            ${CHAIN.name} (${CHAIN.id})`);
  console.log(`  UniverseManager:  ${UNIVERSE_MANAGER}`);
  console.log(`  Hook:             ${HOOK}`);
  console.log(`  Locker:           ${LOCKER}`);
  console.log(`  Creator:          ${account.address}`);
  console.log(`  Server:           ${SERVER_URL}`);
  console.log(`  Origin:           ${ORIGIN}`);
  console.log(`  Firebase:         ${serviceAccount.project_id}\n`);

  // Step 1
  const stale = await loadStaleUniverseData();

  // Step 2: Re-pin videos
  console.log('\n── Step 2: Re-pinning videos to Pinata IPFS ──');
  const pinEgg = await pinUrlToPinata(stale.videoEggScene.url, 'dragon-egg-scene.mp4');
  const pinHatch = await pinUrlToPinata(stale.videoHatching.url, 'dragon-egg-hatching.mp4');

  // Step 3: Deploy on-chain
  console.log('\n── Step 3: Deploying Universe + Token on Base Sepolia ──');
  const deploy = await deployOnChain(stale.coverImageUrl);

  // Step 4: Register in Firestore
  console.log('\n── Step 4: Registering in Firestore via SIWE ──');
  let firestoreId: string | undefined;
  try {
    firestoreId = await registerInFirestore(deploy, stale.coverImageUrl);
  } catch (err: any) {
    log('REGISTER', `WARNING: ${err.message}`);
    log('REGISTER', 'On-chain universe is live; Firestore registration failed — can retry later.');
  }

  // Step 5: Create 2 timeline nodes
  console.log('\n── Step 5: Creating timeline nodes on-chain ──');
  const eggResult = await createNodeOnChain(
    deploy.universeAddress,
    pinEgg.contentHash,
    stale.videoEggScene.description,
    pinEgg.url,
    0n // root node
  );
  const hatchResult = await createNodeOnChain(
    deploy.universeAddress,
    pinHatch.contentHash,
    stale.videoHatching.description,
    pinHatch.url,
    eggResult.nodeId // child of egg
  );

  // Step 6: Re-seed entities & content
  console.log('\n── Step 6: Migrating entities + content to real universe ──');
  await reseedEntitiesAndContent(
    deploy.universeAddress,
    {
      nodeId: eggResult.nodeId,
      txHash: eggResult.txHash,
      pinUrl: pinEgg.url,
      contentHash: pinEgg.contentHash,
      description: stale.videoEggScene.description,
      title: stale.videoEggScene.title,
    },
    {
      nodeId: hatchResult.nodeId,
      txHash: hatchResult.txHash,
      pinUrl: pinHatch.url,
      contentHash: pinHatch.contentHash,
      description: stale.videoHatching.description,
      title: stale.videoHatching.title,
    }
  );

  console.log('\n' + '═'.repeat(70));
  console.log('  DRAGON EGG — LIVE ON BASE SEPOLIA');
  console.log('═'.repeat(70));
  console.log(`  Universe:         ${deploy.universeAddress}`);
  console.log(`  Token ($EGG):     ${deploy.tokenAddress}`);
  console.log(`  Governor:         ${deploy.governorAddress}`);
  console.log(`  On-chain ID:      ${deploy.universeId}`);
  console.log(`  Mint TX:          ${deploy.mintTxHash}`);
  console.log(`  Final TX:         ${deploy.txHash}`);
  console.log(`  Firestore ID:     ${firestoreId ?? '(registration failed; retry manually)'}`);
  console.log(`  Egg Node:         #${eggResult.nodeId} (tx ${eggResult.txHash})`);
  console.log(`  Hatching Node:    #${hatchResult.nodeId} (tx ${hatchResult.txHash})`);
  console.log(`  IPFS — Egg:       ${pinEgg.url}`);
  console.log(`  IPFS — Hatching:  ${pinHatch.url}`);
  console.log(`\n  Explorer:   https://sepolia.basescan.org/address/${deploy.universeAddress}`);
  console.log(`  View at:    /universe/${deploy.universeAddress}`);
  console.log(`\n  The stale Firestore universe ${STALE_UNIVERSE_ID} is still present.`);
  console.log(`  Delete it manually via scripts/cleanup-dragon-egg.ts once verified.\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('Cause:', (err.cause as any)?.message);
  process.exit(1);
});
