import { useReadContract, useChainId, useAccount } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { universeManagerAbi } from '@loar/abis/generated';
import { UniverseManager, LoarHookStaticFee, LoarLpLockerMultiple } from '@loar/abis/addresses';
import { isSupportedChain } from '@/configs/chains';
import { encodeAbiParameters } from 'viem';

// WETH addresses per chain (hooks require ERC20 paired token, not native ETH)
const WETH: Record<number, `0x${string}`> = {
  11155111: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', // Sepolia
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia
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
  const { isConnected: wagmiConnected } = useAccount();
  const thirdwebAccount = useActiveAccount();
  const isConnected = wagmiConnected || !!thirdwebAccount;
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();

  const contractAddress = UniverseManager[String(chainId) as keyof typeof UniverseManager];

  // Read the on-chain mint fee
  const { data: mintFee } = useReadContract({
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
      value: mintFee as bigint | undefined,
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
        lpBps: number;
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
      lpBps: 8000,
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
    deployUniverseToken,
    useGetUniverseData,
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
    defaultPairedToken: (WETH[chainId] ?? WETH[11155111]) as `0x${string}`, // WETH (hooks reject address(0))
    defaultTickSpacing: 200,
    defaultTickIfToken0IsLoar: -230400, // Standard starting tick
    defaultPoolData,
  };
}
