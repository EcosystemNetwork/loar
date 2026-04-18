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

    // Merge in any contracts from the prior manifest that aren't in the broadcast
    // set — some contracts were deployed once via a script whose broadcast was
    // later overwritten (e.g. LoarHookStaticFee on Sepolia). Verify each prior
    // address on-chain before keeping.
    const priorManifestPath = path.resolve(process.cwd(), cfg.manifestFile);
    const priorNames: string[] = [];
    if (fs.existsSync(priorManifestPath)) {
      const prior = JSON.parse(fs.readFileSync(priorManifestPath, 'utf-8'));
      for (const [name, addr] of Object.entries(prior.contracts ?? {}) as Array<[string, string]>) {
        if (!latest[name]) {
          latest[name] = {
            name,
            address: getAddress(addr),
            timestamp: 0,
            script: '(preserved from prior manifest)',
          };
          priorNames.push(name);
        }
      }
    }

    const contractNames = Object.keys(latest).sort();
    console.log(`  Resolved ${contractNames.length} unique contracts (most recent per name):\n`);
    for (const cn of contractNames) {
      const c = latest[cn];
      const when =
        c.timestamp > 0 ? new Date(c.timestamp * 1000).toISOString().slice(0, 10) : 'preserved';
      console.log(`    ${cn.padEnd(30)} ${c.address}  [${c.script}, ${when}]`);
    }
    if (priorNames.length) {
      console.log(
        `\n  Preserved ${priorNames.length} address(es) from prior manifest (not in recent broadcasts): ${priorNames.join(', ')}`
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

  // ── write apps/web/src/configs/addresses.ts (runtime address registry) ──
  // This file is the canonical runtime source for the web app's contract
  // interactions. We keep its shape stable (EvmAddresses interface) but
  // regenerate the values from deployment manifests.
  const WEB_FIELD_MAP: Record<string, string> = {
    universeManager: 'UniverseManager',
    loarToken: 'LoarToken',
    paymentRouter: 'PaymentRouter',
    creditManager: 'CreditManager',
    rightsRegistry: 'RightsRegistry',
    revenueModuleFactory: 'RevenueModuleFactory',
    canonMarketplace: 'CanonMarketplace',
    adPlacement: 'AdPlacement',
    subscriptionManager: 'SubscriptionManager',
    licensingRegistry: 'LicensingRegistry',
    collabManager: 'CollabManager',
    analyticsRegistry: 'AnalyticsRegistry',
    loarHook: 'LoarHookStaticFee',
    lpLocker: 'LoarLpLockerMultiple',
    feeLocker: 'LoarFeeLocker',
    swapRouter: 'LoarSwapRouter',
    tokenVesting: 'TokenVesting',
  };
  const ZERO = '0x0000000000000000000000000000000000000000';
  const webChains = [11155111, 84532] as const;
  const webMap: Record<number, Record<string, string>> = {};
  for (const chainId of webChains) {
    const manifest = allManifests.find((m) => m.chainId === chainId);
    const row: Record<string, string> = {};
    for (const [webField, contractName] of Object.entries(WEB_FIELD_MAP)) {
      row[webField] = manifest?.contracts[contractName] ?? ZERO;
    }
    // Beacon addresses — these come from DeployRevenue broadcasts and aren't
    // tracked in our simple name→address map because beacons are declared as
    // UpgradeableBeacon (which we skip). Leave existing values untouched by
    // reading the current apps/web/src/configs/addresses.ts if present.
    webMap[chainId] = row;
  }

  // Preserve existing beacon addresses from the current file rather than
  // zeroing them out — we don't have a reliable auto-source for beacons yet.
  const webAddrPath = path.resolve(process.cwd(), 'apps/web/src/configs/addresses.ts');
  let existingBeacons: Record<number, Record<string, string>> = {};
  if (fs.existsSync(webAddrPath)) {
    const existing = fs.readFileSync(webAddrPath, 'utf-8');
    for (const chainId of webChains) {
      const section = new RegExp(
        `${chainId}:\\s*\\{([\\s\\S]*?)\\},?\\s*\\n\\s*(?:\\d+:|\\})`,
        'm'
      ).exec(existing);
      if (!section) continue;
      const beacons: Record<string, string> = {};
      for (const key of [
        'episodeEditionBeacon',
        'characterBeacon',
        'entityBeacon',
        'entityEditionBeacon',
        'episodeNftBeacon',
      ]) {
        const m = new RegExp(`${key}:\\s*['\"](0x[0-9a-fA-F]{40})['\"]`).exec(section[1]);
        if (m) beacons[key] = m[1];
      }
      existingBeacons[chainId] = beacons;
    }
  }

  let webTs = `/**\n * Contract Address Registry — Sepolia + Base Sepolia\n *\n * Auto-generated from deployment manifests. To update, run:\n *   pnpm sync:addresses\n *\n * Beacon addresses are preserved from the prior file — update those manually\n * after a beacon redeploy.\n */\n\nimport type { SupportedEvmChainId } from './chains';\n\nexport interface EvmAddresses {\n`;
  for (const field of Object.keys(WEB_FIELD_MAP)) {
    webTs += `  ${field}: \`0x\${string}\`;\n`;
  }
  webTs += `  // Beacon addresses (for upgrades, not direct interaction)\n`;
  for (const b of [
    'episodeEditionBeacon',
    'characterBeacon',
    'entityBeacon',
    'entityEditionBeacon',
    'episodeNftBeacon',
  ]) {
    webTs += `  ${b}: \`0x\${string}\`;\n`;
  }
  webTs += `}\n\nconst ZERO_ADDR = '0x0000000000000000000000000000000000000000' as \`0x\${string}\`;\n\nexport const EVM_ADDRESSES: Partial<Record<SupportedEvmChainId, EvmAddresses>> = {\n`;
  for (const chainId of webChains) {
    webTs += `  ${chainId}: {\n`;
    for (const [field, contractName] of Object.entries(WEB_FIELD_MAP)) {
      webTs += `    ${field}: '${webMap[chainId][field]}',\n`;
    }
    const beacons = existingBeacons[chainId] ?? {};
    for (const b of [
      'episodeEditionBeacon',
      'characterBeacon',
      'entityBeacon',
      'entityEditionBeacon',
      'episodeNftBeacon',
    ]) {
      webTs += `    ${b}: '${beacons[b] ?? ZERO}',\n`;
    }
    webTs += `  },\n`;
  }
  webTs += `};\n\nexport function getEvmAddresses(chainId: number): EvmAddresses | null {\n  return (EVM_ADDRESSES as Record<number, EvmAddresses | undefined>)[chainId] ?? null;\n}\n\n/**\n * Returns true if the address is a zero address (undeployed contract).\n * Use this to guard contract interactions that would revert.\n */\nexport function isZeroAddress(addr: \`0x\${string}\` | undefined): boolean {\n  return !addr || addr === ZERO_ADDR;\n}\n\n/**\n * Logs warnings for undeployed contracts at startup.\n * Call once from app init to surface configuration gaps.\n */\nexport function warnUndeployedContracts(chainId: number): void {\n  const addrs = getEvmAddresses(chainId);\n  if (!addrs) {\n    console.warn(\`[addresses] No contract addresses configured for chain \${chainId}\`);\n    return;\n  }\n  const critical = ['loarToken'] as const;\n  for (const key of critical) {\n    if (isZeroAddress(addrs[key])) {\n      console.warn(\n        \`[addresses] \${key} is zero address on chain \${chainId} — related features disabled\`\n      );\n    }\n  }\n}\n`;

  fs.writeFileSync(webAddrPath, webTs);
  console.log(`  Wrote apps/web/src/configs/addresses.ts`);

  console.log(`\n${'='.repeat(70)}\n  Done.\n${'='.repeat(70)}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
