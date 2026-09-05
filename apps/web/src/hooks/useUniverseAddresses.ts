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
import { trpcClient } from '@/utils/trpc';
import { asEvmAddressOrUndefined } from '@/lib/utils';

interface UniverseAddresses {
  universeAddress: `0x${string}` | undefined;
  tokenAddress: `0x${string}` | undefined;
  governorAddress: `0x${string}` | undefined;
  hookAddress: `0x${string}` | undefined;
  lockerAddress: `0x${string}` | undefined;
  bondingCurveAddress: `0x${string}` | undefined;
}

/**
 * Resolve universe contract addresses from Ponder indexer, on-chain, or the
 * universe's own Firestore doc.
 *
 * @param universeId - A contract address (0x...), a numeric universe ID, or
 *   a human-readable slug (most universes are addressed this way — resolved
 *   via `universes.get`, same as `/universe/$id`).
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

  // Fallback: direct on-chain read when universeId is a plain base-10 numeric
  // string. Guard this explicitly — most universes are actually addressed by
  // a human-readable Firestore slug (e.g. "sample-universe"), which is
  // neither a `0x…` address nor numeric; passing one to BigInt() throws an
  // uncaught SyntaxError straight out of this hook (#audit finding 1).
  const isNumeric = !isAddress && !!universeId && /^\d+$/.test(universeId);
  const numericId = isNumeric ? BigInt(universeId as string) : undefined;
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

  // Fallback: resolve a slug id (neither address nor numeric) via the
  // universe's own Firestore doc, which already stores its on-chain
  // addresses — the same fields `/universe/$id` reads directly.
  const bySlug = useQuery({
    queryKey: ['universe-addresses-slug', universeId],
    queryFn: async () => {
      const res = await trpcClient.universes.get.query({ id: universeId as string });
      return (res as { data?: Record<string, unknown> } | null)?.data ?? null;
    },
    enabled: !!universeId && !isAddress && !isNumeric,
  });

  // Merge results: Ponder data first, then on-chain fallback, then slug lookup
  if (ponder.data) {
    return {
      universeAddress: ponder.data.id as `0x${string}`,
      tokenAddress: (ponder.data.tokenAddress as `0x${string}`) || undefined,
      governorAddress: (ponder.data.governorAddress as `0x${string}`) || undefined,
      hookAddress: undefined,
      lockerAddress: undefined,
      bondingCurveAddress: undefined,
      isLoading: false,
    };
  }

  if (onChain.data) {
    const [addr, token, governor, hook, locker, bondingCurve] = onChain.data as readonly [
      `0x${string}`,
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
      bondingCurveAddress: bondingCurve !== ZERO ? bondingCurve : undefined,
      isLoading: false,
    };
  }

  if (bySlug.data) {
    const d = bySlug.data as {
      address?: string;
      tokenAddress?: string;
      governanceAddress?: string;
    };
    // A Solana universe's Firestore doc stores its SPL mint / governance
    // addresses as base58, not hex — passing one straight into a
    // `0x${string}`-typed field feeds it to wagmi's `useReadContract`
    // (e.g. TokenGateGuard), and viem's address checksum throws
    // `InvalidAddressError` synchronously during render, crashing the page.
    // Only surface fields that are actually EVM addresses; everything else
    // resolves to `undefined` so those reads stay disabled.
    return {
      universeAddress: asEvmAddressOrUndefined(d.address),
      tokenAddress: asEvmAddressOrUndefined(d.tokenAddress),
      governorAddress: asEvmAddressOrUndefined(d.governanceAddress),
      hookAddress: undefined,
      lockerAddress: undefined,
      bondingCurveAddress: undefined,
      isLoading: false,
    };
  }

  return {
    universeAddress: isAddress ? (universeId as `0x${string}`) : undefined,
    tokenAddress: undefined,
    governorAddress: undefined,
    hookAddress: undefined,
    lockerAddress: undefined,
    bondingCurveAddress: undefined,
    isLoading: ponder.isLoading || onChain.isLoading || bySlug.isLoading,
  };
}
