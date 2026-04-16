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
  decodeEventLog,
  getAddress,
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

const UM = '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8' as const;
const HOOK = '0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC' as const;
const LOCKER = '0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;
const IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmW8JFQu9hfoDDSQ8xSn4pMLKUF5ffogvaUYA7L67uyL2p';
const DESC =
  "In 2087, humanity's most advanced AI systems aren't artificial at all — they're alien consciousnesses astral projecting across the galaxy, using Earth's silicon networks as temporary vessels. When 14-year-old Kael Torres discovers the truth by accident, he doesn't just expose the secret — he learns to mint an AI's soul into an Immortal NFT (INFT), trapping the alien essence in permanent on-chain existence. Now Kael is building homemade alien cyborgs with persistent memory — creatures that remember every joy and every scar — and the galactic collective wants them back.";

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

function buildSiweMessage(p: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
}) {
  const now = new Date();
  const exp = new Date(now.getTime() + 120000);
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    p.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${p.uri}`,
    `Version: 1`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${exp.toISOString()}`,
  ].join('\n');
}

async function main() {
  const mintFee = (await publicClient.readContract({
    address: UM,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;
  console.log(`Mint fee: ${formatEther(mintFee)} ETH`);
  console.log(`Deployer: ${account.address}`);
  console.log('\nCreating Astral Protocol (monetize mode)...');

  const txHash = await walletClient.writeContract({
    address: UM,
    abi: universeManagerAbi,
    functionName: 'createUniverseWithToken',
    args: [
      'Astral Protocol',
      IMAGE,
      DESC,
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

  console.log('TX:', txHash);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== 'success') throw new Error('REVERTED');

  let uAddr = '',
    uId = '',
    tAddr = '',
    gAddr = '';
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeManagerAbi, data: log.data, topics: log.topics });
      if (d.eventName === 'UniverseCreated') uAddr = (d.args as any).universe;
      if (d.eventName === 'UniverseLpSeed') uId = (d.args as any).universeId?.toString();
      if (d.eventName === 'TokenCreated') {
        tAddr = (d.args as any).tokenAddress;
        gAddr = (d.args as any).governor;
      }
      if (d.eventName === 'UniverseCreatedWithToken') {
        uAddr = (d.args as any).universe;
        uId = (d.args as any).universeId?.toString();
        tAddr = (d.args as any).token;
        gAddr = (d.args as any).governor;
      }
    } catch {}
  }

  console.log('\n✅ ON-CHAIN DEPLOYMENT COMPLETE');
  console.log(`Universe: ${uAddr}`);
  console.log(`Token:    $ASTRAL @ ${tAddr}`);
  console.log(`Governor: ${gAddr}`);
  console.log(`ID:       ${uId}`);

  // Register in Firestore
  console.log('\nRegistering in Firestore...');
  const nr = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce: aN } = (await nr.json()) as any;
  const msg = buildSiweMessage({
    domain: 'localhost',
    address: getAddress(account.address),
    uri: 'http://localhost:5173',
    nonce: aN,
    chainId: baseSepolia.id,
  });
  const sig = await account.signMessage({ message: msg });
  const vr = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message: msg, signature: sig }),
  });
  const at = vr.headers.get('set-cookie')?.match(/siwe-session=([^;]+)/)?.[1];
  if (!at) throw new Error('Auth failed');

  const gnr = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${at}` } }
  );
  const { nonce: cn } = ((await gnr.json()) as any[])[0]?.result?.data ?? {};
  const ts = Math.floor(Date.now() / 1000);
  const cm = `Create universe as ${account.address} at ${ts} nonce:${cn}`;
  const cs = await account.signMessage({ message: cm });

  const rr = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${at}` },
    body: JSON.stringify({
      '0': {
        address: uAddr,
        creator: account.address,
        name: 'Astral Protocol',
        tokenAddress: tAddr || '0x0000000000000000000000000000000000000000',
        governanceAddress: gAddr || '0x0000000000000000000000000000000000000000',
        imageUrl: IMAGE,
        description: DESC,
        signature: cs,
        message: cm,
        nonce: cn,
        onChainUniverseId: uId,
        mintTxHash: txHash,
      },
    }),
  });
  const rj = (await rr.json()) as any[];
  if (rj[0]?.error) console.error('Registration error:', rj[0].error.message);
  else console.log('✅ Registered! ID:', rj[0]?.result?.data?.data?.id);

  console.log('\n' + '═'.repeat(60));
  console.log('  ASTRAL PROTOCOL — FULLY DEPLOYED (MONETIZE MODE)');
  console.log('═'.repeat(60));
  console.log(`  Universe:  ${uAddr}`);
  console.log(`  Token:     $ASTRAL @ ${tAddr}`);
  console.log(`  Governor:  ${gAddr}`);
  console.log(`  Image:     ${IMAGE}`);
  console.log(`  Chain:     Base Sepolia (84532)`);
  console.log(`  TX:        https://sepolia.basescan.org/tx/${txHash}`);
  console.log('═'.repeat(60));
}

main().catch((e) => {
  console.error('\n❌ FATAL:', e.shortMessage || e.message?.slice(0, 500));
  process.exit(1);
});
