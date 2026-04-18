/**
 * Resume the Dragon Egg deploy from the partial state left by the first run.
 *
 * Earlier, createUniverse succeeded (Universe @ 0x38f1E8B9C2D31F163FBFcBB9638dE959fEdcb964,
 * on-chain ID 0, mint tx 0x5be5abc184be626650d2008a15b0fafcf86146088e7c657c03384b6a6855193a)
 * but deployUniverseToken reverted with HookNotEnabled. Hook + locker are now
 * enabled. Videos are already pinned to IPFS. This script:
 *
 *   1. Calls deployUniverseToken with universeId=0
 *   2. Registers the universe in Firestore via SIWE
 *   3. Calls createNode() on the Universe contract for Egg Scene (root) and
 *      Egg Hatching (child)
 *   4. Migrates entities to the real universe address, writes new content docs
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
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
  type Address,
  type Log,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Resume state from prior run ───────────────────────────────────────────────
const UNIVERSE_ADDRESS = '0x38f1E8B9C2D31F163FBFcBB9638dE959fEdcb964' as Address;
const ON_CHAIN_UNIVERSE_ID = 0n;
const MINT_TX_HASH =
  '0x5be5abc184be626650d2008a15b0fafcf86146088e7c657c03384b6a6855193a' as `0x${string}`;

const PINNED_EGG = {
  url: 'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmaAaXHBQQ2ka8ZxpdzfMVhGHu9sgUi7stHkQfH6jEhY82',
  cid: 'QmaAaXHBQQ2ka8ZxpdzfMVhGHu9sgUi7stHkQfH6jEhY82',
  contentHash: '56c67f483c3a9dce' /* truncated — re-fetched below */,
  title: 'Ep 1: Ember Cradle — Egg Scene',
  description:
    "A massive crimson dragon egg sits in a nest of glowing embers deep inside a volcanic caldera. The egg's surface is covered in overlapping scales of deep red and molten gold that shimmer with internal heat. Tiny cracks of orange firelight pulse from within like a heartbeat. Rivers of lava flow in the background, casting dancing shadows. Steam rises from the obsidian floor. Cinematic wide shot, dramatic volcanic lighting, fantasy realism. No text, no people.",
};
const PINNED_HATCHING = {
  url: 'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmUJwH1rSeEnG6s8zFNST8vJhzcH5jtaCFY6nFBBiyDNdu',
  cid: 'QmUJwH1rSeEnG6s8zFNST8vJhzcH5jtaCFY6nFBBiyDNdu',
  contentHash: 'f793e0193131bfe4' /* truncated — re-fetched below */,
  title: 'Ep 1: Ember Cradle — Egg Hatching',
  description:
    'The crimson dragon egg in the volcanic caldera begins to crack. Brilliant orange light floods through widening fissures in the scaled shell. Fragments of red and gold shell tumble away as a tiny fire dragon emerges — scales gleaming like fresh embers, wings still wet and translucent, eyes glowing amber. It opens its mouth and releases its first breath — a small burst of flame that ignites the air. The lava around the nest surges in response. Cinematic close-up, magical birth moment, warm volcanic lighting. No text, no people.',
};

const STALE_UNIVERSE_ID = '0x0000000000000000000000000000019d9e5d6003';
const UNIVERSE_NAME = 'Dragon Egg';
const TOKEN_SYMBOL = 'EGG';
const UNIVERSE_DESCRIPTION = `Welcome to Dragon Egg — a universe dedicated to the most sacred and mysterious objects in all of fantasy: the eggs of dragons.

Every video in this universe captures dragon eggs in their infinite variety. Shimmering scales of molten gold catching firelight in a volcanic nest. Ice-blue eggs resting in glacial caverns, pulsing with frost magic. Obsidian shells cracking with internal flame as a hatchling stirs for the first time.

Dragon Egg is a visual meditation on potential, mystery, and the moment before everything changes.`;

const STARTING_TICK = -230400;
const TICK_SPACING = 200;

// ── Config ────────────────────────────────────────────────────────────────────
const CHAIN = baseSepolia;
const PK = (
  process.env.PRIVATE_KEY!.startsWith('0x')
    ? process.env.PRIVATE_KEY!
    : `0x${process.env.PRIVATE_KEY!}`
) as `0x${string}`;
const RPC_URL =
  process.env.RPC_84532 ??
  process.env.RPC_URL_BASE_SEPOLIA ??
  'https://base-sepolia-rpc.publicnode.com';
