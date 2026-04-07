/**
 * Ponder Indexer Configuration
 *
 * Configures Ponder to index LOAR protocol contracts on Sepolia and Base Sepolia
 * testnets. Uses the factory pattern to dynamically track Universe, Governor, and
 * Token contracts spawned by the UniverseManager factory. Also indexes Uniswap v4
 * PoolManager swap events for token price tracking.
 *
 * Set PONDER_CHAIN env var to "base-sepolia" to index Base Sepolia instead.
 */
import './env.ts'; // validates env and loads .env files — must be first
import { env } from './env.ts';
import { createConfig, factory } from 'ponder';
import { parseAbiItem } from 'viem';
import { universeManagerAbi, universeAbi, universeGovernorAbi } from '@loar/abis/generated';
import { PoolManagerAbi } from './abis/PoolManager';
import { ERC20Abi } from './abis/ERC20Abi';
import { sepolia, baseSepolia } from 'viem/chains';
import { getAddress } from 'viem/utils';

// ── Chain selection ──────────────────────────────────────────────────────────
const ponderChain = process.env.PONDER_CHAIN ?? 'sepolia';

interface ChainSetup {
  chainId: number;
  chainName: string;
  deploymentFile: string;
  poolManagerAddress: `0x${string}`;
}

const CHAIN_CONFIGS: Record<string, ChainSetup> = {
  sepolia: {
    chainId: sepolia.id,
    chainName: 'sepolia',
    deploymentFile: '../../deployments/sepolia.json',
    poolManagerAddress: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
  },
  'base-sepolia': {
    chainId: baseSepolia.id,
    chainName: 'baseSepolia',
    deploymentFile: '../../deployments/base-sepolia.json',
    // Base Sepolia Uniswap v4 PoolManager — update after deployment
    poolManagerAddress: '0x0000000000000000000000000000000000000000',
  },
};

const chainSetup = CHAIN_CONFIGS[ponderChain];
if (!chainSetup) {
  throw new Error(
    `Unknown PONDER_CHAIN="${ponderChain}". Valid: ${Object.keys(CHAIN_CONFIGS).join(', ')}`
  );
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deployment = require(chainSetup.deploymentFile);
const address = getAddress(deployment.contracts.UniverseManager);
const startBlock = deployment.startBlock;

const universeCreatedEvent = parseAbiItem(
  'event UniverseCreated(address universe, address creator)'
);

const tokenCreatedEvent = parseAbiItem(
  'event TokenCreated(address indexed msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address governor)'
);

export default createConfig({
  chains: {
    [chainSetup.chainName]: {
      id: chainSetup.chainId,
      rpc: env.PONDER_RPC_URL,
      maxRequestsPerSecond: 2,
    },
  },
  contracts: {
    UniverseManager: {
      chain: chainSetup.chainName,
      abi: universeManagerAbi,
      address: address,
      startBlock: startBlock,
    },
    Universe: {
      chain: chainSetup.chainName,
      abi: universeAbi,
      address: factory({
        address: address,
        event: universeCreatedEvent,
        parameter: 'universe',
        startBlock: startBlock,
      }),
      startBlock: startBlock,
    },
    UniverseGovernor: {
      chain: chainSetup.chainName,
      abi: universeGovernorAbi,
      address: factory({
        address: address,
        event: tokenCreatedEvent,
        parameter: 'governor',
        startBlock: startBlock,
      }),
      startBlock: startBlock,
    },
    GovernanceToken: {
      chain: chainSetup.chainName,
      abi: ERC20Abi,
      address: factory({
        address: address,
        event: tokenCreatedEvent,
        parameter: 'tokenAddress',
        startBlock: startBlock,
      }),
      startBlock: startBlock,
    },
    PoolManager: {
      chain: chainSetup.chainName,
      abi: PoolManagerAbi,
      address: chainSetup.poolManagerAddress,
      startBlock: startBlock,
    },
  },
});
