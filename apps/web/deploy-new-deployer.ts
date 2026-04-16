import { readFileSync } from 'fs';
import { resolve } from 'path';
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
  encodeAbiParameters,
  encodeDeployData,
  getAddress,
  parseAbi,
  decodeEventLog,
  formatEther,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { universeManagerAbi } from '@loar/abis/generated';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);
const rpc = 'https://base-sepolia-rpc.publicnode.com';
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

const UNIVERSE_MANAGER = '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8' as const;
const HOOK = '0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC' as const;
const LOCKER = '0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;
const IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmW8JFQu9hfoDDSQ8xSn4pMLKUF5ffogvaUYA7L67uyL2p';

// Load compiled TokenDeployerV2 bytecode
const artifact = JSON.parse(
  readFileSync(
    '/home/god/Desktop/LOAR/loar/apps/contracts/out/UniverseTokenDeployerV2.sol/UniverseTokenDeployerV2.0.8.28.json',
    'utf-8'
  )
);
const deployerBytecode = artifact.bytecode.object as `0x${string}`;
const deployerAbi = artifact.abi;

// Also need to check the old deployer for its sub-contract addresses
const oldTokenDeployer = '0xDD4a87EfF3a45A718a4F3471C28De364e0F43E30' as const;

const checkAbi = parseAbi([
  'function loarDeployer() view returns (address)',
  'function governorFactory() view returns (address)',
  'function treasury() view returns (address)',
  'function vestingContract() view returns (address)',
  'function vestingCliff() view returns (uint64)',
  'function vestingDuration() view returns (uint64)',
]);

