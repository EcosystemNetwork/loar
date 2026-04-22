/**
 * Per-chain addresses and configuration, loaded from deployments/{chain}.json.
 *
 * Static addresses (UniverseManager, PoolManager, revenue contracts) are
 * resolved once at boot. Dynamic factory children (Universe, Governor, Token,
 * BondingCurve instances) live in Firestore `indexer_factoryChildren` and are
 * tracked by `factory.ts`.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { env } from './env.js';
import type { ContractKind } from './handlers/types.js';
import type { Hex } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DeploymentFile {
  chainId: number;
  environment: string;
  startBlock: number;
  contracts: Record<string, string>;
}

function loadDeployment(): DeploymentFile {
  // dist/ and src/ both sit two levels under apps/event-listener/, so the
  // relative path to the repo root deployments/ is identical.
  const path = resolve(__dirname, '../../../deployments', `${env.LISTENER_CHAIN}.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const deployment = loadDeployment();

/** Lowercase the hex address for consistent map/set keys. */
function lc(addr: string | undefined): Hex | undefined {
  return addr ? (addr.toLowerCase() as Hex) : undefined;
}

export const chainConfig = {
  chainName: env.LISTENER_CHAIN,
  chainId: deployment.chainId,
  startBlock: deployment.startBlock,
  // Static contracts by ContractKind. Address `undefined` means the contract
  // isn't deployed on this chain yet — skip subscribing to it.
  staticAddresses: {
    UniverseManager: lc(deployment.contracts.UniverseManager),
    // PoolManager is Uniswap v4 — address is not in the deployment file but
    // hardcoded per chain (same source as apps/indexer/ponder.config.ts).
    PoolManager: lc(
      env.LISTENER_CHAIN === 'sepolia'
        ? '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'
        : env.LISTENER_CHAIN === 'base-sepolia'
          ? '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408'
          : '0xE8E23e97Fa135823143d6b9Cba9c699040D51F70'
    ),
    CanonMarketplace: lc(deployment.contracts.CanonMarketplace),
    LicensingRegistry: lc(deployment.contracts.LicensingRegistry),
    CollabManager: lc(deployment.contracts.CollabManager),
  } satisfies Partial<Record<ContractKind, Hex | undefined>>,
};

/**
 * Returns the ContractKind for a given address. Dynamic (factory-spawned)
 * addresses are excluded — caller should check factory.hasChild() first.
 */
export function kindForStaticAddress(addr: Hex): ContractKind | undefined {
  const lowered = addr.toLowerCase() as Hex;
  for (const [kind, a] of Object.entries(chainConfig.staticAddresses)) {
    if (a && a === lowered) return kind as ContractKind;
  }
  return undefined;
}
