/**
 * useThirdwebWrite — Drop-in replacements for wagmi's useWriteContract and
 * useSendTransaction that route through the thirdweb wallet adapter.
 *
 * Problem: wagmi has zero connectors configured because thirdweb manages wallet
 * connections. Wagmi's useWriteContract/useSendTransaction require an active
 * connector, so they throw "Connector not connected".
 *
 * Solution: Convert the active thirdweb account to a viem WalletClient via
 * thirdweb's viem adapter, then call writeContract/sendTransaction on it directly.
 *
 * Both hooks expose the same API shape as their wagmi counterparts so consumers
 * can switch imports without changing call sites.
 */
import { useState, useCallback } from 'react';
import { useChainId } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';
import { viemAdapter } from 'thirdweb/adapters/viem';
import { defineChain } from 'thirdweb';
import { thirdwebClient } from '@/lib/thirdweb';
import type { Abi } from 'viem';

/** Build a viem WalletClient from the active thirdweb account + current chain. */
function useWalletClient() {
  const thirdwebAccount = useActiveAccount();
  const chainId = useChainId();

  const getClient = useCallback(() => {
    if (!thirdwebAccount) throw new Error('Wallet not connected');
    return viemAdapter.walletClient.toViem({
      account: thirdwebAccount,
      client: thirdwebClient,
      chain: defineChain(chainId),
    });
  }, [thirdwebAccount, chainId]);

  return { getClient, isReady: !!thirdwebAccount };
}

// ─── useWriteContract replacement ────────────────────────────────────────────

/**
 * Drop-in replacement for wagmi's `useWriteContract`.
 *
 * Provides both `writeContract` (fire-and-forget) and `writeContractAsync` (returns hash).
 */
export function useWriteContract() {
  const { getClient } = useWalletClient();
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
      setIsPending(true);
      setError(null);
      setData(undefined);
      try {
        const walletClient = getClient();
        const txHash = await walletClient.writeContract({
          ...params,
          chain: walletClient.chain!,
          account: walletClient.account!,
        } as any);
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
    [getClient]
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
  const { getClient } = useWalletClient();
  const [data, setData] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendTransactionAsync = useCallback(
    async (params: { to: string; value?: bigint; data?: string }): Promise<`0x${string}`> => {
      setIsPending(true);
      setError(null);
      setData(undefined);
      try {
        const walletClient = getClient();
        const txHash = await walletClient.sendTransaction({
          ...params,
          chain: walletClient.chain!,
          account: walletClient.account!,
        } as any);
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
    [getClient]
  );

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setError(null);
  }, []);

  return { sendTransactionAsync, data, isPending, error, reset };
}
