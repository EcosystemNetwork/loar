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

import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { universeManagerAbi } from '@loar/abis/generated';

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});
const UNIVERSE_MANAGER = '0x99562C96389A91b17662ce5f15143f5B07b84090';

async function main() {
  const latestId = await publicClient.readContract({
    address: UNIVERSE_MANAGER as any,
    abi: universeManagerAbi,
    functionName: 'latestId',
  });
  console.log('latestId:', latestId?.toString());

  const deprecated = await publicClient.readContract({
    address: UNIVERSE_MANAGER as any,
    abi: universeManagerAbi,
    functionName: 'deprecated',
  });
  console.log('deprecated:', deprecated);

  const weth = await publicClient.readContract({
    address: UNIVERSE_MANAGER as any,
    abi: universeManagerAbi,
    functionName: 'weth',
  });
  console.log('weth:', weth);

  const tokenDeployer = await publicClient.readContract({
    address: UNIVERSE_MANAGER as any,
    abi: universeManagerAbi,
    functionName: 'tokenDeployer',
  });
  console.log('tokenDeployer:', tokenDeployer);

  const identityNft = await publicClient.readContract({
    address: UNIVERSE_MANAGER as any,
    abi: universeManagerAbi,
    functionName: 'identityNft',
  });
  console.log('identityNft:', identityNft);

  // Check bytecode size at the contract address to make sure it's deployed
  const code = await publicClient.getCode({ address: UNIVERSE_MANAGER as any });
  console.log('UniverseManager bytecode length:', code?.length);
}
main().catch((e) => console.error(e.message));
