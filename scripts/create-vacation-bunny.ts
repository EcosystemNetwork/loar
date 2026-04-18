/**
 * Deploy "The Vacation Bunny Universe" + $BUNNY token — full end-to-end.
 *
 * Pilot episode: "Butterfly Days in Cannes" (dialogue-free, Pixar-style kids' show).
 * Story by YOONJEONG HAN.
 *
 * Usage: pnpm tsx scripts/create-vacation-bunny.ts
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

const artifact = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
    'utf-8'
  )
);
const universeManagerAbi = artifact.abi;

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

const deployment = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'deployments/sepolia.json'), 'utf-8')
);
const UNIVERSE_MANAGER = getAddress(deployment.contracts.UniverseManager) as `0x${string}`;
const HOOK = getAddress(deployment.contracts.LoarHookStaticFee) as `0x${string}`;
const LOCKER = getAddress(deployment.contracts.LoarLpLockerMultiple) as `0x${string}`;
const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9' as const;

const UNIVERSE_NAME = 'The Vacation Bunny Universe';
const TOKEN_SYMBOL = 'BUNNY';
const UNIVERSE_DESCRIPTION =
  'A dialogue-free, Pixar-style animated kids\' universe about Judy and her daughter — two anthropomorphic bunnies who travel the world together making small, quiet, powerful memories. Each episode is a single vacation: a new city, the same two matching butterfly pendants, the same tender bond. No villains, no monsters, no loud stakes. Only mornings, mirrors, croissants, ocean light, and the tiny rituals that turn a childhood into a memory. The pilot "Butterfly Days in Cannes" follows a single sunlit day on the French Riviera — a mirror-selfie breakfast, a beach lunch defended from a thieving seagull, a spiral climb up an old castle tower, a night carousel, and a final hush of sleep where two butterfly necklaces rest side by side in the dark. Story by YOONJEONG HAN.';

const COVER_PROMPT = [
  `Pixar-style 3D animated movie poster for "${UNIVERSE_NAME}".`,
  'Warm golden-hour light over the Cannes French Riviera coastline — pastel yellow parasols, terracotta rooftops, turquoise Mediterranean sea.',
  'Centered: two adorable anthropomorphic bunny characters holding hands, walking toward camera.',
  'Left: a tall mother bunny with deep purple eyes, soft white fur, wearing a dark navy-purple silky dress, a tiny WHITE butterfly pendant necklace on her chest.',
  'Right: a small child bunny with bright purple eyes, cream-yellow fur, wearing a baby-yellow long-sleeve tutu dress that flares, a small sparkling tiara between her ears, a tiny PURPLE butterfly pendant necklace on her chest.',
  'Both pendants catching the sunset light. Soft butterflies drifting in the warm air around them.',
  'Title "BUTTERFLY DAYS IN CANNES" shown as a soft handwritten golden script across the top.',
  'Cinematic depth of field, dreamy glow, soft pastel palette, emotional storytelling, golden hour lighting.',
  "Child-friendly, heartwarming, kids' animated feature poster aesthetic. No text errors. No watermarks. No logos.",
].join(' ');

const STARTING_TICK = -230400;
const TICK_SPACING = 200;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

async function generateCoverImageDirect(): Promise<Buffer> {
  log('IMAGE', 'Trying direct Google Imagen 4...');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: COVER_PROMPT }],
        parameters: { sampleCount: 1, aspectRatio: '16:9', personGeneration: 'allow_adult' },
      }),
    }
  );
  if (!res.ok) throw new Error(`Imagen 4 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded: string }> };
  if (!data.predictions?.length) throw new Error('No images returned');
  return Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
}

async function getServerJwt(): Promise<string> {
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
  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    throw new Error(`verify ${verifyRes.status}: ${body.slice(0, 300)}`);
  }
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) {
    const body = await verifyRes.text();
    throw new Error(`No session cookie. Body: ${body.slice(0, 300)}`);
  }
  return match[1];
}

async function generateCoverImageViaServer(): Promise<Buffer> {
  log('IMAGE', 'Falling back to server image.generate (model router)...');
  const jwt = await getServerJwt();

  const res = await fetch(`${SERVER_URL}/trpc/image.generate?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      '0': {
        prompt: COVER_PROMPT,
        task: 'text_to_image',
        imageSize: 'landscape_16_9',
        numImages: 1,
        routingMode: 'auto',
        qualityTarget: 'premium',
      },
    }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC image.generate: ${JSON.stringify(json[0].error).slice(0, 300)}`);
  const d = json[0]?.result?.data;
  const url = d?.imageUrls?.[0] || d?.images?.[0]?.url || d?.url;
  if (!url) throw new Error('No image URL from server');
  log('IMAGE', `Server returned: ${url.slice(0, 80)}...`);
  const dl = await fetch(url);
  if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}

async function generateCoverImage(): Promise<Buffer> {
  try {
    const buf = await generateCoverImageDirect();
    log('IMAGE', `Generated: ${(buf.length / 1024).toFixed(0)} KB`);
    return buf;
  } catch (err: any) {
    log('IMAGE', `Direct Imagen failed: ${err.message?.slice(0, 120)}`);
    const buf = await generateCoverImageViaServer();
    log('IMAGE', `Generated via server: ${(buf.length / 1024).toFixed(0)} KB`);
    return buf;
  }
}

async function pinToPinata(imageBuffer: Buffer, filename: string): Promise<string> {
  log('PINATA', 'Uploading to IPFS...');
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
  if (!res.ok) throw new Error(`Pinata failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { IpfsHash: string; PinSize: number };
  const url = `${PINATA_GATEWAY}/ipfs/${data.IpfsHash}`;
  log('PINATA', `Pinned: ${data.IpfsHash}`);
  log('PINATA', `URL: ${url}`);
  return url;
}

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
    log('CHAIN', 'Atomic reverted — using two-step flow');
    log('CHAIN', 'Step 1/2: createUniverse...');
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
    log('CHAIN', `Universe: ${universeAddress} (ID: ${universeId})`);

    if (universeId === null) {
      const { parseAbiItem } = await import('viem');
      const logs = await publicClient.getLogs({
        address: UNIVERSE_MANAGER,
        event: parseAbiItem('event UniverseCreated(address universe, address creator)'),
        fromBlock: BigInt(deployment.startBlock),
        toBlock: 'latest',
      });
      universeId = BigInt(logs.length - 1);
    }

    log('CHAIN', 'Step 2/2: deployUniverseToken...');
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
  if (receipt.status !== 'success') throw new Error(`Tx reverted! Status: ${receipt.status}`);
  log('CHAIN', `Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

  for (const logEntry of receipt.logs) {
    try {
      const d = decodeEventLog({
        abi: universeManagerAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });
      if (d.eventName === 'UniverseCreated') universeAddress = (d.args as any).universe;
      if (d.eventName === 'UniverseLpSeed') universeId = (d.args as any).universeId;
      if (d.eventName === 'TokenCreated') {
        tokenAddress = (d.args as any).tokenAddress;
        governorAddress = (d.args as any).governor;
      }
    } catch {}
  }

  if (!universeAddress || !tokenAddress || !governorAddress) {
    throw new Error('Missing events in receipt');
  }

  log('CHAIN', `Universe : ${universeAddress}`);
  log('CHAIN', `Token    : ${tokenAddress} ($${TOKEN_SYMBOL})`);
  log('CHAIN', `Governor : ${governorAddress}`);
  return { txHash, universeAddress, tokenAddress, governorAddress, universeId };
}

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
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!nonceRes.ok) throw new Error(`Nonce fetch failed: ${nonceRes.status}`);
  const { nonce: authNonce } = (await nonceRes.json()) as { nonce: string };

  const siweMessage = buildSiweMessage({
    address: getAddress(account.address),
    nonce: authNonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message: siweMessage });

  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ message: siweMessage, signature }),
  });
  if (!verifyRes.ok) throw new Error(`Auth verify failed: ${await verifyRes.text()}`);

  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const jwtMatch = setCookie.match(/siwe-session=([^;]+)/);
  const jwt = jwtMatch?.[1];
  if (!jwt) throw new Error('No session token');
  log('REGISTER', `Authenticated as ${account.address}`);

  const createNonceRes = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const createNonceData = (await createNonceRes.json()) as any[];
  const createNonce = createNonceData[0]?.result?.data?.nonce;
  if (!createNonce) throw new Error('Failed to get creation nonce');

  const createMsg = `Register universe ${deploy.universeAddress} created by ${account.address} with nonce ${createNonce} at ${Date.now()}`;
  const createSig = await account.signMessage({ message: createMsg });

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
    throw new Error(`Firestore failed: ${JSON.stringify(createData[0].error)}`);
  }
  const result = createData[0]?.result?.data;
  log('REGISTER', `Firestore ID: ${result?.data?.id ?? 'unknown'}`);
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — The Vacation Bunny Universe + $BUNNY');
  console.log('  Pilot: "Butterfly Days in Cannes"');
  console.log('  Story by YOONJEONG HAN');
  console.log('═'.repeat(60));
  console.log(`  Deployer: ${account.address}`);
  console.log(`  Chain:    Sepolia (${sepolia.id})`);
  console.log(`  Server:   ${SERVER_URL}\n`);

  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not set');
  if (!PINATA_JWT) throw new Error('PINATA_JWT not set');

  const imageBuffer = await generateCoverImage();
  const imageUrl = await pinToPinata(imageBuffer, `vacation-bunny-cover.jpg`);
  const deploy = await deployOnChain(imageUrl);

  try {
    await registerInFirestore(deploy, imageUrl);
  } catch (err: any) {
    log('REGISTER', `WARNING: ${err.message}`);
  }

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

  Next: BUNNY_ADDR=${deploy.universeAddress} pnpm tsx scripts/vacation-bunny-wiki.ts
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('Cause:', (err.cause as any)?.message);
  process.exit(1);
});
