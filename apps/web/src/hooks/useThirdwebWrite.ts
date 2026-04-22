/**
 * useWriteContract / useSendTransaction — Server-proxied via Circle DCW
 *
 * All contract writes are proxied through POST /api/tx/write on the server.
 * The server signs and broadcasts via Circle's KMS — no client-side keys needed.
 *
 * These hooks expose the same API shape as their wagmi counterparts
 * so consumers can keep the same call sites.
 */
import { useState, useCallback } from 'react';
import { useChainId } from 'wagmi';
import { encodeFunctionData, type Abi } from 'viem';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

// ─── useWriteContract replacement ────────────────────────────────────────────

/**
 * Drop-in replacement for wagmi's `useWriteContract`.
 *
 * Routes contract calls through the LOAR server → Circle KMS.
 * Provides both `writeContract` (fire-and-forget) and `writeContractAsync` (returns hash).
 */
export function useWriteContract() {
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
      setIsPending(true);
      setError(null);
      setData(undefined);
      try {
        const res = await fetch(`${SERVER_URL}/api/tx/write`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args ? Array.from(params.args) : [],
            value: params.value?.toString(),
            chainId: params.chainId ?? chainId,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Transaction failed' }));
          throw new Error(errData.error || `Transaction failed (${res.status})`);
        }

        const result = await res.json();
        const txHash = result.txHash as `0x${string}`;
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
    [chainId]
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
 * Routes raw transactions through the LOAR server → Circle KMS.
 */
export function useSendTransaction() {
  const chainId = useChainId();
  const [data, setData] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendTransactionAsync = useCallback(
    async (params: { to: string; value?: bigint; data?: string }): Promise<`0x${string}`> => {
      setIsPending(true);
      setError(null);
      setData(undefined);
      try {
        const res = await fetch(`${SERVER_URL}/api/tx/write`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: params.to,
            // Raw send: forward pre-encoded calldata as `data` (empty if the
            // tx is a plain value transfer with no call).
            data: params.data ?? '0x',
            value: params.value?.toString(),
            chainId,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Transaction failed' }));
          throw new Error(errData.error || `Transaction failed (${res.status})`);
        }

        const result = await res.json();
        const txHash = result.txHash as `0x${string}`;
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
    [chainId]
  );

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setError(null);
  }, []);

  return { sendTransactionAsync, data, isPending, error, reset };
}