const SERVER_URL = (process.env.VITE_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:3001').split(',')[0].trim();
const PINATA_JWT = process.env.PINATA_JWT!;

const deployment = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'deployments/base-sepolia.json'), 'utf-8')
);
const UM = getAddress(deployment.contracts.UniverseManager) as Address;
const HOOK = getAddress(deployment.contracts.LoarHookStaticFee) as Address;
const LOCKER = getAddress(deployment.contracts.LoarLpLockerMultiple) as Address;
const WETH = '0x4200000000000000000000000000000000000006' as const;

const umArtifact = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
    'utf-8'
  )
);
const umAbi = umArtifact.abi;

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

const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
const wal = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });

const sa = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
    ),
    'utf-8'
  )
);
const app = initializeApp({ credential: cert(sa) }, `dragon-egg-resume-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const log = (step: string, msg: string) => console.log(`  [${step.padEnd(8)}] ${msg}`);

// ── Re-fetch SHA-256 of IPFS videos (we need full hash, not truncated) ────────

async function fetchContentHash(ipfsCid: string): Promise<string> {
  const { createHash } = await import('crypto');
  const url = `https://peach-impressive-moth-978.mypinata.cloud/ipfs/${ipfsCid}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${ipfsCid} failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex');
}

// ── deployUniverseToken ───────────────────────────────────────────────────────

interface DeployResult {
  tokenAddress: Address;
  governorAddress: Address;
  txHash: `0x${string}`;
}

