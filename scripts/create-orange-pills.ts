/**
 * Deploy "Orange Pills" universe + $OP token — full end-to-end.
 *
 * Flow:
 *   1. Generate cover image via Google Imagen 4
 *   2. Pin image to IPFS via Pinata (permanent URL)
 *   3. Create universe + deploy token on-chain (atomic tx)
 *   4. Register universe in Firestore via tRPC (SIWE auth)
 *
 * Usage: pnpm tsx scripts/create-orange-pills.ts
 *
 * Required env: PRIVATE_KEY, GOOGLE_API_KEY, PINATA_JWT, PINATA_GATEWAY_URL
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
import { universeManagerAbi } from '../packages/abis/src/generated';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ────────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// Contract addresses — loaded from deployment manifest
const deployment = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'deployments/sepolia.json'), 'utf-8')
);
const UNIVERSE_MANAGER = getAddress(deployment.contracts.UniverseManager) as `0x${string}`;
// LoarHookStaticFee was removed from deployments/sepolia.json in commit 1e2f46f
// but the UniverseManager ABI still requires a hook address. Fall back to the
// last-known deployed hook from git history (0xF5b2…968CC).
const HOOK = getAddress(
  deployment.contracts.LoarHookStaticFee ?? '0xF5b2676E0fbc7551ae3E38f25D87C941C5a968CC'
) as `0x${string}`;
const LOCKER = getAddress(deployment.contracts.LoarLpLockerMultiple) as `0x${string}`;
const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9' as const; // Sepolia WETH

// ── Universe config ───────────────────────────────────────────────────────────
const UNIVERSE_NAME = 'Orange Pills';
const TOKEN_SYMBOL = 'OP';
const UNIVERSE_DESCRIPTION =
  'In a world numbed by algorithmic consensus and synthetic certainty, a quiet movement begins to spread through the back rooms of failing cities. They call themselves the Citrine — the Orange Pilled — and they worship nothing but verifiable truth. Their sacraments are open-source code. Their scripture is any claim that can be independently proven. Their heresy is belief without evidence. When a disgraced tech journalist named Mara Vance stumbles into a Citrine vigil while chasing a story about missing cryptographers, she finds a congregation whose founder has been dead for two years and still somehow signs off every new doctrine — from a wallet no one can crack. What begins as investigative contempt warps into something worse: faith. Orange Pills is a prestige drama about what happens when a new religion refuses to lie, and about the enemies that kind of honesty inevitably makes — corporations, nation-states, and the quieter, older faiths that never survived contact with a world that can finally audit them.';

const COVER_PROMPT = [
  `Prestige drama poster for "${UNIVERSE_NAME}".`,
  'Interior of a cavernous concrete warehouse at night, lit only by the amber glow of dozens of terminal screens lining the walls.',
  'A crowd of figures kneels on a bare floor in reverent silence, many in simple linen robes, faces half-lit in orange.',
  'At the center, a low altar built from stacked server hardware with a single cracked LCD displaying a glowing block-hash signature in bitcoin-orange.',
  'One figure stands at the altar holding up a printed page of source code like scripture, lips parted mid-sermon.',
  'Rain streaks down tall industrial windows at the back; beyond them a distant city skyline flickers and stutters, power grid unstable.',
  'On the far wall, a hand-painted symbol: a simple circle bisected by a checkmark, in the same bitcoin-orange pigment.',
  'Cinematic prestige drama composition, 2.39:1 widescreen, moody amber and deep blue-black palette, volumetric light through rain-wet air, shallow depth of field.',
  'No text, no watermarks, no logos.',
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

// ── Step 1: Generate cover image via Google Imagen 4 ─────────────────────────

async function generateCoverImage(): Promise<Buffer> {
  log('IMAGE', 'Generating cover image via Google Imagen 4...');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: COVER_PROMPT }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
          personGeneration: 'allow_adult',
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Imagen 4 failed: ${res.status} ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
  };

  if (!data.predictions?.length) {
    throw new Error('No images returned from Imagen 4');
  }

  const imageBase64 = data.predictions[0].bytesBase64Encoded;
  const buffer = Buffer.from(imageBase64, 'base64');
  log('IMAGE', `Generated: ${(buffer.length / 1024).toFixed(0)} KB`);

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
  if (!jwt) throw new Error('No session token in verify response');
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
    throw new Error(`Firestore registration failed: ${JSON.stringify(createData[0].error)}`);
  }

  const result = createData[0]?.result?.data;
  log('REGISTER', `Firestore ID: ${result?.data?.id ?? 'unknown'}`);
  log('REGISTER', `Credits awarded: ${result?.mintCreditsAwarded ?? 0}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Orange Pills Universe + $OP Token Deployment');
  console.log('═'.repeat(60));
  console.log(`  Deployer: ${account.address}`);
  console.log(`  Chain:    Sepolia (${sepolia.id})`);
  console.log(`  Server:   ${SERVER_URL}\n`);

  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not set');
  if (!PINATA_JWT) throw new Error('PINATA_JWT not set');

  const imageBuffer = await generateCoverImage();
  const imageUrl = await pinToPinata(imageBuffer, `orange-pills-cover.jpg`);
  const deploy = await deployOnChain(imageUrl);

  try {
    await registerInFirestore(deploy, imageUrl);
  } catch (err: any) {
    log('REGISTER', `WARNING: Firestore registration failed: ${err.message}`);
    log('REGISTER', 'Universe is live on-chain but may not appear in the app until registered.');
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

  Launchpad: /tokens
  Universe:  /universe/${deploy.universeAddress}
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('Cause:', (err.cause as any)?.message);
  process.exit(1);
});
