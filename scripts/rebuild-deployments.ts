/**
 * rebuild-deployments.ts
 *
 * Walks every Foundry broadcast file in apps/contracts/broadcast/ for a given
 * chain, picks the most recent successful CREATE per contract name (handles
 * redeploys), verifies each address has live bytecode on-chain, and regenerates:
 *
 *   - deployments/{chain}.json — canonical manifest with all deployed contracts
 *   - packages/abis/src/addresses.ts — merged TS exports for both chains
 *
 * Usage:
 *   pnpm tsx scripts/rebuild-deployments.ts                 # dry run, no writes
 *   pnpm tsx scripts/rebuild-deployments.ts --apply         # actually rewrite
 *   pnpm tsx scripts/rebuild-deployments.ts --chain=sepolia --apply
 *
 * Safe by default: writes nothing unless --apply is passed.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createPublicClient, http, getAddress, type Address } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface ChainCfg {
  chainId: number;
  environment: string;
  manifestFile: string;
  rpc: string;
  chain: typeof sepolia | typeof baseSepolia;
}

const CHAINS: Record<string, ChainCfg> = {
  sepolia: {
    chainId: 11155111,
    environment: 'sepolia',
    manifestFile: 'deployments/sepolia.json',
    rpc:
      process.env.RPC_11155111 ??
      process.env.RPC_URL ??
      'https://ethereum-sepolia-rpc.publicnode.com',
    chain: sepolia,
  },
  'base-sepolia': {
    chainId: 84532,
    environment: 'base-sepolia',
    manifestFile: 'deployments/base-sepolia.json',
    rpc:
      process.env.RPC_84532 ??
      process.env.RPC_URL_BASE_SEPOLIA ??
      'https://base-sepolia-rpc.publicnode.com',
    chain: baseSepolia,
  },
};

const APPLY = process.argv.includes('--apply');
const chainArg = process.argv.find((a) => a.startsWith('--chain='))?.split('=')[1];
const CHAINS_TO_RUN = chainArg ? [chainArg] : ['sepolia', 'base-sepolia'];

// Contracts that are *just* proxy wrappers (ERC1967Proxy, UpgradeableBeacon) —
// these don't have a distinct contract name per deployment, so we skip them in
// the tracked manifest. They're reachable via the named contract that created them.
const SKIP_NAMES = new Set(['ERC1967Proxy', 'UpgradeableBeacon']);

interface Creation {
  name: string;
  address: Address;
  timestamp: number;
  blockNumber?: number;
  script: string;
}

function loadBroadcasts(chainId: number): Creation[] {
  const broadcastRoot = path.resolve(process.cwd(), 'apps/contracts/broadcast');
  if (!fs.existsSync(broadcastRoot)) return [];

  const all: Creation[] = [];
  for (const scriptDir of fs.readdirSync(broadcastRoot)) {
    const chainDir = path.join(broadcastRoot, scriptDir, String(chainId));
    if (!fs.existsSync(chainDir)) continue;
    const runLatest = path.join(chainDir, 'run-latest.json');
    if (!fs.existsSync(runLatest)) continue;

    const broadcast = JSON.parse(fs.readFileSync(runLatest, 'utf-8'));
    const ts = broadcast.timestamp ?? 0;
    for (const tx of broadcast.transactions ?? []) {
      if (tx.transactionType !== 'CREATE' || !tx.contractName || !tx.contractAddress) continue;
      if (SKIP_NAMES.has(tx.contractName)) continue;
      all.push({
        name: tx.contractName,
        address: getAddress(tx.contractAddress),
        timestamp: ts,
        script: scriptDir,
      });
    }
  }
  return all;
}

function latestPerContract(creations: Creation[]): Record<string, Creation> {
  const by: Record<string, Creation> = {};
  for (const c of creations) {
    const existing = by[c.name];
    if (!existing || c.timestamp > existing.timestamp) by[c.name] = c;
  }
  return by;
}

async function verifyOnChain(
  cfg: ChainCfg,
  addresses: Record<string, Creation>
): Promise<Record<string, { hasCode: boolean; codeSize: number }>> {
  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
  const results: Record<string, { hasCode: boolean; codeSize: number }> = {};
  const names = Object.keys(addresses);
  let done = 0;
  for (const name of names) {
    const code = await client
      .getBytecode({ address: addresses[name].address })
      .catch(() => undefined);
    const hasCode = !!code && code !== '0x';
    results[name] = { hasCode, codeSize: code ? (code.length - 2) / 2 : 0 };
    done++;
    process.stdout.write(`\r    verifying on-chain: ${done}/${names.length}`);
  }
  process.stdout.write('\n');
  return results;
}

interface ChainResult {
  cfg: ChainCfg;
  addresses: Record<string, Creation>;
  verification: Record<string, { hasCode: boolean; codeSize: number }>;
  startBlock: number;
}

async function main() {
  const results: ChainResult[] = [];

  for (const name of CHAINS_TO_RUN) {
    const cfg = CHAINS[name];
    if (!cfg) {
      console.error(`Unknown chain: ${name}`);
      process.exit(1);
    }

    console.log(`\n${'='.repeat(70)}\n  ${cfg.environment} (${cfg.chainId})\n${'='.repeat(70)}`);

    const creations = loadBroadcasts(cfg.chainId);
    console.log(`  Found ${creations.length} CREATE transactions across broadcasts`);

    const latest = latestPerContract(creations);
    const contractNames = Object.keys(latest).sort();
    console.log(`  Resolved ${contractNames.length} unique contracts (most recent per name):\n`);
    for (const cn of contractNames) {
      const c = latest[cn];
      const d = new Date(c.timestamp * 1000);
      console.log(
        `    ${cn.padEnd(30)} ${c.address}  [${c.script}, ${d.toISOString().slice(0, 10)}]`
      );
    }

    console.log(`\n  Verifying on-chain...`);
    const verification = await verifyOnChain(cfg, latest);

    // Report dead addresses
    const dead = contractNames.filter((n) => !verification[n].hasCode);
    if (dead.length) {
      console.log(
        `\n  WARNING: ${dead.length} contracts have NO bytecode (reverted/not broadcast):`
      );
      for (const n of dead) console.log(`    - ${n} @ ${latest[n].address}`);
    } else {
      console.log(`\n  All ${contractNames.length} contracts have live bytecode on-chain. OK.`);
    }

    // Compute startBlock from oldest CREATE timestamp — approximate via manifest pass-through
    // Use lowest block from the earliest broadcast if available, else 0
    const broadcastRoot = path.resolve(process.cwd(), 'apps/contracts/broadcast');
    let startBlock = Number.MAX_SAFE_INTEGER;
    for (const scriptDir of fs.readdirSync(broadcastRoot)) {
      const runLatest = path.join(broadcastRoot, scriptDir, String(cfg.chainId), 'run-latest.json');
      if (!fs.existsSync(runLatest)) continue;
      const b = JSON.parse(fs.readFileSync(runLatest, 'utf-8'));
      for (const r of b.receipts ?? []) {
        if (r.blockNumber) {
          const bn = parseInt(r.blockNumber, 16);
          if (bn < startBlock) startBlock = bn;
        }
      }
    }
    if (startBlock === Number.MAX_SAFE_INTEGER) startBlock = 0;

    results.push({ cfg, addresses: latest, verification, startBlock });
  }

  if (!APPLY) {
    console.log(
      `\n${'='.repeat(70)}\n  DRY RUN — no files written. Re-run with --apply to rewrite.\n${'='.repeat(70)}\n`
    );
    process.exit(0);
  }

  // ── write manifests ─────────────────────────────────────────────────────
  for (const r of results) {
    const liveOnly = Object.fromEntries(
      Object.entries(r.addresses)
        .filter(([n]) => r.verification[n].hasCode)
        .map(([n, c]) => [n, c.address])
    );
    const manifest = {
      chainId: r.cfg.chainId,
      environment: r.cfg.environment,
      startBlock: r.startBlock,
      updatedAt: new Date().toISOString(),
      contracts: liveOnly,
    };
    const outPath = path.resolve(process.cwd(), r.cfg.manifestFile);
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`  Wrote ${r.cfg.manifestFile} (${Object.keys(liveOnly).length} contracts)`);
  }

  // ── write addresses.ts (merge across all chains we touched) ────────────
  // Load ALL existing deployment manifests so we don't accidentally drop a chain
  // that wasn't part of this run.
  const allManifests: Array<{ chainId: number; contracts: Record<string, string> }> = [];
  const deployDir = path.resolve(process.cwd(), 'deployments');
  for (const f of fs.readdirSync(deployDir)) {
    if (!f.endsWith('.json')) continue;
    const m = JSON.parse(fs.readFileSync(path.join(deployDir, f), 'utf-8'));
    const hasReal = Object.values(m.contracts).some(
      (a) => a !== '0x0000000000000000000000000000000000000000'
    );
    if (hasReal) allManifests.push(m);
  }
  const allNames = [...new Set(allManifests.flatMap((m) => Object.keys(m.contracts)))].sort();

  let ts = `// Auto-generated from deployment manifests — do not edit directly.\n`;
  ts += `// To update: pnpm tsx scripts/rebuild-deployments.ts --apply\n\n`;
  for (const name of allNames) {
    ts += `export const ${name} = {\n`;
    for (const m of allManifests) {
      if (m.contracts[name]) ts += `  '${m.chainId}': '${m.contracts[name]}',\n`;
    }
    ts += `} as const;\n\n`;
    ts += `export type ${name}ChainId = keyof typeof ${name};\n\n`;
  }
  const addrPath = path.resolve(process.cwd(), 'packages/abis/src/addresses.ts');
  fs.writeFileSync(addrPath, ts);
  console.log(
    `  Wrote packages/abis/src/addresses.ts (${allNames.length} contracts across ${allManifests.length} chains)`
  );

  console.log(`\n${'='.repeat(70)}\n  Done.\n${'='.repeat(70)}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
