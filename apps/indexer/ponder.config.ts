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
import { parseAbi, parseAbiItem } from 'viem';
import {
  universeManagerAbi,
  universeAbi,
  universeGovernorAbi,
  paymentRouterAbi,
  creditManagerAbi,
  subscriptionManagerAbi,
  canonMarketplaceAbi,
  licensingRegistryAbi,
  collabManagerAbi,
  // analyticsRegistryAbi — no events to index currently
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

// Revenue contract addresses (deployed separately via DeployRevenue.s.sol).
// For any revenue contract not yet deployed on this chain we register a
// disabled stub: zero address + far-future startBlock. This keeps the contract
// in the config type (so ponder.on() handlers typecheck unconditionally)
// without indexing anything from address(0). When the contract is deployed,
// swap in the real address + real startBlock and the handlers light up.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
// ~9.9B — larger than any real block number on any chain we index, so ponder
// treats the contract as dormant until the deployment file is updated.
const UNDEPLOYED_BLOCK = 9_999_999_999;

const paymentRouterAddress = deployment.contracts.PaymentRouter
  ? getAddress(deployment.contracts.PaymentRouter)
  : undefined;
const creditManagerAddress = deployment.contracts.CreditManager
  ? getAddress(deployment.contracts.CreditManager)
  : undefined;
const subscriptionManagerAddress = deployment.contracts.SubscriptionManager
  ? getAddress(deployment.contracts.SubscriptionManager)
  : undefined;
const canonMarketplaceAddress = deployment.contracts.CanonMarketplace
  ? getAddress(deployment.contracts.CanonMarketplace)
  : undefined;
const licensingRegistryAddress = deployment.contracts.LicensingRegistry
  ? getAddress(deployment.contracts.LicensingRegistry)
  : undefined;
const collabManagerAddress = deployment.contracts.CollabManager
  ? getAddress(deployment.contracts.CollabManager)
  : undefined;

const universeCreatedEvent = parseAbiItem(
  'event UniverseCreated(address universe, address creator)'
);

const tokenCreatedEvent = parseAbiItem(
  'event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address governor)'
);

const bondingCurveCreatedEvent = parseAbiItem(
  'event BondingCurveCreated(uint256 indexed universeId, address indexed token, address indexed bondingCurve, uint256 graduationEth, uint256 curveSupply)'
);

const bondingCurveAbi = parseAbi([
  'event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount, uint256 newPrice)',
  'event TokensSold(address indexed seller, uint256 tokenAmount, uint256 ethReturned, uint256 newPrice)',
  'event RefundPending(address indexed buyer, uint256 amount)',
  'event RefundClaimed(address indexed buyer, uint256 amount)',
  'event TradingHalted(uint256 indexed universeId)',
  'event TradingResumed(uint256 indexed universeId)',
  'event TradingHaltedByManager(uint256 indexed universeId, bool halted)',
  'event Graduated(uint256 indexed universeId, address indexed token, uint256 ethRaised, uint256 lpTokens)',
]);

export default createConfig({
  chains: {
    [chainName]: {
      id: chainConfig.chain.id,
      rpc: [env.PONDER_RPC_URL, ...env.PONDER_RPC_FALLBACKS].filter(Boolean),
      maxRequestsPerSecond: 25,
      pollingInterval: 2000,
      maxBlockRange: 100,
      finalityBlockCount: 15,
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
    BondingCurve: {
      chain: chainName,
      abi: bondingCurveAbi,
      address: factory({
        address: address,
        event: bondingCurveCreatedEvent,
        parameter: 'bondingCurve',
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
    // ── Revenue contracts (always present in the config type so handlers
    //    typecheck; disabled with address(0) + far-future startBlock until
    //    the deployment file lists a real address for this chain). ─────────
    PaymentRouter: {
      chain: chainName,
      abi: paymentRouterAbi,
      address: paymentRouterAddress ?? ZERO_ADDRESS,
      startBlock: paymentRouterAddress ? startBlock : UNDEPLOYED_BLOCK,
    },
    CreditManager: {
      chain: chainName,
      abi: creditManagerAbi,
      address: creditManagerAddress ?? ZERO_ADDRESS,
      startBlock: creditManagerAddress ? startBlock : UNDEPLOYED_BLOCK,
    },
    SubscriptionManager: {
      chain: chainName,
      abi: subscriptionManagerAbi,
      address: subscriptionManagerAddress ?? ZERO_ADDRESS,
      startBlock: subscriptionManagerAddress ? startBlock : UNDEPLOYED_BLOCK,
    },
    CanonMarketplace: {
      chain: chainName,
      abi: canonMarketplaceAbi,
      address: canonMarketplaceAddress ?? ZERO_ADDRESS,
      startBlock: canonMarketplaceAddress ? startBlock : UNDEPLOYED_BLOCK,
    },
    LicensingRegistry: {
      chain: chainName,
      abi: licensingRegistryAbi,
      address: licensingRegistryAddress ?? ZERO_ADDRESS,
      startBlock: licensingRegistryAddress ? startBlock : UNDEPLOYED_BLOCK,
    },
    CollabManager: {
      chain: chainName,
      abi: collabManagerAbi,
      address: collabManagerAddress ?? ZERO_ADDRESS,
      startBlock: collabManagerAddress ? startBlock : UNDEPLOYED_BLOCK,
    },
  },
});
