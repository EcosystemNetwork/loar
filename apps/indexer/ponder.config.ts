/**
 * Ponder Indexer Configuration
 *
 * Configures Ponder to index LOAR protocol contracts on Sepolia testnet.
 * Uses the factory pattern to dynamically track Universe, Governor, and Token
 * contracts spawned by the UniverseManager factory. Also indexes Uniswap v4
 * PoolManager swap events for token price tracking.
 */
import './env.ts'; // validates env and loads .env files — must be first
import { env } from './env.ts';
import { createConfig, factory } from 'ponder';
import { parseAbiItem } from 'viem';
import { universeManagerAbi, universeAbi, universeGovernorAbi } from '@loar/abis/generated';
import { PoolManagerAbi } from './abis/PoolManager';
import { ERC20Abi } from './abis/ERC20Abi';
import { sepolia } from 'viem/chains';
import { getAddress } from 'viem/utils';
import deployment from '../../deployments/sepolia.json';

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
    sepolia: {
      id: 11155111,
      rpc: env.PONDER_RPC_URL,
      maxRequestsPerSecond: 2,
    },
  },
  contracts: {
    UniverseManager: {
      chain: 'sepolia',
      abi: universeManagerAbi,
      address: address,
      startBlock: startBlock,
    },
    Universe: {
      chain: 'sepolia',
      abi: universeAbi,
      address: factory({
        address: address,
        event: universeCreatedEvent,
        parameter: 'universe',
        startBlock: startBlock, // Scan for factory children from this block
      }),
      startBlock: startBlock, // Index child contracts from this block
    },
    UniverseGovernor: {
      chain: 'sepolia',
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
      chain: 'sepolia',
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
      chain: 'sepolia',
      abi: PoolManagerAbi,
      address: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
      startBlock: startBlock,
    },
  },
});
