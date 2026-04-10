/**
 * useSafeAdminAction — routes admin contract calls through Safe when needed
 *
 * When the universe admin is a Safe multi-sig, this encodes the calldata
 * and submits it as a Safe transaction proposal instead of executing directly.
 * For EOA admins, it falls through to normal writeContract.
 */
import { useCallback } from 'react';
import { encodeFunctionData, type Abi } from 'viem';
import { useWriteContract } from 'wagmi';
import { useIsUniverseAdmin } from './useIsUniverseAdmin';
import { useSafe } from './useSafe';

export function useSafeAdminAction(universeAddress: `0x${string}` | undefined) {
  const { isSafe, safeAddress } = useIsUniverseAdmin(universeAddress);
  const { proposeTransaction, isLoading: isSafeLoading } = useSafe();
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();

  /**
   * Execute an admin-gated contract call.
   *
   * If the admin is a Safe, proposes the tx via Safe TX Service.
   * Otherwise, executes directly via writeContract.
   */
  const executeAdminAction = useCallback(
    async (params: {
      address: `0x${string}`;
      abi: Abi;
      functionName: string;
      args: any[];
      value?: bigint;
    }): Promise<{ type: 'direct' | 'proposed'; hash?: string; safeTxHash?: string }> => {
      if (isSafe && safeAddress) {
        const data = encodeFunctionData({
          abi: params.abi,
          functionName: params.functionName,
          args: params.args,
        } as any);

        const safeTxHash = await proposeTransaction(safeAddress, {
          to: params.address,
          data,
          value: params.value?.toString(),
        });

        return { type: 'proposed', safeTxHash };
      }

      const hash = await writeContractAsync({
        address: params.address,
        abi: params.abi as any,
        functionName: params.functionName as any,
        args: params.args as any,
        value: params.value,
      });

      return { type: 'direct', hash };
    },
    [isSafe, safeAddress, proposeTransaction, writeContractAsync]
  );

  return {
    executeAdminAction,
    isSafe,
    isLoading: isSafeLoading || isWritePending,
  };
}
