/**
 * Full end-to-end universe + token deployment.
 *
 * Flow:
 *   1. Generate cover image via fal.ai
 *   2. Pin image to IPFS via Pinata (permanent URL)
 *   3. Create universe + deploy token on-chain (atomic tx)
 *   4. Register universe in Firestore via tRPC (SIWE auth)
 *
 * Usage: pnpm tsx scripts/create-universe-with-token.ts
 *
 * Required env: PRIVATE_KEY, FAL_KEY, PINATA_JWT, PINATA_GATEWAY_URL
 * Optional env: RPC_URL, VITE_SERVER_URL
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── ABI ───────────────────────────────────────────────────────────────────────
const artifact = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
    'utf-8'
  )
);
const universeManagerAbi = artifact.abi;

// ── Config ────────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const FAL_KEY = process.env.FAL_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// Contract addresses — loaded from deployment manifest
const deployment = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'deployments/sepolia.json'), 'utf-8')
);
const UNIVERSE_MANAGER = getAddress(deployment.contracts.UniverseManager) as `0x${string}`;
const HOOK = getAddress(deployment.contracts.LoarHookStaticFee) as `0x${string}`;
const LOCKER = getAddress(deployment.contracts.LoarLpLockerMultiple) as `0x${string}`;
const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9' as const; // Sepolia WETH

// ── Universe config ───────────────────────────────────────────────────────────
const UNIVERSE_NAME = 'Voidborn Saga';
const TOKEN_SYMBOL = 'VOID';
const UNIVERSE_DESCRIPTION =
  'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.';

const COVER_PROMPT = [
  `Epic cinematic movie poster for "${UNIVERSE_NAME}".`,
  'A vast cosmic void with collapsing dimensional rifts, swirling dark matter forming humanoid silhouettes.',
  'A lone figure made of starlight and shadow floats at the center, hands outstretched,',
  'weaving glowing narrative threads that spiral into new galaxies.',
  'Dying universes collapse in the background like shattered stained glass.',
  'Deep purple, black, and electric gold color palette, bioluminescent particle effects.',
  'Ultra-detailed 8K concept art, dramatic scale, no text, no watermarks, no logos.',
].join(' ');

// Pool config
const STARTING_TICK = -230400;
const TICK_SPACING = 200;

// ── Setup ─────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

// ── Step 1: Generate cover image via fal.ai ───────────────────────────────────

async function generateCoverImage(): Promise<Buffer> {
  log('IMAGE', 'Generating cover image via fal.ai (flux-pro)...');

  // Submit to queue
  const submitRes = await fetch('https://queue.fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: COVER_PROMPT,
      image_size: 'landscape_16_9',
      num_images: 1,
      enable_safety_checker: true,
    }),
  });

  if (!submitRes.ok) {
    throw new Error(`fal.ai submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  const { request_id, response_url } = (await submitRes.json()) as {
    request_id: string;
    response_url: string;
  };
  log('IMAGE', `Queued: ${request_id}`);

  // Poll for completion
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${response_url}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` },
    });
    const status = (await statusRes.json()) as { status: string };
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED') throw new Error('fal.ai generation failed');
  }

  // Fetch result
  const resultRes = await fetch(response_url, {
    headers: { Authorization: `Key ${FAL_KEY}` },
  });
  const result = (await resultRes.json()) as {
    images: Array<{ url: string; width: number; height: number }>;
  };

  if (!result.images?.length) throw new Error('No images in fal.ai response');

  const imageUrl = result.images[0].url;
  log('IMAGE', `Generated: ${imageUrl.slice(0, 60)}...`);

  // Download the image bytes (fal URLs are temporary)
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  log('IMAGE', `Downloaded: ${(buffer.length / 1024).toFixed(0)} KB`);

  return buffer;
}

// ── Step 2: Pin image to IPFS via Pinata ──────────────────────────────────────

async function pinToPinata(imageBuffer: Buffer, filename: string): Promise<string> {
  log('PINATA', 'Uploading to Pinata IPFS...');

  const form = new FormData();
  form.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), filename);
  form.append(
    'pinataMetadata',
    JSON.stringify({ name: `${UNIVERSE_NAME} cover`, keyvalues: { universe: UNIVERSE_NAME } })
  );

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { IpfsHash: string; PinSize: number };
  const permanentUrl = `${PINATA_GATEWAY}/ipfs/${data.IpfsHash}`;
  log('PINATA', `Pinned: ${data.IpfsHash} (${(data.PinSize / 1024).toFixed(0)} KB)`);
  log('PINATA', `URL: ${permanentUrl}`);

  // Verify the URL is accessible
  const headRes = await fetch(permanentUrl, { method: 'HEAD' });
  if (!headRes.ok) {
    log('PINATA', `WARNING: HEAD check returned ${headRes.status} (may need gateway propagation)`);
  }

  return permanentUrl;
}

// ── Step 3: Deploy universe + token on-chain ──────────────────────────────────

interface DeployResult {
  txHash: `0x${string}`;
  universeAddress: string;
  tokenAddress: string;
  governorAddress: string;
  universeId: bigint | null;
}

async function deployOnChain(imageUrl: string): Promise<DeployResult> {
  log('CHAIN', `Contract: ${UNIVERSE_MANAGER}`);

  const balance = await publicClient.getBalance({ address: account.address });
  log('CHAIN', `Balance: ${formatEther(balance)} ETH`);

  const mintFee = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;
  log('CHAIN', `Mint fee: ${formatEther(mintFee)} ETH`);

  if (balance < mintFee + 5000000000000000n) {
    throw new Error(`Need at least ${formatEther(mintFee + 5000000000000000n)} ETH`);
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

  // Try atomic first, fall back to two-step if it reverts
  let txHash: `0x${string}`;
  let universeAddress: string | undefined;
  let tokenAddress: string | undefined;
  let governorAddress: string | undefined;
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
  } catch {
    log('CHAIN', 'Atomic call reverted — using two-step flow');

    // Step A: Create universe
    log('CHAIN', 'Step 1/2: Creating universe...');
    const h1 = await walletClient.writeContract({
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'createUniverse',
      args: [UNIVERSE_NAME, imageUrl, UNIVERSE_DESCRIPTION, 0, 0, account.address],
      value: mintFee,
    });
    const r1 = await publicClient.waitForTransactionReceipt({ hash: h1, timeout: 120_000 });
    if (r1.status !== 'success') throw new Error('createUniverse reverted');

    for (const logEntry of r1.logs) {
      try {
        const d = decodeEventLog({
          abi: universeManagerAbi,
          data: logEntry.data,
          topics: logEntry.topics,
        });
        if (d.eventName === 'UniverseCreated') universeAddress = (d.args as any).universe;
        if (d.eventName === 'UniverseLpSeed') universeId = (d.args as any).universeId;
      } catch {}
    }
    log('CHAIN', `Universe created: ${universeAddress} (ID: ${universeId})`);

    if (universeId === null) {
      // Resolve ID from event count
      const { parseAbiItem } = await import('viem');
      const logs = await publicClient.getLogs({
        address: UNIVERSE_MANAGER,
        event: parseAbiItem('event UniverseCreated(address universe, address creator)'),
        fromBlock: BigInt(deployment.startBlock),
        toBlock: 'latest',
      });
      universeId = BigInt(logs.length - 1);
      log('CHAIN', `Resolved universe ID from events: ${universeId}`);
    }

    // Step B: Deploy token
    log('CHAIN', 'Step 2/2: Deploying token...');
    log('CHAIN', 'Simulating deployUniverseToken...');
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
  log('CHAIN', `Explorer: https://sepolia.etherscan.io/tx/${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted! Status: ${receipt.status}`);
  }
  log('CHAIN', `Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

  // Parse events from final receipt
  for (const logEntry of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });
      if (decoded.eventName === 'UniverseCreated') {
        universeAddress = (decoded.args as any).universe;
        log('CHAIN', `UniverseCreated: ${universeAddress}`);
      }
      if (decoded.eventName === 'UniverseLpSeed') {
        universeId = (decoded.args as any).universeId;
        log('CHAIN', `Universe ID: ${universeId}`);
      }
      if (decoded.eventName === 'TokenCreated') {
        tokenAddress = (decoded.args as any).tokenAddress;
        governorAddress = (decoded.args as any).governor;
        log('CHAIN', `TokenCreated: ${tokenAddress} ($${TOKEN_SYMBOL})`);
        log('CHAIN', `Governor: ${governorAddress}`);
      }
    } catch {
      // Not our event
    }
  }

  if (!universeAddress || !tokenAddress || !governorAddress) {
    throw new Error('Missing events in receipt — universe or token deployment failed');
  }

  return { txHash, universeAddress, tokenAddress, governorAddress, universeId };
}

// ── Step 4: Register in Firestore via SIWE + tRPC ─────────────────────────────

function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const domain = new URL(SERVER_URL).hostname;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${SERVER_URL}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function registerInFirestore(deploy: DeployResult, imageUrl: string): Promise<void> {
  log('REGISTER', 'Authenticating via SIWE...');

  // 1. Get nonce
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!nonceRes.ok) throw new Error(`Nonce fetch failed: ${nonceRes.status}`);
  const { nonce: authNonce } = (await nonceRes.json()) as { nonce: string };

  // 2. Sign SIWE message
  const siweMessage = buildSiweMessage({
    address: getAddress(account.address),
    nonce: authNonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message: siweMessage });

  // 3. Verify to get JWT
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ message: siweMessage, signature }),
  });

  if (!verifyRes.ok) throw new Error(`Auth verify failed: ${await verifyRes.text()}`);

  // Extract JWT from cookie or response
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const jwtMatch = setCookie.match(/siwe-session=([^;]+)/);
  const jwt = jwtMatch?.[1];
  if (!jwt) throw new Error('No session token in verify response');
  log('REGISTER', `Authenticated as ${account.address}`);

  // 4. Get universe creation nonce
  const createNonceRes = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const createNonceData = (await createNonceRes.json()) as any[];
  const createNonce = createNonceData[0]?.result?.data?.nonce;
  if (!createNonce) throw new Error('Failed to get creation nonce');

  // 5. Sign creation message
  const ts = Math.floor(Date.now() / 1000);
  const createMsg = `Create universe as ${account.address} at ${ts} nonce:${createNonce}`;
  const createSig = await account.signMessage({ message: createMsg });

  // 6. Register universe
  log('REGISTER', 'Registering universe in Firestore...');
  const createRes = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
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
        mintTxHash: deploy.txHash,
        signature: createSig,
        message: createMsg,
        nonce: createNonce,
      },
    }),
  });

  const createData = (await createRes.json()) as any[];
  if (createData[0]?.error) {
    throw new Error(`Firestore registration failed: ${JSON.stringify(createData[0].error)}`);
  }

  const result = createData[0]?.result?.data;
  log('REGISTER', `Firestore ID: ${result?.data?.id ?? 'unknown'}`);
  log('REGISTER', `Credits awarded: ${result?.mintCreditsAwarded ?? 0}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Full Universe + Token Deployment');
  console.log('═'.repeat(60));
  console.log(`  Deployer: ${account.address}`);
  console.log(`  Chain:    Sepolia (${sepolia.id})`);
  console.log(`  Server:   ${SERVER_URL}\n`);

  // Validate env
  if (!FAL_KEY) throw new Error('FAL_KEY not set');
  if (!PINATA_JWT) throw new Error('PINATA_JWT not set');

  // Step 1: Generate cover image
  const imageBuffer = await generateCoverImage();

  // Step 2: Pin to IPFS
  const imageUrl = await pinToPinata(imageBuffer, `${TOKEN_SYMBOL.toLowerCase()}-cover.jpg`);

  // Step 3: Deploy on-chain
  const deploy = await deployOnChain(imageUrl);

  // Step 4: Register in Firestore
  try {
    await registerInFirestore(deploy, imageUrl);
  } catch (err: any) {
    // Non-blocking — on-chain deployment already succeeded
    log('REGISTER', `WARNING: Firestore registration failed: ${err.message}`);
    log('REGISTER', 'Universe is live on-chain but may not appear in the app until registered.');
  }

  // Done
  console.log('\n' + '═'.repeat(60));
  console.log('  COMPLETE');
  console.log('═'.repeat(60));
  console.log(`
  Universe : ${UNIVERSE_NAME}
  Address  : ${deploy.universeAddress}
  Token    : $${TOKEN_SYMBOL} @ ${deploy.tokenAddress}
  Governor : ${deploy.governorAddress}
  Image    : ${imageUrl}
  TX       : https://sepolia.etherscan.io/tx/${deploy.txHash}

  Launchpad: /tokens
  Universe:  /universe/${deploy.universeAddress}
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('Cause:', (err.cause as any)?.message);
  process.exit(1);
});