async function deployToken(coverImageUrl: string): Promise<DeployResult> {
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
  const cfg = {
    tokenConfig: {
      tokenAdmin: account.address,
      name: UNIVERSE_NAME,
      symbol: TOKEN_SYMBOL,
      imageURL: coverImageUrl,
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

  log('CHAIN', 'Simulating deployUniverseToken(universeId=0)...');
  await pub.simulateContract({
    account,
    address: UM,
    abi: umAbi,
    functionName: 'deployUniverseToken',
    args: [cfg, ON_CHAIN_UNIVERSE_ID],
  });

  log('CHAIN', 'Simulation passed. Sending tx...');
  const txHash = await wal.writeContract({
    address: UM,
    abi: umAbi,
    functionName: 'deployUniverseToken',
    args: [cfg, ON_CHAIN_UNIVERSE_ID],
  });
  log('CHAIN', `tx: ${txHash}`);
  const r = await pub.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (r.status !== 'success') throw new Error(`deployUniverseToken reverted: ${txHash}`);
  log('CHAIN', `confirmed block ${r.blockNumber} (gas ${r.gasUsed})`);

  let tokenAddress: Address | undefined;
  let governorAddress: Address | undefined;
  for (const le of r.logs) {
    try {
      const d = decodeEventLog({ abi: umAbi, data: le.data, topics: le.topics });
      if (d.eventName === 'TokenCreated') {
        tokenAddress = (d.args as any).tokenAddress;
        governorAddress = (d.args as any).governor;
      }
    } catch {}
  }
  if (!tokenAddress || !governorAddress) throw new Error('TokenCreated event not found in receipt');
  log('CHAIN', `Token:    ${tokenAddress} ($${TOKEN_SYMBOL})`);
  log('CHAIN', `Governor: ${governorAddress}`);
  return { tokenAddress, governorAddress, txHash };
}

// ── SIWE + universes.create ───────────────────────────────────────────────────

function buildSiwe(address: string, nonce: string): string {
  const domain = new URL(SERVER_URL).hostname;
  const now = new Date();
  const exp = new Date(now.getTime() + 2 * 60 * 1000);
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
    `Expiration Time: ${exp.toISOString()}`,
  ].join('\n');
}

async function registerFirestore(
  tokenAddress: Address,
  governorAddress: Address,
  imageUrl: string
): Promise<string> {
  log('REG', 'Getting auth nonce...');
  const nr = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nr.json()) as { nonce: string };

  log('REG', 'Signing SIWE...');
  const siwe = buildSiwe(getAddress(account.address), nonce);
  const sig = await account.signMessage({ message: siwe });

  log('REG', `Verifying (Origin=${ORIGIN})...`);
  const vr = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ message: siwe, signature: sig }),
  });
  if (!vr.ok) throw new Error(`verify: ${vr.status} ${await vr.text()}`);
  const jwt = (vr.headers.get('set-cookie') ?? '').match(/siwe-session=([^;]+)/)?.[1];
  if (!jwt) throw new Error('no session cookie');

  log('REG', 'Getting creation nonce...');
  const cnr = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${jwt}`, Origin: ORIGIN } }
  );
  const cnd = (await cnr.json()) as any[];
  const cnonce = cnd[0]?.result?.data?.nonce;
  if (!cnonce) throw new Error('no creation nonce');

  const ts = Math.floor(Date.now() / 1000);
  const msg = `Create universe as ${account.address} at ${ts} nonce:${cnonce}`;
  const s2 = await account.signMessage({ message: msg });

  log('REG', 'universes.create...');
  const res = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, Origin: ORIGIN },
    body: JSON.stringify({
      '0': {
        address: UNIVERSE_ADDRESS,
        creator: account.address,
        name: UNIVERSE_NAME,
        tokenAddress,
        governanceAddress: governorAddress,
        imageUrl,
        description: UNIVERSE_DESCRIPTION,
        onChainUniverseId: ON_CHAIN_UNIVERSE_ID.toString(),
        mintTxHash: MINT_TX_HASH,
        chainId: CHAIN.id,
        signature: s2,
        message: msg,
        nonce: cnonce,
      },
    }),
  });
  const d = (await res.json()) as any[];
  if (d[0]?.error) throw new Error(`universes.create: ${JSON.stringify(d[0].error)}`);
  const data = d[0]?.result?.data;
  const id = data?.data?.id ?? data?.id;
  log('REG', `Firestore id=${id}  credits=${data?.mintCreditsAwarded ?? 0}`);
  return id;
}

// ── createNode ────────────────────────────────────────────────────────────────

function parseNode(logs: readonly Log[]): { nodeId: bigint; previous: bigint } | null {
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

async function createNode(
  contentHash: string,
  plot: string,
  link: string,
  previous: bigint
): Promise<{ nodeId: bigint; txHash: `0x${string}` }> {
  const ch = `0x${contentHash}` as `0x${string}`;
  const ph = keccak256(toBytes(plot));
  log('NODE', `simulating createNode(prev=${previous}, link=${link.slice(0, 50)}...)`);
  await pub.simulateContract({
    account,
    address: UNIVERSE_ADDRESS,
    abi: universeAbi,
    functionName: 'createNode',
    args: [ch, ph, previous, link, plot],
  });
  const txHash = await wal.writeContract({
    address: UNIVERSE_ADDRESS,
    abi: universeAbi,
    functionName: 'createNode',
    args: [ch, ph, previous, link, plot],
  });
  log('NODE', `tx ${txHash}`);
  const r = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  if (r.status !== 'success') throw new Error(`createNode reverted: ${txHash}`);
  const parsed = parseNode(r.logs);
  if (!parsed) throw new Error('NodeCreated event missing');
  log('NODE', `nodeId=${parsed.nodeId} (prev=${parsed.previous}, gas=${r.gasUsed})`);
  return { nodeId: parsed.nodeId, txHash };
}

// ── Migrate entities + write new content docs ─────────────────────────────────

async function migrateAndSeed(
  eggNode: { nodeId: bigint; txHash: string; contentHash: string },
  hatchNode: { nodeId: bigint; txHash: string; contentHash: string }
): Promise<void> {
  const realId = UNIVERSE_ADDRESS.toLowerCase();
  const now = new Date();

  log('SEED', `Migrating entities from stale ${STALE_UNIVERSE_ID} → ${realId}...`);
  const ents = await db
    .collection('entities')
    .where('universeAddress', '==', STALE_UNIVERSE_ID)
    .get();
  for (const doc of ents.docs) {
    await doc.ref.update({ universeAddress: realId, updatedAt: now });
  }
  log('SEED', `Moved ${ents.size} entities`);

  log('SEED', 'Writing new videoGenerations + content docs tied to real universe...');
  for (const pkg of [
    { pin: PINNED_EGG, node: eggNode, tag: 'egg' as const },
    { pin: PINNED_HATCHING, node: hatchNode, tag: 'hatching' as const },
  ]) {
    const generationId = randomUUID();
    await db.collection('videoGenerations').doc(generationId).set({
      id: generationId,
      prompt: pkg.pin.description,
      model: 'seedance-2.0',
      mode: 'text_to_video',
      videoUrl: pkg.pin.url,
      status: 'completed',
      universeId: realId,
      creatorUid: account.address.toLowerCase(),
      sceneTitle: pkg.pin.title,
      durationSec: 8,
      hasAudio: true,
      onChainNodeId: pkg.node.nodeId.toString(),
      onChainTxHash: pkg.node.txHash,
      contentHash: pkg.node.contentHash,
      ipfsCid: pkg.pin.cid,
      createdAt: now,
      completedAt: now,
    });

    await db.collection('content').add({
      title: pkg.pin.title,
      description: pkg.pin.description.slice(0, 300),
      mediaUrl: pkg.pin.url,
      mediaType: 'ai-video',
      classification: 'original',
      tags: ['dragon-egg', 'episode-1', pkg.tag],
      ipDeclaration: {
        isOriginal: true,
        usesCopyrightedMaterial: false,
        license: 'all-rights-reserved',
      },
      visibility: 'public',
      creatorUid: account.address.toLowerCase(),
      universeId: realId,
      contentHash: pkg.node.contentHash,
      onChainNodeId: pkg.node.nodeId.toString(),
      createdAt: now,
      updatedAt: now,
      views: 0,
      likes: 0,
      reviewStatus: 'not_required',
      generationId,
      generationModel: 'seedance-2.0',
    });
  }
  log('SEED', 'Wrote 2 new videoGenerations + 2 new content docs');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  DRAGON EGG — RESUME DEPLOY (deployUniverseToken → nodes)');
  console.log('═'.repeat(70));

  const balance = await pub.getBalance({ address: account.address });
  log('CHAIN', `Balance: ${formatEther(balance)} ETH`);
  log('CHAIN', `Universe: ${UNIVERSE_ADDRESS} (on-chain id ${ON_CHAIN_UNIVERSE_ID})`);

  // Fetch cover image URL from stale Firestore doc
  const uDoc = await db.collection('cinematicUniverses').doc(STALE_UNIVERSE_ID).get();
  const coverImageUrl = uDoc.data()?.image_url as string;
  log('LOAD', `Cover: ${coverImageUrl.slice(0, 60)}...`);

  // Re-fetch full SHA-256 of each pinned video (we only had truncated hash in memory)
  log('LOAD', `Re-computing SHA-256 of pinned videos...`);
  const eggHash = await fetchContentHash(PINNED_EGG.cid);
  const hatchHash = await fetchContentHash(PINNED_HATCHING.cid);
  PINNED_EGG.contentHash = eggHash;
  PINNED_HATCHING.contentHash = hatchHash;
  log('LOAD', `egg  sha256 = ${eggHash.slice(0, 32)}...`);
  log('LOAD', `hatch sha256 = ${hatchHash.slice(0, 32)}...`);

  // Step 1: Deploy token
  console.log('\n── Step 1: deployUniverseToken ──');
  const deploy = await deployToken(coverImageUrl);

  // Step 2: Register Firestore
  console.log('\n── Step 2: Register in Firestore ──');
  let firestoreId: string | undefined;
  try {
    firestoreId = await registerFirestore(
      deploy.tokenAddress,
      deploy.governorAddress,
      coverImageUrl
    );
  } catch (err: any) {
    log('REG', `WARNING (non-fatal): ${err.message}`);
  }

  // Step 3: Create nodes
  console.log('\n── Step 3: Create timeline nodes on-chain ──');
  const eggNode = await createNode(eggHash, PINNED_EGG.description, PINNED_EGG.url, 0n);
  const hatchNode = await createNode(
    hatchHash,
    PINNED_HATCHING.description,
    PINNED_HATCHING.url,
    eggNode.nodeId
  );

  // Step 4: Migrate + seed
  console.log('\n── Step 4: Migrate entities + write content docs ──');
  await migrateAndSeed(
    { nodeId: eggNode.nodeId, txHash: eggNode.txHash, contentHash: eggHash },
    { nodeId: hatchNode.nodeId, txHash: hatchNode.txHash, contentHash: hatchHash }
  );

  console.log('\n' + '═'.repeat(70));
  console.log('  DRAGON EGG — LIVE ON BASE SEPOLIA');
  console.log('═'.repeat(70));
  console.log(`  Universe:        ${UNIVERSE_ADDRESS}`);
  console.log(`  Token ($EGG):    ${deploy.tokenAddress}`);
  console.log(`  Governor:        ${deploy.governorAddress}`);
  console.log(`  On-chain ID:     ${ON_CHAIN_UNIVERSE_ID}`);
  console.log(`  Firestore ID:    ${firestoreId ?? '(failed; retry manually)'}`);
  console.log(`  Mint TX:         ${MINT_TX_HASH}`);
  console.log(`  Token TX:        ${deploy.txHash}`);
  console.log(`  Node #${eggNode.nodeId} (Egg):     ${eggNode.txHash}`);
  console.log(`  Node #${hatchNode.nodeId} (Hatch):   ${hatchNode.txHash}`);
  console.log(`  IPFS Egg:        ${PINNED_EGG.url}`);
  console.log(`  IPFS Hatching:   ${PINNED_HATCHING.url}`);
  console.log(`\n  Explorer: https://sepolia.basescan.org/address/${UNIVERSE_ADDRESS}`);
  console.log(`  View at:  /universe/${UNIVERSE_ADDRESS}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('Cause:', (err.cause as any)?.message);
  process.exit(1);
});
