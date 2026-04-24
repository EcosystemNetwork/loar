/**
 * useIsUniverseAdmin — check if connected wallet is a universe admin
 *
 * Resolves admin status via the server (`universes.adminInfo` tRPC query)
 * rather than the wallet's RPC provider. The server reads Firestore for the
 * universe record and calls `getOwners()` on its own RPC endpoint for
 * multi-sig universes. This avoids the "Couldn't verify editor access"
 * flash that happens when the user's wallet provider rate-limits or the
 * wallet is on a different chain than the universe was deployed on.
 *
 * Recognises both:
 *   - Direct EOA admin (Firestore `creator`)
 *   - Safe multi-sig signer (address is in the Safe's owners)
 */
import { useQuery } from '@tanstack/react-query';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { trpc } from '@/utils/trpc';

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
  /** True when the admin lookup itself failed — caller should not bounce the
   *  user out of admin UI in that case (could be a flaky RPC, not a real
   *  permission denial). */
  isError: boolean;
}

export function useIsUniverseAdmin(universeAddress: `0x${string}` | undefined): UniverseAdminInfo {
  const { address: connectedAddress } = useAccount();

  const { data, isLoading, isError } = useQuery(
    trpc.universes.adminInfo.queryOptions(
      {
        universeId: universeAddress ?? '0x',
        address: connectedAddress,
      },
      {
        enabled: !!universeAddress,
        staleTime: 30_000,
        retry: 2,
      }
    )
  );

  return {
    isAdmin: data?.isAdmin ?? false,
    isSafe: data?.isSafe ?? false,
    adminAddress: data?.adminAddress,
    safeAddress: data?.safeAddress,
    owners: data?.owners ?? [],
    threshold: data?.threshold ?? 0,
    isLoading,
    isError,
  };
}
