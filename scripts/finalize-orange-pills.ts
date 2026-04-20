/**
 * Finalize Orange Pills deploy:
 *   1. setHook(LoarHookStaticFee, true)     — owner-only, required by UniverseManager
 *   2. setLocker(LoarLpLockerMultiple, hook, true) — owner-only
 *   3. deployUniverseToken(config, id=2)    — issue $OP for the universe already minted
 *   4. Register universe in Firestore via SIWE + tRPC (best-effort)
 *
 * Usage: pnpm tsx scripts/finalize-orange-pills.ts
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

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

const deployment = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'deployments/sepolia.json'), 'utf-8')
);
const UNIVERSE_MANAGER = getAddress(deployment.contracts.UniverseManager) as `0x${string}`;
const HOOK = getAddress(deployment.contracts.LoarHookStaticFee) as `0x${string}`;
const LOCKER = getAddress(deployment.contracts.LoarLpLockerMultiple) as `0x${string}`;
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' as const; // UniverseManager.weth()

// From earlier run
const UNIVERSE_NAME = 'Orange Pills';
const TOKEN_SYMBOL = 'OP';
const UNIVERSE_DESCRIPTION =
  'In a world numbed by algorithmic consensus and synthetic certainty, a quiet movement begins to spread through the back rooms of failing cities. They call themselves the Citrine — the Orange Pilled — and they worship nothing but verifiable truth. Their sacraments are open-source code. Their scripture is any claim that can be independently proven. Their heresy is belief without evidence. When a disgraced tech journalist named Mara Vance stumbles into a Citrine vigil while chasing a story about missing cryptographers, she finds a congregation whose founder has been dead for two years and still somehow signs off every new doctrine — from a wallet no one can crack. What begins as investigative contempt warps into something worse: faith. Orange Pills is a prestige drama about what happens when a new religion refuses to lie, and about the enemies that kind of honesty inevitably makes — corporations, nation-states, and the quieter, older faiths that never survived contact with a world that can finally audit them.';
const IMAGE_URL =
  'https://gateway.pinata.cloud/ipfs/QmPaPizRQoKaZxhKmHN8M8CZRgyu8AfV9c1FZqD8S4zeBb';
const UNIVERSE_ID = 2n;
const UNIVERSE_ADDRESS = getAddress('0x6c3ae0Be32a7200f73bA59F1FE95eD9e06D15abE');
const STARTING_TICK = -230400;
const TICK_SPACING = 200;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

async function whitelistHookAndLocker() {
  const hookEnabled = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'enabledHooks',
    args: [HOOK],
  })) as boolean;

  if (hookEnabled) {
    log('ADMIN', `Hook ${HOOK} already enabled`);
  } else {
    log('ADMIN', `Enabling hook ${HOOK}...`);
    const h = await walletClient.writeContract({
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'setHook',
      args: [HOOK, true],
    });
    const r = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
    if (r.status !== 'success') throw new Error('setHook reverted');
    log('ADMIN', `Hook enabled: ${h}`);
  }

  const lockerEnabled = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'enabledLockers',
    args: [LOCKER, HOOK],
  })) as boolean;

  if (lockerEnabled) {
    log('ADMIN', `Locker ${LOCKER} for hook ${HOOK} already enabled`);
  } else {
    log('ADMIN', `Enabling locker ${LOCKER} for hook ${HOOK}...`);
    const h = await walletClient.writeContract({
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'setLocker',
      args: [LOCKER, HOOK, true],
    });
    const r = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
    if (r.status !== 'success') throw new Error('setLocker reverted');
    log('ADMIN', `Locker enabled: ${h}`);
  }
}

interface TokenResult {
  txHash: `0x${string}`;
  tokenAddress: string;
  governorAddress: string;
}

async function deployToken(): Promise<TokenResult> {
  const balance = await publicClient.getBalance({ address: account.address });
  log('TOKEN', `Balance: ${formatEther(balance)} ETH`);

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
      imageURL: IMAGE_URL,
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

  log('TOKEN', `Simulating deployUniverseToken(id=${UNIVERSE_ID})...`);
  await publicClient.simulateContract({
    account,
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'deployUniverseToken',
    args: [deploymentConfig, UNIVERSE_ID],
  });
  log('TOKEN', 'Simulation passed — sending tx...');

  const txHash = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'deployUniverseToken',
    args: [deploymentConfig, UNIVERSE_ID],
  });
  log('TOKEN', `TX: ${txHash}`);
  log('TOKEN', `Explorer: https://sepolia.etherscan.io/tx/${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error(`deployUniverseToken reverted`);
  log('TOKEN', `Confirmed in block ${receipt.blockNumber} (gas ${receipt.gasUsed})`);

  let tokenAddress: string | undefined;
  let governorAddress: string | undefined;

  for (const logEntry of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });
      if (decoded.eventName === 'TokenCreated') {
        tokenAddress = (decoded.args as any).tokenAddress;
        governorAddress = (decoded.args as any).governor;
        log('TOKEN', `TokenCreated: ${tokenAddress} ($${TOKEN_SYMBOL})`);
        log('TOKEN', `Governor: ${governorAddress}`);
      }
    } catch {}
  }

  if (!tokenAddress || !governorAddress) {
    throw new Error('TokenCreated event not found in receipt');
  }
  return { txHash, tokenAddress, governorAddress };
}

function buildSiweMessage(p: { address: string; nonce: string; chainId: number }): string {
  const domain = new URL(SERVER_URL).hostname;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    p.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${SERVER_URL}`,
    `Version: 1`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function registerInFirestore(token: TokenResult) {
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
  const jwt = setCookie.match(/siwe-session=([^;]+)/)?.[1];
  if (!jwt) throw new Error('No session token in verify response');
  log('REGISTER', `Authenticated as ${account.address}`);

  const createNonceRes = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const createNonce = ((await createNonceRes.json()) as any[])[0]?.result?.data?.nonce;
  if (!createNonce) throw new Error('Failed to get creation nonce');

  const createMsg = `Register universe ${UNIVERSE_ADDRESS} created by ${account.address} with nonce ${createNonce} at ${Date.now()}`;
  const createSig = await account.signMessage({ message: createMsg });

  log('REGISTER', 'Registering universe in Firestore...');
  const createRes = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      '0': {
        address: UNIVERSE_ADDRESS,
        creator: account.address,
        name: UNIVERSE_NAME,
        tokenAddress: token.tokenAddress,
        governanceAddress: token.governorAddress,
        imageUrl: IMAGE_URL,
        description: UNIVERSE_DESCRIPTION,
        onChainUniverseId: UNIVERSE_ID.toString(),
        mintTxHash: token.txHash,
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

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Orange Pills Finalize (hook/locker + $OP + register)');
  console.log('═'.repeat(60));
  console.log(`  Deployer: ${account.address}`);
  console.log(`  Universe: ${UNIVERSE_ADDRESS} (ID ${UNIVERSE_ID})\n`);

  await whitelistHookAndLocker();
  const token = await deployToken();

  try {
    await registerInFirestore(token);
  } catch (err: any) {
    log('REGISTER', `WARNING: Firestore registration failed: ${err.message}`);
    log('REGISTER', 'Universe + token are live on-chain; app registration can be done later.');
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  COMPLETE');
  console.log('═'.repeat(60));
  console.log(`
  Universe : ${UNIVERSE_NAME}
  Address  : ${UNIVERSE_ADDRESS}
  Token    : $${TOKEN_SYMBOL} @ ${token.tokenAddress}
  Governor : ${token.governorAddress}
  Image    : ${IMAGE_URL}
  TX       : https://sepolia.etherscan.io/tx/${token.txHash}
`);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message ?? e);
  if (e.cause) console.error('Cause:', (e.cause as any)?.message);
  process.exit(1);
});
