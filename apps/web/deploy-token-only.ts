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
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { universeManagerAbi } from '@loar/abis/generated';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});

const UNIVERSE_MANAGER = '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8' as const;
const HOOK = '0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC' as const;
const LOCKER = '0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;
const IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmW8JFQu9hfoDDSQ8xSn4pMLKUF5ffogvaUYA7L67uyL2p';
const UNIVERSE_ID = 0n; // The universe we just created

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

async function main() {
  console.log('Deploying token for universe #0 (Astral Protocol)...');

  const txHash = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'deployUniverseToken',
    args: [
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
      UNIVERSE_ID,
    ],
  });

  console.log('TX sent:', txHash);
  console.log('Explorer: https://sepolia.basescan.org/tx/' + txHash);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt.status !== 'success') {
    console.error('TX REVERTED');
    process.exit(1);
  }

  let tokenAddress = '',
    governorAddress = '';
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'TokenCreated') {
        const args = decoded.args as any;
        tokenAddress = args.tokenAddress;
        governorAddress = args.governor;
      }
      console.log('Event:', decoded.eventName);
    } catch {}
  }

  console.log('\n✅ Token deployed!');
  console.log(`Token: ${tokenAddress}`);
  console.log(`Governor: ${governorAddress}`);

  // Now register in Firestore
  console.log('\nRegistering in Firestore...');

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

  const { nonce: createNonce } =
    (
      (await (
        await fetch(
          `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        )
      ).json()) as any[]
    )[0]?.result?.data ?? {};
  const ts = Math.floor(Date.now() / 1000);
  const createMsg = `Create universe as ${account.address} at ${ts} nonce:${createNonce}`;
  const createSig = await account.signMessage({ message: createMsg });

  const createRes = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      '0': {
        address: '0xe198b0D4E8d367977054b0825fF07187fE686df9',
        creator: account.address,
        name: 'Astral Protocol',
        tokenAddress: tokenAddress || '0x0000000000000000000000000000000000000000',
        governanceAddress: governorAddress || '0x0000000000000000000000000000000000000000',
        imageUrl: IMAGE,
        description:
          "In 2087, alien consciousnesses use Earth's silicon networks as vessels. Teenager Kael Torres discovers the truth and learns to mint AI souls into Immortal NFTs.",
        signature: createSig,
        message: createMsg,
        nonce: createNonce,
        onChainUniverseId: '0',
        mintTxHash: txHash,
      },
    }),
  });
  const createJson = (await createRes.json()) as any[];
  if (createJson[0]?.error) {
    console.error('Registration failed:', createJson[0].error.message);
  } else {
    console.log('Registered! ID:', createJson[0]?.result?.data?.data?.id);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  ASTRAL PROTOCOL — FULLY DEPLOYED');
  console.log('═'.repeat(60));
  console.log(`  Universe:  0xe198b0D4E8d367977054b0825fF07187fE686df9`);
  console.log(`  Token:     $ASTRAL @ ${tokenAddress}`);
  console.log(`  Governor:  ${governorAddress}`);
  console.log(`  Image:     ${IMAGE}`);
  console.log(`  Chain:     Base Sepolia (84532)`);
  console.log('═'.repeat(60));
}
main().catch((e) => {
  console.error('FATAL:', e.shortMessage || e.message?.slice(0, 500));
  process.exit(1);
});
