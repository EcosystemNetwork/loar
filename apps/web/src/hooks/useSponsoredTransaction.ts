/**
 * useSponsoredTransaction — Gas-sponsored variant of useWriteContract.
 *
 * With Circle DCW, all transactions are server-proxied. Gas sponsorship
 * is handled server-side via Circle Gas Station. This hook delegates
 * to useWriteContract and tracks whether the action was in the sponsored list.
 *
 * Returns the same interface as useWriteContract for drop-in replacement.
 */
import { useState, useCallback } from 'react';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { isSponsoredAction } from '@/lib/paymaster';
import type { Abi } from 'viem';

interface WriteContractParams {
  address: string;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  chainId?: number;
}

interface UseSponsoredTransactionReturn {
  /** Fire-and-forget: sets data/error state but doesn't throw. */
  writeContract: (params: WriteContractParams) => void;
  /** Async: returns tx hash or throws. */
  writeContractAsync: (params: WriteContractParams) => Promise<`0x${string}`>;
  /** The transaction hash from the last successful write. */
  data: `0x${string}` | undefined;
  /** Whether a transaction is in flight. */
  isPending: boolean;
  /** Error from the last failed write. */
  error: Error | null;
  /** Whether the last transaction was gas-sponsored. */
  wasSponsored: boolean;
  /** Reset state. */
  reset: () => void;
}

/**
 * Drop-in replacement for `useWriteContract` with sponsorship tracking.
 *
 * With Circle DCW, gas sponsorship is handled server-side.
 * The server determines whether to sponsor based on the action name.
 * This hook tracks the sponsorship status for UI display.
 */
export function useSponsoredTransaction(): UseSponsoredTransactionReturn {
  const {
    writeContractAsync: baseWriteAsync,
    data,
    isPending,
    error,
    reset: baseReset,
  } = useWriteContract();
  const [wasSponsored, setWasSponsored] = useState(false);

  const writeContractAsync = useCallback(
    async (params: WriteContractParams): Promise<`0x${string}`> => {
      setWasSponsored(false);
      const hash = await baseWriteAsync(params);
      // Track whether this was a sponsored action
      setWasSponsored(isSponsoredAction(params.functionName));
      return hash;
    },
    [baseWriteAsync]
  );

  const writeContract = useCallback(
    (params: WriteContractParams) => {
      writeContractAsync(params).catch(() => {
        /* error captured in state */
      });
    },
    [writeContractAsync]
  );

  const reset = useCallback(() => {
    baseReset();
    setWasSponsored(false);
  }, [baseReset]);

  return { writeContract, writeContractAsync, data, isPending, error, wasSponsored, reset };
}
