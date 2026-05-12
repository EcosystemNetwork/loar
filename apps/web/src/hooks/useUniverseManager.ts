import { useReadContract, useChainId } from 'wagmi';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { useWriteContract } from '@/hooks/useCircleWrite';
import { universeManagerAbi } from '@loar/abis/generated';
import { UniverseManager, LoarHookStaticFee, LoarLpLockerMultiple } from '@loar/abis/addresses';
import { isSupportedChain } from '@/configs/chains';
import { encodeAbiParameters } from 'viem';

// WETH addresses per chain (hooks require ERC20 paired token, not native ETH).
// MUST match UniverseManager.weth() on each chain — the contract rejects any
// other pairedToken with "Paired token must be WETH" (UniverseManager.sol:317).
const WETH: Partial<Record<number, `0x${string}`>> = {
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia (Uniswap v4 WETH; prior value 0x7b79…E7f9 was wrong)
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia
  8453: '0x4200000000000000000000000000000000000006', // Base Mainnet
};

/**
 * Hook for interacting with the UniverseManager contract (launchpad)
 *
 * Flow:
 * 1. createUniverse() - deploys a new Universe contract
 * 2. deployUniverseToken() - deploys token, governor, and sets up liquidity pool
 */
export function useUniverseManager() {
  const chainId = useChainId();
  const { isConnected } = useWalletAccount();
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();

  const contractAddress = UniverseManager[String(chainId) as keyof typeof UniverseManager];

  // Read the on-chain mint fee
  const { data: mintFee, isLoading: mintFeeLoading } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: universeManagerAbi,
    functionName: 'mintFee',
    chainId,
    query: { enabled: !!contractAddress },
  });

  if (!contractAddress) {
    return {
      createUniverse: async () => {
        throw new Error(`UniverseManager not deployed on chain ${chainId}`);
      },
      deployUniverseToken: async () => {
        throw new Error(`UniverseManager not deployed on chain ${chainId}`);
      },
      useGetUniverseData: (_universeId?: bigint) => ({
        data: undefined,
        isLoading: false,
        error: null,
      }),
      hash: undefined,
      isPending: false,
      error: new Error(`UniverseManager not deployed on chain ${chainId}`),
    } as any;
  }

  /**
   * Step 1: Create a new Universe contract
   * @param config - Universe configuration
   * @returns Transaction hash
   */
  const createUniverse = async (config: {
    name: string;
    imageURL: string;
    description: string;
    nodeCreationOptions: number; // 0 = OPEN, 1 = TOKEN_GATED, 2 = ADMIN_ONLY
    nodeVisibilityOptions: number; // 0 = PUBLIC, 1 = TOKEN_GATED
    initialOwner: `0x${string}`;
    /** Optional Safe multi-sig address — if set, used as initialOwner instead */
    safeAddress?: `0x${string}`;
  }) => {
    if (!isConnected) throw new Error('Wallet not connected');
    if (!isSupportedChain(chainId))
      throw new Error(`Unsupported chain ${chainId}. Please switch to a supported network.`);

    const owner = config.safeAddress ?? config.initialOwner;
    await writeContractAsync({
      address: contractAddress as `0x${string}`,
      abi: universeManagerAbi,
      functionName: 'createUniverse',
      args: [
        config.name,
        config.imageURL,
        config.description,
        config.nodeCreationOptions,
        config.nodeVisibilityOptions,
        owner,
      ],
      value: mintFee ?? undefined,
      chainId,
    });
  };

  /**
   * Step 2: Deploy token, governor, and liquidity pool for a universe
   */
  /**
   * Step 2: Deploy token, governor, and liquidity pool for a universe.
   * No ETH value needed — the mint fee ETH from createUniverse is automatically
   * wrapped to WETH and deposited into the token's liquidity pool.
   */
  const deployUniverseToken = async (
    config: {
      tokenConfig: {
        tokenAdmin: `0x${string}`;
        name: string;
        symbol: string;
        imageURL: string;
        metadata: string;
        context: string;
      };
      poolConfig: {
        hook: `0x${string}`;
        pairedToken: `0x${string}`;
        tickIfToken0IsLoar: number;
        tickSpacing: number;
        poolData: `0x${string}`;
      };
      lockerConfig: {
        locker: `0x${string}`;
        rewardAdmins: `0x${string}`[];
        rewardRecipients: `0x${string}`[];
        rewardBps: number[];
        tickLower: number[];
        tickUpper: number[];
        positionBps: number[];
        lockerData: `0x${string}`;
      };
      allocationConfig?: {
        curveBps: number;
        creatorBps: number;
        treasuryBps: number;
        communityBps: number;
      };
    },
    universeId: bigint
  ) => {
    if (!isConnected) throw new Error('Wallet not connected');
    if (!isSupportedChain(chainId))
      throw new Error(`Unsupported chain ${chainId}. Please switch to a supported network.`);

    const allocationConfig = config.allocationConfig ?? {
      curveBps: 8000,
      creatorBps: 1000,
      treasuryBps: 500,
      communityBps: 500,
    };

    await writeContractAsync({
      address: contractAddress as `0x${string}`,
      abi: universeManagerAbi,
      functionName: 'deployUniverseToken',
      args: [
        {
          tokenConfig: config.tokenConfig,
          poolConfig: config.poolConfig,
          lockerConfig: config.lockerConfig,
          allocationConfig,
        },
        universeId,
      ],
      chainId,
    });
  };

  /**
   * Atomic: create universe + deploy token in a single transaction.
   * One wallet signature, one tx. No fragile intermediate state.
   */
  const createUniverseWithToken = async (
    universeConfig: {
      name: string;
      imageURL: string;
      description: string;
      nodeCreationOptions: number;
      nodeVisibilityOptions: number;
      initialOwner: `0x${string}`;
      safeAddress?: `0x${string}`;
    },
    deploymentConfig: {
      tokenConfig: {
        tokenAdmin: `0x${string}`;
        name: string;
        symbol: string;
        imageURL: string;
        metadata: string;
        context: string;
      };
      poolConfig: {
        hook: `0x${string}`;
        pairedToken: `0x${string}`;
        tickIfToken0IsLoar: number;
        tickSpacing: number;
        poolData: `0x${string}`;
      };
      lockerConfig: {
        locker: `0x${string}`;
        rewardAdmins: `0x${string}`[];
        rewardRecipients: `0x${string}`[];
        rewardBps: number[];
        tickLower: number[];
        tickUpper: number[];
        positionBps: number[];
        lockerData: `0x${string}`;
      };
      allocationConfig?: {
        curveBps: number;
        creatorBps: number;
        treasuryBps: number;
        communityBps: number;
      };
    }
  ) => {
    if (!isConnected) throw new Error('Wallet not connected');
    if (!isSupportedChain(chainId))
      throw new Error(`Unsupported chain ${chainId}. Please switch to a supported network.`);

    const owner = universeConfig.safeAddress ?? universeConfig.initialOwner;
    const allocationConfig = deploymentConfig.allocationConfig ?? {
      curveBps: 8000,
      creatorBps: 1000,
      treasuryBps: 500,
      communityBps: 500,
    };

    await writeContractAsync({
      address: contractAddress as `0x${string}`,
      abi: universeManagerAbi,
      functionName: 'createUniverseWithToken',
      args: [
        universeConfig.name,
        universeConfig.imageURL,
        universeConfig.description,
        universeConfig.nodeCreationOptions,
        universeConfig.nodeVisibilityOptions,
        owner,
        {
          tokenConfig: deploymentConfig.tokenConfig,
          poolConfig: deploymentConfig.poolConfig,
          lockerConfig: deploymentConfig.lockerConfig,
          allocationConfig,
        },
      ],
      value: mintFee ?? undefined,
      chainId,
    });
  };

  /**
   * Read function to get universe data by ID
   * Returns: [universeAddress, tokenAddress, governorAddress, hookAddress, lockerAddress]
   */
  const useGetUniverseData = (universeId: bigint | undefined) => {
    return useReadContract({
      address: contractAddress as `0x${string}`,
      abi: universeManagerAbi,
      functionName: 'getUniverseData',
      args: universeId !== undefined ? [universeId] : undefined,
      query: {
        enabled: universeId !== undefined,
      },
      chainId,
    });
  };

  return {
    createUniverse,
    createUniverseWithToken,
    deployUniverseToken,
    useGetUniverseData,
    mintFee: mintFee as bigint | undefined,
    mintFeeLoading,
    hash,
    isPending,
    error,
  };
}

/**
 * Hook to get default deployment config for simplified token deployment
 * Uses the deployed hook, locker, and paired token addresses from packages/abis/addresses
 */
export function useDefaultDeploymentConfig() {
  const chainId = useChainId();
  const chainKey = String(chainId) as keyof typeof LoarHookStaticFee;

  // Encode pool fee config: loarFee=3000 (0.3%), pairedFee=3000 (0.3%)
  const defaultPoolData = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'loarFee', type: 'uint24' },
          { name: 'pairedFee', type: 'uint24' },
        ],
      },
    ],
    [{ loarFee: 3000, pairedFee: 3000 }]
  );

  return {
    defaultHook: (LoarHookStaticFee[chainKey] ?? undefined) as `0x${string}` | undefined,
    defaultLocker: (LoarLpLockerMultiple[chainKey] ?? undefined) as `0x${string}` | undefined,
    defaultPairedToken: WETH[chainId] as `0x${string}` | undefined, // undefined if chain not supported — caller must check
    defaultTickSpacing: 200,
    defaultTickIfToken0IsLoar: -230400, // Standard starting tick
    defaultPoolData,
  };
}
