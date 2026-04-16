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

const UNIVERSE_MANAGER = '0x99562C96389A91b17662ce5f15143f5B07b84090';
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

async function main() {
  // Check universe count
  const count = await publicClient.readContract({
    address: UNIVERSE_MANAGER as any,
    abi: universeManagerAbi,
    functionName: 'universeCount',
  });
  console.log('Total universes:', count.toString());

  // Check last few universes
  for (let i = Number(count) - 1; i >= Math.max(0, Number(count) - 3); i--) {
    try {
      const data = await publicClient.readContract({
        address: UNIVERSE_MANAGER as any,
        abi: universeManagerAbi,
        functionName: 'getUniverseData',
        args: [BigInt(i)],
      });
      console.log(`Universe #${i}:`, data);
    } catch (e: any) {
      console.log(`Universe #${i}: error - ${e.message?.slice(0, 100)}`);
    }
  }
}
main().catch((e) => console.error(e.message));
