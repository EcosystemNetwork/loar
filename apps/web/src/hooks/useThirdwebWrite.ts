/**
 * useThirdwebWrite — Drop-in replacements for wagmi's useWriteContract and
 * useSendTransaction that route through thirdweb's native transaction pipeline.
 *
 * Problem: wagmi has zero connectors configured because thirdweb manages wallet
 * connections. Wagmi's useWriteContract/useSendTransaction require an active
 * connector, so they throw "Connector not connected".
 *
 * Solution: Use thirdweb's native `prepareTransaction` + `sendTransaction`
 * which properly signs via the thirdweb account (in-app or external wallet)
 * and sends via `eth_sendRawTransaction`. The previous viem adapter approach
 * tried `eth_sendTransaction` against public RPCs which don't support it.
 *
 * Both hooks expose the same API shape as their wagmi counterparts so consumers
 * can switch imports without changing call sites.
 */
import { useState, useCallback } from 'react';
import { useChainId } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';
import { defineChain, prepareTransaction, sendTransaction } from 'thirdweb';
import { thirdwebClient } from '@/lib/thirdweb';
import { encodeFunctionData, type Abi } from 'viem';

// ─── useWriteContract replacement ────────────────────────────────────────────

/**
 * Drop-in replacement for wagmi's `useWriteContract`.
 *
 * Provides both `writeContract` (fire-and-forget) and `writeContractAsync` (returns hash).
 */
export function useWriteContract() {
  const thirdwebAccount = useActiveAccount();
  const chainId = useChainId();
  const [data, setData] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const writeContractAsync = useCallback(
    async (params: {
      address: string;
      abi: Abi | readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
      chainId?: number;
    }): Promise<`0x${string}`> => {
      if (!thirdwebAccount) throw new Error('Wallet not connected');
      setIsPending(true);
      setError(null);
      setData(undefined);
      try {
        const calldata = encodeFunctionData({
          abi: params.abi as Abi,
          functionName: params.functionName,
          args: (params.args as any[]) ?? [],
        });

        const tx = prepareTransaction({
          client: thirdwebClient,
          chain: defineChain(params.chainId ?? chainId),
          to: params.address as `0x${string}`,
          data: calldata,
          value: params.value,
        });

        const result = await sendTransaction({ transaction: tx, account: thirdwebAccount });
        const txHash = result.transactionHash;
        setData(txHash);
        return txHash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [thirdwebAccount, chainId]
  );

  /** Fire-and-forget variant — sets `data`/`error` state but doesn't throw. */
  const writeContract = useCallback(
    (params: {
      address: string;
      abi: Abi | readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
      chainId?: number;
    }) => {
      writeContractAsync(params).catch(() => {
        /* error is captured in state */
      });
    },
    [writeContractAsync]
  );

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setError(null);
  }, []);

  return { writeContract, writeContractAsync, data, isPending, error, reset };
}

// ─── useSendTransaction replacement ──────────────────────────────────────────

/**
 * Drop-in replacement for wagmi's `useSendTransaction`.
 *
 * Provides `sendTransactionAsync` (returns hash).
 */
export function useSendTransaction() {
  const thirdwebAccount = useActiveAccount();
  const chainId = useChainId();
  const [data, setData] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendTransactionAsync = useCallback(
    async (params: { to: string; value?: bigint; data?: string }): Promise<`0x${string}`> => {
      if (!thirdwebAccount) throw new Error('Wallet not connected');
      setIsPending(true);
      setError(null);
      setData(undefined);
      try {
        const tx = prepareTransaction({
          client: thirdwebClient,
          chain: defineChain(chainId),
          to: params.to as `0x${string}`,
          value: params.value,
          data: params.data as `0x${string}` | undefined,
        });

        const result = await sendTransaction({ transaction: tx, account: thirdwebAccount });
        const txHash = result.transactionHash;
        setData(txHash);
        return txHash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [thirdwebAccount, chainId]
  );

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setError(null);
  }, []);

  return { sendTransactionAsync, data, isPending, error, reset };
}
