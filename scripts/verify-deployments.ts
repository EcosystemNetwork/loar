/**
 * Non-destructive on-chain verification of all UniverseManager candidate addresses.
 *
 * For every address referenced in deployment manifests, addresses.ts, docs, or
 * scripts, we:
 *   - call eth_getCode (is there bytecode deployed?)
 *   - call owner() (is it initialized and controlled?)
 *   - call mintFee() (is it actually a UniverseManager?)
 *
 * Runs against both Sepolia (11155111) and Base Sepolia (84532) RPCs.
 *
 * Usage: pnpm tsx scripts/verify-deployments.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SEPOLIA_RPC =
  process.env.RPC_11155111 ?? process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const BASE_SEPOLIA_RPC =
  process.env.RPC_84532 ??
  process.env.RPC_URL_BASE_SEPOLIA ??
  'https://base-sepolia-rpc.publicnode.com';

const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC),
});

// Minimal ABI for probing UniverseManager contracts
const PROBE_ABI = [
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mintFee',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'universeCount',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

interface Candidate {
  source: string;
  address: Address;
  chain: 'sepolia' | 'base-sepolia';
}

const CANDIDATES: Candidate[] = [
  {
    source: 'docs/contracts.md:20',
    address: '0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce',
    chain: 'sepolia',
  },
  {
    source: 'deployments/sepolia.json',
    address: '0xB82dE188841a799e0dBB58D885D81BEE7A735f00',
    chain: 'sepolia',
  },
  {
    source: 'deployments/base-sepolia.json',
    address: '0x829666ADAc47D954297a9CD1232744E1669B9e83',
    chain: 'base-sepolia',
  },
  {
    source: 'packages/abis/src/addresses.ts',
    address: '0xE981454B4149BEA3a9018fa2ab77482F388ba01f',
    chain: 'base-sepolia',
  },
  {
    source: 'scripts/test-create-universe.ts:51',
    address: '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8',
    chain: 'base-sepolia',
  },
];

async function probe(
  client: PublicClient,
  address: Address
): Promise<{
  hasCode: boolean;
  codeSize: number;
  owner?: string;
  mintFee?: string;
  universeCount?: string;
  errors: string[];
}> {
  const errors: string[] = [];
  const code = await client.getBytecode({ address }).catch((e: any) => {
    errors.push(`getCode: ${e.shortMessage ?? e.message}`);
    return undefined;
  });
  const hasCode = !!code && code !== '0x';
  const codeSize = code ? (code.length - 2) / 2 : 0;

  if (!hasCode) return { hasCode: false, codeSize: 0, errors };

  let owner: string | undefined;
  let mintFee: string | undefined;
  let universeCount: string | undefined;

  try {
    owner = (await client.readContract({
      address,
      abi: PROBE_ABI,
      functionName: 'owner',
    })) as string;
  } catch (e: any) {
    errors.push(`owner: ${e.shortMessage ?? e.message?.slice(0, 80)}`);
  }

  try {
    mintFee = (
      (await client.readContract({ address, abi: PROBE_ABI, functionName: 'mintFee' })) as bigint
    ).toString();
  } catch (e: any) {
    errors.push(`mintFee: ${e.shortMessage ?? e.message?.slice(0, 80)}`);
  }

  try {
    universeCount = (
      (await client.readContract({
        address,
        abi: PROBE_ABI,
        functionName: 'universeCount',
      })) as bigint
    ).toString();
  } catch (e: any) {
    /* not every UM has this, ignore */
  }

  return { hasCode, codeSize, owner, mintFee, universeCount, errors };
}

async function main() {
  console.log(`\n${'='.repeat(75)}`);
  console.log(`  On-chain UniverseManager candidate verification`);
  console.log(`${'='.repeat(75)}`);
  console.log(`  Sepolia RPC      : ${SEPOLIA_RPC.slice(0, 60)}...`);
  console.log(`  Base Sepolia RPC : ${BASE_SEPOLIA_RPC.slice(0, 60)}...\n`);

  for (const c of CANDIDATES) {
    const client = c.chain === 'sepolia' ? sepoliaClient : baseSepoliaClient;
    console.log(`${'─'.repeat(75)}`);
    console.log(`  ${c.chain.toUpperCase().padEnd(13)} ${c.address}`);
    console.log(`  source: ${c.source}`);

    const r = await probe(client as any, c.address);
    if (!r.hasCode) {
      console.log(`    → NO CODE DEPLOYED (dead address)`);
    } else {
      console.log(`    → code size: ${r.codeSize} bytes`);
      if (r.owner) console.log(`    → owner(): ${r.owner}`);
      if (r.mintFee)
        console.log(`    → mintFee(): ${r.mintFee} wei (${Number(r.mintFee) / 1e18} ETH)`);
      if (r.universeCount) console.log(`    → universeCount(): ${r.universeCount}`);
      if (r.errors.length) console.log(`    → errors: ${r.errors.join('; ')}`);
      const isUM = !!r.owner && !!r.mintFee;
      console.log(
        `    → ${isUM ? 'LOOKS LIKE A UNIVERSE MANAGER' : 'DEPLOYED BUT NOT A UM (or non-standard)'}`
      );
    }
  }

  console.log(`\n${'='.repeat(75)}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
