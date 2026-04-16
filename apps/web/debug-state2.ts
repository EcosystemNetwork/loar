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

import { createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});
const UNIVERSE_MANAGER = '0x99562C96389A91b17662ce5f15143f5B07b84090' as const;

const rawAbi = parseAbi([
  'function latestId() view returns (uint256)',
  'function deprecated() view returns (bool)',
  'function weth() view returns (address)',
  'function tokenDeployer() view returns (address)',
  'function identityNft() view returns (address)',
  'function totalLpSeedsHeld() view returns (uint256)',
]);

async function main() {
  for (const fn of [
    'latestId',
    'deprecated',
    'weth',
    'tokenDeployer',
    'identityNft',
    'totalLpSeedsHeld',
  ] as const) {
    try {
      const result = await publicClient.readContract({
        address: UNIVERSE_MANAGER,
        abi: rawAbi,
        functionName: fn,
      });
      console.log(`${fn}: ${result}`);
    } catch (e: any) {
      console.log(`${fn}: ERROR - ${e.message?.slice(0, 100)}`);
    }
  }

  // Check bytecode
  const code = await publicClient.getCode({ address: UNIVERSE_MANAGER });
  console.log(`Bytecode length: ${code?.length ?? 0}`);
}
main();
