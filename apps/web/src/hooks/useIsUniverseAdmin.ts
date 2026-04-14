/**
 * useIsUniverseAdmin — check if connected wallet is a universe admin
 *
 * Handles both:
 *   - Direct EOA admin (address === getAdmin())
 *   - Safe multi-sig signer (address in Safe.getOwners())
 *
 * Returns admin status, whether admin is a Safe, and Safe metadata.
 */
import { usePublicClient, useReadContract, useChainId } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useQuery } from '@tanstack/react-query';
import { universeAbi } from '@loar/abis/generated';

const SAFE_OWNERS_ABI = [
  {
    name: 'getOwners',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getThreshold',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export interface UniverseAdminInfo {
  /** Whether the connected wallet has admin access */
  isAdmin: boolean;
  /** Whether the admin is a Safe multi-sig wallet */
  isSafe: boolean;
  /** The admin address (EOA or Safe) */
  adminAddress: string | undefined;
  /** Safe address if multi-sig, undefined otherwise */
  safeAddress: string | undefined;
  /** Safe owners if multi-sig */
  owners: string[];
  /** Safe threshold if multi-sig */
  threshold: number;
  /** Loading state */
  isLoading: boolean;
}

export function useIsUniverseAdmin(universeAddress: `0x${string}` | undefined): UniverseAdminInfo {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient();
  const chainId = useChainId();

  // Read the on-chain admin address
  const { data: adminAddress, isLoading: isLoadingAdmin } = useReadContract({
    address: universeAddress,
    abi: universeAbi,
    functionName: 'getAdmin',
    query: { enabled: !!universeAddress },
    chainId,
  });

  // Check if admin is a contract (Safe) and get owners
  const { data: safeData, isLoading: isLoadingSafe } = useQuery({
    queryKey: ['safe-admin-check', adminAddress, connectedAddress, chainId],
    queryFn: async () => {
      if (!adminAddress || !connectedAddress || !publicClient) {
        return { isSafe: false, owners: [] as string[], threshold: 0 };
      }

      // If direct match, no need to check Safe
      if (adminAddress.toLowerCase() === connectedAddress.toLowerCase()) {
        return { isSafe: false, owners: [], threshold: 0 };
      }

      // Check if admin address has bytecode (i.e., is a contract)
      const bytecode = await publicClient.getCode({ address: adminAddress as `0x${string}` });
      if (!bytecode || bytecode === '0x') {
        return { isSafe: false, owners: [], threshold: 0 };
      }

      // Try reading Safe owners — if it fails, it's not a Safe
      try {
        const [owners, threshold] = await Promise.all([
          publicClient.readContract({
            address: adminAddress as `0x${string}`,
            abi: SAFE_OWNERS_ABI,
            functionName: 'getOwners',
          }),
          publicClient.readContract({
            address: adminAddress as `0x${string}`,
            abi: SAFE_OWNERS_ABI,
            functionName: 'getThreshold',
          }),
        ]);

        return {
          isSafe: true,
          owners: owners.map((o) => o.toLowerCase()),
          threshold: Number(threshold),
        };
      } catch {
        // Not a Safe contract
        return { isSafe: false, owners: [], threshold: 0 };
      }
    },
    enabled: !!adminAddress && !!connectedAddress && !!publicClient,
    staleTime: 60_000,
  });

  const isSafe = safeData?.isSafe ?? false;
  const owners = safeData?.owners ?? [];
  const threshold = safeData?.threshold ?? 0;

  const isDirectAdmin =
    !!connectedAddress &&
    !!adminAddress &&
    adminAddress.toLowerCase() === connectedAddress.toLowerCase();

  const isSafeSigner =
    isSafe && !!connectedAddress && owners.includes(connectedAddress.toLowerCase());

  return {
    isAdmin: isDirectAdmin || isSafeSigner,
    isSafe,
    adminAddress: adminAddress as string | undefined,
    safeAddress: isSafe ? (adminAddress as string) : undefined,
    owners,
    threshold,
    isLoading: isLoadingAdmin || isLoadingSafe,
  };
}