async function main() {
  console.log('═'.repeat(60));
  console.log('  STEP 1: Deploy new UniverseTokenDeployerV2');
  console.log('═'.repeat(60));

  // Read sub-addresses from old deployer — we'll need to set them on the new one
  // (V2 may not have setters for loarDeployer/governorFactory, but check)
  let loarDeployer = '',
    governorFactory = '',
    treasury = '';
  for (const fn of ['loarDeployer', 'governorFactory', 'treasury'] as const) {
    try {
      const val = await publicClient.readContract({
        address: oldTokenDeployer,
        abi: checkAbi,
        functionName: fn,
      });
      console.log(`Old deployer ${fn}: ${val}`);
      if (fn === 'loarDeployer') loarDeployer = val as string;
      if (fn === 'governorFactory') governorFactory = val as string;
      if (fn === 'treasury') treasury = val as string;
    } catch {
      console.log(`Old deployer ${fn}: not found`);
    }
  }

  // Constructor: (address _universeManager, address _vestingContract)
  // Vesting contract = address(0) to disable vesting (V1 behavior)
  console.log(`\nDeploying TokenDeployerV2 with universeManager=${UNIVERSE_MANAGER}...`);

  // Encode constructor args and append to bytecode manually
  const constructorArgs = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [UNIVERSE_MANAGER, '0x0000000000000000000000000000000000000000']
  );
  const fullBytecode = (deployerBytecode + constructorArgs.slice(2)) as `0x${string}`;

  const deployHash = await walletClient.sendTransaction({
    data: fullBytecode,
  });
  console.log('Deploy TX:', deployHash);

  const deployReceipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (deployReceipt.status !== 'success') throw new Error('TokenDeployer deployment reverted!');

  const newTokenDeployer = deployReceipt.contractAddress!;
  console.log('✅ New TokenDeployerV2:', newTokenDeployer);

  // Set sub-contracts on new deployer if needed
  const setAbi = parseAbi([
    'function setLoarDeployer(address) external',
    'function setGovernorFactory(address) external',
    'function setTreasury(address) external',
  ]);

  if (loarDeployer) {
    console.log('Setting loarDeployer...');
    const tx = await walletClient.writeContract({
      address: newTokenDeployer as `0x${string}`,
      abi: setAbi,
      functionName: 'setLoarDeployer',
      args: [loarDeployer as `0x${string}`],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log('✅ loarDeployer set');
  }
  if (governorFactory) {
    console.log('Setting governorFactory...');
    const tx = await walletClient.writeContract({
      address: newTokenDeployer as `0x${string}`,
      abi: setAbi,
      functionName: 'setGovernorFactory',
      args: [governorFactory as `0x${string}`],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log('✅ governorFactory set');
  }
  if (treasury) {
    console.log('Setting treasury...');
    const tx = await walletClient.writeContract({
      address: newTokenDeployer as `0x${string}`,
      abi: setAbi,
      functionName: 'setTreasury',
      args: [treasury as `0x${string}`],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log('✅ treasury set');
  }

  // STEP 2: Update UniverseManager to use new TokenDeployer
  console.log('\n' + '═'.repeat(60));
  console.log('  STEP 2: Update UniverseManager.tokenDeployer');
  console.log('═'.repeat(60));

  const setDeployerTx = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'setTokenDeployer',
    args: [newTokenDeployer as `0x${string}`],
  });
  await publicClient.waitForTransactionReceipt({ hash: setDeployerTx });
  console.log('✅ UniverseManager.tokenDeployer updated to', newTokenDeployer);

  // STEP 3: Deploy Astral Protocol with createUniverseWithToken
  console.log('\n' + '═'.repeat(60));
  console.log('  STEP 3: Deploy Astral Protocol (monetize mode)');
  console.log('═'.repeat(60));

  const mintFee = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;
  console.log('Mint fee:', formatEther(mintFee));

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

  const createTx = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'createUniverseWithToken',
    args: [
      'Astral Protocol',
      IMAGE,
      "In 2087, humanity's most advanced AI systems aren't artificial at all — they're alien consciousnesses astral projecting across the galaxy, using Earth's silicon networks as temporary vessels. When 14-year-old Kael Torres discovers the truth by accident, he doesn't just expose the secret — he learns to mint an AI's soul into an Immortal NFT (INFT), trapping the alien essence in permanent on-chain existence. Now Kael is building homemade alien cyborgs with persistent memory — creatures that remember every joy and every scar — and the galactic collective wants them back.",
      0,
      0,
      account.address,
      {
        tokenConfig: {
          tokenAdmin: account.address,
          name: 'Astral Protocol',
          symbol: 'ASTRAL',
          imageURL: IMAGE,
          metadata: 'Astral Protocol governance token',
          context: 'loar.fun',
        },
        poolConfig: {
          hook: HOOK,
          pairedToken: WETH,
          tickIfToken0IsLoar: -230400,
          tickSpacing: 200,
          poolData: poolData as `0x${string}`,
        },
        lockerConfig: {
          locker: LOCKER,
          rewardAdmins: [account.address],
          rewardRecipients: [account.address],
          rewardBps: [10000],
          tickLower: [-230400],
          tickUpper: [0],
          positionBps: [10000],
          lockerData: '0x' as `0x${string}`,
        },
        allocationConfig: { lpBps: 8000, creatorBps: 1000, treasuryBps: 500, communityBps: 500 },
      },
    ],
    value: mintFee,
  });

  console.log('Create TX:', createTx);
  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createTx,
    confirmations: 1,
    timeout: 120_000,
  });

  if (createReceipt.status !== 'success') throw new Error('createUniverseWithToken reverted!');

  let universeAddress = '',
    universeId = '',
    tokenAddress = '',
    governorAddress = '';
  for (const log of createReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'UniverseCreated') {
        universeAddress = (decoded.args as any).universe;
      }
      if (decoded.eventName === 'UniverseLpSeed') {
        universeId = (decoded.args as any).universeId?.toString();
      }
      if (decoded.eventName === 'TokenCreated') {
        tokenAddress = (decoded.args as any).tokenAddress;
        governorAddress = (decoded.args as any).governor;
      }
      if (decoded.eventName === 'UniverseCreatedWithToken') {
        const args = decoded.args as any;
        universeAddress = args.universe;
        universeId = args.universeId?.toString();
        tokenAddress = args.token;
        governorAddress = args.governor;
      }
    } catch {}
  }

  console.log('\n✅ ASTRAL PROTOCOL DEPLOYED!');
  console.log(`Universe:  ${universeAddress}`);
  console.log(`Token:     $ASTRAL @ ${tokenAddress}`);
  console.log(`Governor:  ${governorAddress}`);
  console.log(`ID:        ${universeId}`);

  // STEP 4: Register in Firestore
  console.log('\n' + '═'.repeat(60));
  console.log('  STEP 4: Register in Firestore');
  console.log('═'.repeat(60));

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

  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce: authNonce } = (await nonceRes.json()) as { nonce: string };
  const siweMsg = buildSiweMessage({
    domain: 'localhost',
    address: getAddress(account.address),
    uri: 'http://localhost:5173',
    nonce: authNonce,
    chainId: baseSepolia.id,
  });
  const siweSig = await account.signMessage({ message: siweMsg });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message: siweMsg, signature: siweSig }),
  });
  const authToken = verifyRes.headers.get('set-cookie')?.match(/siwe-session=([^;]+)/)?.[1];
  if (!authToken) throw new Error('Auth failed');

  const getNonceRes = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  const { nonce: createNonce } = ((await getNonceRes.json()) as any[])[0]?.result?.data ?? {};
  const ts = Math.floor(Date.now() / 1000);
  const createMsg = `Create universe as ${account.address} at ${ts} nonce:${createNonce}`;
  const createSig = await account.signMessage({ message: createMsg });

  const registerRes = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      '0': {
        address: universeAddress,
        creator: account.address,
        name: 'Astral Protocol',
        tokenAddress: tokenAddress || '0x0000000000000000000000000000000000000000',
        governanceAddress: governorAddress || '0x0000000000000000000000000000000000000000',
        imageUrl: IMAGE,
        description:
          "In 2087, humanity's most advanced AI systems aren't artificial at all — they're alien consciousnesses astral projecting across the galaxy, using Earth's silicon networks as temporary vessels.",
        signature: createSig,
        message: createMsg,
        nonce: createNonce,
        onChainUniverseId: universeId,
        mintTxHash: createTx,
      },
    }),
  });
  const regJson = (await registerRes.json()) as any[];
  if (regJson[0]?.error) {
    console.error('Registration failed:', regJson[0].error.message);
  } else {
    console.log('✅ Registered in Firestore! ID:', regJson[0]?.result?.data?.data?.id);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  ASTRAL PROTOCOL — FULLY DEPLOYED (MONETIZE MODE)');
  console.log('═'.repeat(60));
  console.log(`  Universe:     ${universeAddress}`);
  console.log(`  Token:        $ASTRAL @ ${tokenAddress}`);
  console.log(`  Governor:     ${governorAddress}`);
  console.log(`  Image:        ${IMAGE}`);
  console.log(`  New Deployer: ${newTokenDeployer}`);
  console.log(`  Chain:        Base Sepolia (84532)`);
  console.log(`  Explorer:     https://sepolia.basescan.org/tx/${createTx}`);
  console.log('═'.repeat(60));
}

main().catch((e) => {
  console.error('\n❌ FATAL:', e.shortMessage || e.message?.slice(0, 500));
  process.exit(1);
});
