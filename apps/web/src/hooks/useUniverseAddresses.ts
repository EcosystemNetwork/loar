/**
 * useUniverseAddresses — resolves a universe ID to its on-chain contract addresses.
 *
 * Tries the Ponder indexer first (fast, cached), falls back to direct on-chain
 * read via UniverseManager.getUniverseData().
 */
import { useQuery } from '@tanstack/react-query';
import { useReadContract, useChainId } from 'wagmi';
import { ponderGql, ponderQueryDefaults } from '@/utils/ponder-api';
import { universeManagerAbi } from '@loar/abis/generated';
import { UniverseManager } from '@loar/abis/addresses';

interface UniverseAddresses {
  universeAddress: `0x${string}` | undefined;
  tokenAddress: `0x${string}` | undefined;
  governorAddress: `0x${string}` | undefined;
  hookAddress: `0x${string}` | undefined;
  lockerAddress: `0x${string}` | undefined;
}

/**
 * Resolve universe contract addresses from Ponder indexer or on-chain.
 *
 * @param universeId - Either a contract address (0x...) or numeric universe ID
 */
export function useUniverseAddresses(
  universeId: string | undefined
): UniverseAddresses & { isLoading: boolean } {
  const chainId = useChainId();
  const contractAddress = UniverseManager[String(chainId) as keyof typeof UniverseManager] as
    | `0x${string}`
    | undefined;

  // Try Ponder first — works when universeId is a contract address
  const isAddress = universeId?.startsWith('0x');
  const ponder = useQuery({
    queryKey: ['universe-addresses-ponder', universeId],
    queryFn: async () => {
      const data = await ponderGql<{
        universe: {
          id: string;
          universeId: number | null;
          tokenAddress: string | null;
          governorAddress: string | null;
        } | null;
      }>(
        `query ($id: String!) {
          universe(id: $id) {
            id
            universeId
            tokenAddress
            governorAddress
          }
        }`,
        { id: universeId }
      );
      return data.universe;
    },
    enabled: !!universeId && isAddress,
    ...ponderQueryDefaults,
  });

  // Fallback: direct on-chain read when universeId is numeric
  const numericId = !isAddress && universeId ? BigInt(universeId) : undefined;
  const onChain = useReadContract({
    address: contractAddress,
    abi: universeManagerAbi,
    functionName: 'getUniverseData',
    args: numericId !== undefined ? [numericId] : undefined,
    query: {
      enabled: numericId !== undefined && !!contractAddress,
    },
    chainId,
  });

  // Merge results: Ponder data first, then on-chain fallback
  if (ponder.data) {
    return {
      universeAddress: ponder.data.id as `0x${string}`,
      tokenAddress: (ponder.data.tokenAddress as `0x${string}`) || undefined,
      governorAddress: (ponder.data.governorAddress as `0x${string}`) || undefined,
      hookAddress: undefined,
      lockerAddress: undefined,
      isLoading: false,
    };
  }

  if (onChain.data) {
    const [addr, token, governor, hook, locker] = onChain.data as readonly [
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
    ];
    const ZERO = '0x0000000000000000000000000000000000000000';
    return {
      universeAddress: addr !== ZERO ? addr : undefined,
      tokenAddress: token !== ZERO ? token : undefined,
      governorAddress: governor !== ZERO ? governor : undefined,
      hookAddress: hook !== ZERO ? hook : undefined,
      lockerAddress: locker !== ZERO ? locker : undefined,
      isLoading: false,
    };
  }

  return {
    universeAddress: isAddress ? (universeId as `0x${string}`) : undefined,
    tokenAddress: undefined,
    governorAddress: undefined,
    hookAddress: undefined,
    lockerAddress: undefined,
    isLoading: ponder.isLoading || onChain.isLoading,
  };
}
