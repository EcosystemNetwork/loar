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

import { createPublicClient, http, encodeAbiParameters, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { universeManagerAbi } from '@loar/abis/generated';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});

const UNIVERSE_MANAGER = '0x99562C96389A91b17662ce5f15143f5B07b84090';
const HOOK = '0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC';
const LOCKER = '0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6';
const WETH = '0x4200000000000000000000000000000000000006';
const IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmW8JFQu9hfoDDSQ8xSn4pMLKUF5ffogvaUYA7L67uyL2p';

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
  // Try simulate
  try {
    const result = await publicClient.simulateContract({
      account: account,
      address: UNIVERSE_MANAGER as any,
      abi: universeManagerAbi,
      functionName: 'createUniverseWithToken',
      args: [
        'Astral Protocol',
        IMAGE,
        'A sci-fi universe about alien consciousnesses.',
        0,
        0,
        account.address,
        {
          tokenConfig: {
            tokenAdmin: account.address,
            name: 'Astral Protocol',
            symbol: 'ASTRAL',
            imageURL: IMAGE,
            metadata: 'test',
            context: 'test',
          },
          poolConfig: {
            hook: HOOK as any,
            pairedToken: WETH as any,
            tickIfToken0IsLoar: -230400,
            tickSpacing: 200,
            poolData: poolData as any,
          },
          lockerConfig: {
            locker: LOCKER as any,
            rewardAdmins: [account.address],
            rewardRecipients: [account.address],
            rewardBps: [10000],
            tickLower: [-230400],
            tickUpper: [0],
            positionBps: [10000],
            lockerData: '0x' as any,
          },
          allocationConfig: { lpBps: 8000, creatorBps: 1000, treasuryBps: 500, communityBps: 500 },
        },
      ],
      value: parseEther('0.05'),
    });
    console.log('Simulation succeeded:', result);
  } catch (e: any) {
    console.error('Simulation FAILED:', e.message?.slice(0, 500));
    if (e.cause) console.error('Cause:', e.cause?.message?.slice(0, 500));
  }
}
main();
