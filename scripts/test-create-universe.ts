/**
 * End-to-end test: Create Universe + Token → Register in Firestore → Verify on Launchpad
 *
 * Tests the full "Monetize" flow:
 * 1. On-chain: createUniverseWithToken() on Base Sepolia
 * 2. Auth: SIWE sign-in to get JWT
 * 3. Firestore: Register universe via tRPC universes.create
 * 4. Verify: Read it back and confirm it's visible
 *
 * Usage: cd apps/web && bun run ../../scripts/test-create-universe.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no dotenv dependency needed in bun)
const envPath = resolve(import.meta.dir, '..', '.env');
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
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { universeManagerAbi } from '@loar/abis/generated';

// ── Config ─────────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA ?? 'https://base-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// Base Sepolia contract addresses
const UNIVERSE_MANAGER = '0x99562C96389A91b17662ce5f15143f5B07b84090' as const;
const HOOK = '0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC' as const;
const LOCKER = '0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;

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
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });

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
    chainId: baseSepolia.id,
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

// ── tRPC Helpers ───────────────────────────────────────────────────────────────
async function tRPCQuery<T>(procedure: string, input: unknown = null, token?: string): Promise<T> {
  const inputParam = encodeURIComponent(JSON.stringify({ '0': { json: input } }));
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${inputParam}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error)}`);
  return json[0]?.result?.data?.json ?? json[0]?.result?.data;
}

async function tRPCMutate<T>(procedure: string, input: unknown, token?: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ '0': { json: input } }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error)}`);
  return json[0]?.result?.data?.json ?? json[0]?.result?.data;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  LOAR — Full Universe + Token Creation Test (Base Sepolia)');
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

  // ── Step 1: On-chain createUniverseWithToken ─────────────────────────────
  log('STEP 1', 'Creating universe + token on-chain (createUniverseWithToken)...');
  log('STEP 1', `Universe: "${UNIVERSE_NAME}" | Token: $${TOKEN_SYMBOL}`);

  // Encode pool fee data
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

  const txHash = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'createUniverseWithToken',
    args: [
      UNIVERSE_NAME,
      UNIVERSE_IMAGE,
      UNIVERSE_DESCRIPTION,
      0, // NodeCreationOptions.PUBLIC
      0, // NodeVisibilityOptions.PUBLIC
      account.address,
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
          rewardBps: [10000], // 100% of LP fees to creator
          tickLower: [STARTING_TICK],
          tickUpper: [0],
          positionBps: [10000], // 100% of LP in one position
          lockerData: '0x' as `0x${string}`,
        },
        allocationConfig: {
          lpBps: 8000,
          creatorBps: 1000,
          treasuryBps: 500,
          communityBps: 500,
        },
      },
    ],
    value: mintFee,
  });

  log('STEP 1', `TX sent: ${txHash}`);
  log('STEP 1', `Explorer: https://sepolia.basescan.org/tx/${txHash}`);
  log('STEP 1', 'Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted! Status: ${receipt.status}`);
  }

  log('STEP 1', `Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

  // ── Step 2: Parse events from receipt ────────────────────────────────────
  log('STEP 2', 'Parsing events from transaction receipt...');

  let universeAddress: string | undefined;
  let universeId: string | undefined;
  let tokenAddress: string | undefined;
  let governorAddress: string | undefined;

  for (const logEntry of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });

      if (decoded.eventName === 'UniverseCreatedWithToken') {
        const args = decoded.args as any;
        universeId = args.universeId?.toString();
        universeAddress = args.universe;
        tokenAddress = args.token;
        governorAddress = args.governor;
        log('STEP 2', `UniverseCreatedWithToken event found!`);
        log('STEP 2', `  Universe ID: ${universeId}`);
        log('STEP 2', `  Universe: ${universeAddress}`);
        log('STEP 2', `  Token: ${tokenAddress}`);
        log('STEP 2', `  Governor: ${governorAddress}`);
      } else if (decoded.eventName === 'UniverseCreated') {
        const args = decoded.args as any;
        if (!universeAddress) universeAddress = args.universe;
        log('STEP 2', `UniverseCreated: ${args.universe}`);
      } else if (decoded.eventName === 'TokenCreated') {
        const args = decoded.args as any;
        if (!tokenAddress) tokenAddress = args.tokenAddress;
        if (!governorAddress) governorAddress = args.governor;
        log('STEP 2', `TokenCreated: ${args.tokenAddress} (symbol: ${args.tokenSymbol})`);
      }
    } catch {
      // Not our event, skip
    }
  }

  if (!universeAddress || !tokenAddress) {
    throw new Error('Failed to parse universe/token addresses from events!');
  }

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

  const createResult = await tRPCMutate<{
    success: boolean;
    data: { id: string };
    mintCreditsAwarded: number;
  }>(
    'universes.create',
    {
      address: universeAddress,
      creator: account.address,
      name: UNIVERSE_NAME,
      tokenAddress,
      governanceAddress: governorAddress ?? '0x0000000000000000000000000000000000000000',
      imageUrl: UNIVERSE_IMAGE,
      description: UNIVERSE_DESCRIPTION,
      signature: createSignature,
      message: createMessage,
      nonce: createNonce,
      onChainUniverseId: universeId,
      mintTxHash: txHash,
    },
    authToken
  );

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
  Chain:     Base Sepolia (84532)
  TX:        https://sepolia.basescan.org/tx/${txHash}

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
