/**
 * Ponder Indexer Configuration
 *
 * Configures Ponder to index LOAR protocol contracts on Ethereum Sepolia
 * or Base Sepolia (set PONDER_CHAIN env var). Uses the factory pattern to
 * dynamically track Universe, Governor, and Token contracts spawned by
 * the UniverseManager factory. Also indexes Uniswap v4 PoolManager swap
 * events for token price tracking.
 */
import './env'; // validates env and loads .env files — must be first
import { env } from './env';
import { createConfig, factory } from 'ponder';
import { parseAbiItem } from 'viem';
import {
  universeManagerAbi,
  universeAbi,
  universeGovernorAbi,
  paymentRouterAbi,
  creditManagerAbi,
  subscriptionManagerAbi,
} from '@loar/abis/generated';
import { PoolManagerAbi } from './abis/PoolManager';
import { ERC20Abi } from './abis/ERC20Abi';
import { sepolia, baseSepolia, base } from 'viem/chains';
import { getAddress } from 'viem/utils';

// ── Chain config (driven by PONDER_CHAIN env var) ───────────────────────────
const CHAIN_CONFIGS = {
  sepolia: {
    chainName: 'sepolia' as const,
    chain: sepolia,
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543' as `0x${string}`,
    deploymentFile: 'sepolia.json',
  },
  'base-sepolia': {
    chainName: 'base-sepolia' as const,
    chain: baseSepolia,
    poolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408' as `0x${string}`,
    deploymentFile: 'base-sepolia.json',
  },
  base: {
    chainName: 'base' as const,
    chain: base,
    poolManager: '0xE8E23e97Fa135823143d6b9Cba9c699040D51F70' as `0x${string}`, // Uniswap v4 PoolManager on Base
    deploymentFile: 'base.json',
  },
} as const;

const chainConfig = CHAIN_CONFIGS[env.PONDER_CHAIN];
const chainName = chainConfig.chainName;
const poolManagerAddress = chainConfig.poolManager;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deployment = require(`../../deployments/${chainConfig.deploymentFile}`);
const address = getAddress(deployment.contracts.UniverseManager);
const startBlock = deployment.startBlock;

// Revenue contract addresses (deployed separately via DeployRevenue.s.sol)
const paymentRouterAddress = deployment.contracts.PaymentRouter
  ? getAddress(deployment.contracts.PaymentRouter)
  : undefined;
const creditManagerAddress = deployment.contracts.CreditManager
  ? getAddress(deployment.contracts.CreditManager)
  : undefined;
const subscriptionManagerAddress = deployment.contracts.SubscriptionManager
  ? getAddress(deployment.contracts.SubscriptionManager)
  : undefined;

const universeCreatedEvent = parseAbiItem(
  'event UniverseCreated(address universe, address creator)'
);

const tokenCreatedEvent = parseAbiItem(
  'event TokenCreated(address indexed msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address governor)'
);

export default createConfig({
  chains: {
    [chainName]: {
      id: chainConfig.chain.id,
      rpc: [env.PONDER_RPC_URL, ...env.PONDER_RPC_FALLBACKS].filter(Boolean),
      maxRequestsPerSecond: 25,
    },
  },
  contracts: {
    UniverseManager: {
      chain: chainName,
      abi: universeManagerAbi,
      address: address,
      startBlock: startBlock,
    },
    Universe: {
      chain: chainName,
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
      chain: chainName,
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
      chain: chainName,
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
      chain: chainName,
      abi: PoolManagerAbi,
      address: poolManagerAddress,
      startBlock: startBlock,
    },
    // ── Revenue contracts (indexed for on-chain source of truth) ─────
    ...(paymentRouterAddress && {
      PaymentRouter: {
        chain: chainName,
        abi: paymentRouterAbi,
        address: paymentRouterAddress,
        startBlock: startBlock,
      },
    }),
    ...(creditManagerAddress && {
      CreditManager: {
        chain: chainName,
        abi: creditManagerAbi,
        address: creditManagerAddress,
        startBlock: startBlock,
      },
    }),
    ...(subscriptionManagerAddress && {
      SubscriptionManager: {
        chain: chainName,
        abi: subscriptionManagerAbi,
        address: subscriptionManagerAddress,
        startBlock: startBlock,
      },
    }),
    // TODO: Add CanonMarketplace, AdPlacement, LicensingRegistry, CollabManager,
    // AnalyticsRegistry once ABIs are generated (run: forge build && npx wagmi generate)
  },
});
