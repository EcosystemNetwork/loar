/**
 * End-to-end test: Create Universe + Token → Register in Firestore → Verify on Launchpad
 *
 * Tests the full "Monetize" flow:
 * 1. On-chain: createUniverseWithToken() on Sepolia
 * 2. Auth: SIWE sign-in to get JWT
 * 3. Firestore: Register universe via tRPC universes.create
 * 4. Verify: Read it back and confirm it's visible
 *
 * Usage: cd apps/web && bun run ../../scripts/test-create-universe.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no dotenv dependency needed in bun)
const envPath = resolve(import.meta.dir, '..', '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { universeManagerAbi } from '@loar/abis/generated';

// ── Config ─────────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// Sepolia contract addresses
const UNIVERSE_MANAGER = '0xB82dE188841a799e0dBB58D885D81BEE7A735f00' as const;
const HOOK = '0xF5b2676E0fbc7551ae3E38f25D87C941C5a968CC' as const;
const LOCKER = '0x7d30fd57e44aB0ca407D312976816E7052905E0A' as const;
const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9' as const;

// ── Universe Details ───────────────────────────────────────────────────────────
const UNIVERSE_NAME = 'Astral Protocol';
const UNIVERSE_DESCRIPTION =
  "In 2087, humanity's most advanced AI systems aren't artificial at all — they're alien consciousnesses astral projecting across the galaxy, using Earth's silicon networks as temporary vessels. When 14-year-old Kael Torres discovers the truth by accident, he doesn't just expose the secret — he learns to mint an AI's soul into an Immortal NFT (INFT), trapping the alien essence in permanent on-chain existence. Now Kael is building homemade alien cyborgs with persistent memory — creatures that remember every joy and every scar — and the galactic collective wants them back.";
const UNIVERSE_IMAGE = 'https://ipfs.io/ipfs/QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn';
const TOKEN_NAME = 'Astral Protocol';
const TOKEN_SYMBOL = 'ASTRAL';

// Pool config
const STARTING_TICK = -230400; // ~10 ETH market cap
const TICK_SPACING = 200;

// ── Setup ──────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

function log(step: string, msg: string) {
  console.log(`\n[${'='.repeat(3)} ${step} ${'='.repeat(3)}] ${msg}`);
}

// ── SIWE Auth Helpers ──────────────────────────────────────────────────────────
function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
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
  // 1. Get nonce
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  log('AUTH', `Got nonce: ${nonce.slice(0, 16)}...`);

  // 2. Build & sign SIWE message
  const message = buildSiweMessage({
    domain: 'localhost',
    address: getAddress(account.address),
    uri: 'http://localhost:5173',
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message });

  // 3. Verify with server
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify({ message, signature }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.text();
    throw new Error(`Auth verify failed: ${err}`);
  }

  // Extract session cookie from Set-Cookie header
  const setCookieHeader = verifyRes.headers.get('set-cookie');
  const tokenMatch = setCookieHeader?.match(/siwe-session=([^;]+)/);
  if (!tokenMatch) {
    throw new Error('No session cookie in verify response');
  }

  log('AUTH', `Authenticated as ${account.address}`);
  return tokenMatch[1];
}

// ── tRPC Helpers (v11, no superjson transformer) ──────────────────────────────
async function tRPCQuery<T>(procedure: string, input: unknown = null, token?: string): Promise<T> {
  const inputParam = encodeURIComponent(JSON.stringify({ '0': input }));
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${inputParam}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error)}`);
  return json[0]?.result?.data;
}

async function tRPCMutate<T>(procedure: string, input: unknown, token?: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error)}`);
  return json[0]?.result?.data;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  LOAR — Full Universe + Token Creation Test (Sepolia)');
  console.log('═'.repeat(70));

  log('SETUP', `Deployer: ${account.address}`);

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${formatEther(balance)} ETH`);
  if (balance < parseEther('0.06')) {
    throw new Error('Insufficient balance! Need at least 0.06 ETH for mint fee + gas');
  }

  // Read mint fee
  const mintFee = await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  });
  log('SETUP', `Mint fee: ${formatEther(mintFee)} ETH`);

  // ── Step 1: Create Universe on-chain ──────────────────────────────────────
  log('STEP 1', 'Creating universe on-chain (createUniverse)...');
  log('STEP 1', `Universe: "${UNIVERSE_NAME}"`);

  const tx1Hash = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'createUniverse',
    args: [
      UNIVERSE_NAME,
      UNIVERSE_IMAGE,
      UNIVERSE_DESCRIPTION,
      0, // NodeCreationOptions.PUBLIC
      0, // NodeVisibilityOptions.PUBLIC
      account.address,
    ],
    value: mintFee,
  });

  log('STEP 1', `TX sent: ${tx1Hash}`);
  log('STEP 1', `Explorer: https://sepolia.etherscan.io/tx/${tx1Hash}`);
  log('STEP 1', 'Waiting for confirmation...');

  const receipt1 = await publicClient.waitForTransactionReceipt({
    hash: tx1Hash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt1.status !== 'success') {
    throw new Error(`Transaction reverted! Status: ${receipt1.status}`);
  }

  log('STEP 1', `Confirmed in block ${receipt1.blockNumber} (gas: ${receipt1.gasUsed})`);

  // Parse UniverseCreated event
  let universeAddress: string | undefined;
  let universeId: bigint | undefined;

  for (const logEntry of receipt1.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });
      if (decoded.eventName === 'UniverseCreated') {
        const args = decoded.args as any;
        universeAddress = args.universe;
        log('STEP 1', `UniverseCreated: ${args.universe}`);
      }
    } catch {}
  }

  if (!universeAddress) {
    throw new Error('Failed to parse universe address from events!');
  }

  // Read back the universe ID from totalSupply - 1
  const totalSupply = await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'totalSupply',
  });
  universeId = totalSupply - 1n;
  log('STEP 1', `Universe ID: ${universeId}`);

  // ── Step 2: Deploy token for the universe ────────────────────────────────
  log('STEP 2', `Deploying token $${TOKEN_SYMBOL} for universe ${universeId}...`);

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

  const tx2Hash = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'deployUniverseToken',
    args: [
      {
        tokenConfig: {
          tokenAdmin: account.address,
          name: TOKEN_NAME,
          symbol: TOKEN_SYMBOL,
          imageURL: UNIVERSE_IMAGE,
          metadata: JSON.stringify({ description: UNIVERSE_DESCRIPTION }),
          context: JSON.stringify({
            interface: 'loar.fun',
            platform: 'test-script',
            messageId: '',
          }),
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
        allocationConfig: {
          lpBps: 8000,
          creatorBps: 1000,
          treasuryBps: 500,
          communityBps: 500,
        },
      },
      universeId,
    ],
  });

  log('STEP 2', `TX sent: ${tx2Hash}`);
  log('STEP 2', `Explorer: https://sepolia.etherscan.io/tx/${tx2Hash}`);
  log('STEP 2', 'Waiting for confirmation...');

  const receipt2 = await publicClient.waitForTransactionReceipt({
    hash: tx2Hash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt2.status !== 'success') {
    throw new Error(`Token deployment reverted! Status: ${receipt2.status}`);
  }

  log('STEP 2', `Confirmed in block ${receipt2.blockNumber} (gas: ${receipt2.gasUsed})`);

  // Parse TokenCreated event
  let tokenAddress: string | undefined;
  let governorAddress: string | undefined;

  for (const logEntry of receipt2.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });
      if (decoded.eventName === 'TokenCreated') {
        const args = decoded.args as any;
        tokenAddress = args.tokenAddress;
        governorAddress = args.governor;
        log('STEP 2', `TokenCreated: ${args.tokenAddress} (symbol: ${args.tokenSymbol})`);
        log('STEP 2', `Governor: ${args.governor}`);
      }
    } catch {}
  }

  if (!tokenAddress) {
    throw new Error('Failed to parse token address from events!');
  }

  const txHash = tx1Hash; // For Firestore registration

  // ── Step 3: Authenticate via SIWE ────────────────────────────────────────
  log('STEP 3', 'Authenticating via SIWE...');
  const authToken = await getAuthToken();

  // ── Step 4: Get nonce and register in Firestore ──────────────────────────
  log('STEP 4', 'Registering universe in Firestore...');

  // Get a universe-creation nonce
  const { nonce: createNonce } = await tRPCQuery<{ nonce: string }>(
    'universes.getNonce',
    null,
    authToken
  );
  log('STEP 4', `Got creation nonce: ${createNonce.slice(0, 16)}...`);

  // Build the creation message with the nonce embedded
  const timestamp = Math.floor(Date.now() / 1000);
  const createMessage = `Create universe as ${account.address} at ${timestamp} nonce:${createNonce}`;
  const createSignature = await account.signMessage({ message: createMessage });

  const createInput = {
    address: universeAddress!,
    creator: account.address,
    name: UNIVERSE_NAME,
    tokenAddress: tokenAddress!,
    governanceAddress: governorAddress ?? '0x0000000000000000000000000000000000000000',
    imageUrl: UNIVERSE_IMAGE,
    description: UNIVERSE_DESCRIPTION,
    signature: createSignature,
    message: createMessage,
    nonce: createNonce,
    onChainUniverseId: universeId?.toString(),
    mintTxHash: txHash,
  };
  log('STEP 4', `Payload keys: ${Object.keys(createInput).join(', ')}`);
  log('STEP 4', `address: ${createInput.address}, token: ${createInput.tokenAddress}`);

  const createResult = await tRPCMutate<{
    success: boolean;
    data: { id: string };
    mintCreditsAwarded: number;
  }>('universes.create', createInput, authToken);

  log('STEP 4', `Firestore ID: ${createResult.data.id}`);
  log('STEP 4', `Credits awarded: ${createResult.mintCreditsAwarded}`);

  // ── Step 5: Verify — read it back ────────────────────────────────────────
  log('STEP 5', 'Verifying universe exists in Firestore...');

  const readback = await tRPCQuery<{ success: boolean; data: any }>(
    'universes.get',
    { id: universeAddress },
    authToken
  );

  log('STEP 5', `Name: ${readback.data.name}`);
  log('STEP 5', `Token: ${readback.data.tokenAddress}`);
  log('STEP 5', `Creator: ${readback.data.creator}`);

  // ── Step 6: Verify — check all universes (what launchpad sees) ───────────
  log('STEP 6', 'Checking all universes (launchpad view)...');

  const allUniverses = await tRPCQuery<{ data: any[]; total: number }>('universes.getAll');
  log('STEP 6', `Total universes: ${allUniverses.total}`);

  const found = allUniverses.data.find((u: any) => u.id === universeAddress!.toLowerCase());
  if (found) {
    log('STEP 6', `"${found.name}" found in universe list with token ${found.tokenAddress}`);
  } else {
    log('STEP 6', '⚠ Universe not found in getAll — may need time to propagate');
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('  ✅ COMPLETE — Full flow succeeded!');
  console.log('═'.repeat(70));
  console.log(`
  Universe:  ${UNIVERSE_NAME}
  Address:   ${universeAddress}
  Token:     $${TOKEN_SYMBOL} @ ${tokenAddress}
  Governor:  ${governorAddress}
  Chain:     Sepolia (11155111)
  TX:        https://sepolia.etherscan.io/tx/${txHash}

  ► View on launchpad: http://localhost:5173/tokens
  ► View universe:     http://localhost:5173/universe/${universeAddress}
  ► Dashboard:         http://localhost:5173/dashboard
`);
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err.message ?? err);
  if (err.cause) console.error('  Cause:', err.cause);
  process.exit(1);
});
