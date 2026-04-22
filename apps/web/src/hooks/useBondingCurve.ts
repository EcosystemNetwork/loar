/**
 * useBondingCurve — hooks for interacting with graduated bonding curves.
 *
 * Provides state reads (price, progress, supply), previews (buy/sell estimates),
 * and write actions (buy, sell) for tokens in their bonding curve phase.
 * After graduation, the token trades on Uniswap v4 via the standard swap router.
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import { useReadContract, useChainId, usePublicClient } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { parseEther, formatEther, type Address } from 'viem';
import { useVisibilityAwareInterval, POLL_INTERVALS } from './useSmartPolling';

/**
 * Default slippage tolerance for bonding-curve trades (5%).
 * The contract's linear-price curve is deterministic per tokensSold, so
 * slippage only comes from other trades landing before ours in the same
 * block. 5% covers normal mempool churn without exposing the user to a
 * sandwich-sized loss; callers can override on a per-tx basis.
 */
export const DEFAULT_BONDING_CURVE_SLIPPAGE_BPS = 500;
export const MAX_BONDING_CURVE_SLIPPAGE_BPS = 5000; // 50% hard cap

function applySlippage(expected: bigint, slippageBps: number): bigint {
  const bps = BigInt(
    Math.min(Math.max(Math.trunc(slippageBps), 0), MAX_BONDING_CURVE_SLIPPAGE_BPS)
  );
  return (expected * (10_000n - bps)) / 10_000n;
}

// ── BondingCurve ABI (minimal) ───────────────────────────────────────

const BONDING_CURVE_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'graduate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'curveState',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '_tokensSold', type: 'uint256' },
      { name: '_ethRaised', type: 'uint256' },
      { name: '_graduated', type: 'bool' },
      { name: '_currentPrice', type: 'uint256' },
      { name: '_totalCurveSupply', type: 'uint256' },
      { name: '_graduationEth', type: 'uint256' },
    ],
  },
  {
    name: 'getProgress',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'raised', type: 'uint256' },
      { name: 'target', type: 'uint256' },
      { name: 'percentBps', type: 'uint256' },
    ],
  },
  {
    name: 'getTokensForEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'ethAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getEthForTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getCurrentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MAX_BUY_AMOUNT',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ── Types ────────────────────────────────────────────────────────────

export interface CurveState {
  tokensSold: bigint;
  ethRaised: bigint;
  graduated: boolean;
  currentPrice: bigint;
  totalCurveSupply: bigint;
  graduationEth: bigint;
}

export interface CurveProgress {
  raised: bigint;
  target: bigint;
  percentBps: bigint;
}

// ── Read hooks ───────────────────────────────────────────────────────

export function useCurveState(bondingCurveAddress: Address | undefined) {
  const pollInterval = useVisibilityAwareInterval(POLL_INTERVALS.REALTIME);
  const { data, isLoading, refetch } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'curveState',
    query: {
      enabled: !!bondingCurveAddress,
      refetchInterval: pollInterval,
    },
  });

  const state: CurveState | null = useMemo(() => {
    if (!data) return null;
    const [tokensSold, ethRaised, graduated, currentPrice, totalCurveSupply, graduationEth] = data;
    return { tokensSold, ethRaised, graduated, currentPrice, totalCurveSupply, graduationEth };
  }, [data]);

  return { state, isLoading, refetch };
}

export function useCurveProgress(bondingCurveAddress: Address | undefined) {
  const progressPollInterval = useVisibilityAwareInterval(POLL_INTERVALS.REALTIME);
  const { data, isLoading } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'getProgress',
    query: {
      enabled: !!bondingCurveAddress,
      refetchInterval: progressPollInterval,
    },
  });

  const progress: CurveProgress | null = useMemo(() => {
    if (!data) return null;
    const [raised, target, percentBps] = data;
    return { raised, target, percentBps };
  }, [data]);

  return { progress, isLoading };
}

export function usePreviewBuy(bondingCurveAddress: Address | undefined, ethAmount: string) {
  const parsedAmount = ethAmount && !isNaN(Number(ethAmount)) ? parseEther(ethAmount) : 0n;

  const { data, isLoading } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'getTokensForEth',
    args: [parsedAmount],
    query: {
      enabled: !!bondingCurveAddress && parsedAmount > 0n,
    },
  });

  return { tokensOut: data ?? 0n, isLoading };
}

export function usePreviewSell(bondingCurveAddress: Address | undefined, tokenAmount: bigint) {
  const { data, isLoading } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'getEthForTokens',
    args: [tokenAmount],
    query: {
      enabled: !!bondingCurveAddress && tokenAmount > 0n,
    },
  });

  return { ethOut: data ?? 0n, isLoading };
}

export function useMaxBuyAmount(bondingCurveAddress: Address | undefined) {
  const { data } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'MAX_BUY_AMOUNT',
    query: { enabled: !!bondingCurveAddress },
  });

  return data ?? 0n;
}

// ── Write hooks ──────────────────────────────────────────────────────

type BuyOpts = { slippageBps?: number; minTokensOut?: bigint };
type SellOpts = { slippageBps?: number; minEthOut?: bigint };

export function useBondingCurveActions(bondingCurveAddress: Address | undefined) {
  const { isConnected } = useWalletAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<'idle' | 'confirming' | 'pending' | 'success' | 'error'>(
    'idle'
  );
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  /**
   * Remembers the most recent buy/sell attempt so `retry()` can replay it
   * after a transient failure (RPC flap, gas underpricing, stale quote)
   * without the user re-typing amounts.
   */
  const lastAttemptRef = useRef<
    | { kind: 'buy'; ethAmount: string; opts: BuyOpts | number }
    | { kind: 'sell'; tokenAmount: bigint; opts: SellOpts | bigint }
    | null
  >(null);

  // Wait for inclusion so "success" means *mined*, not just *signed*.
  // Returns true on success, false on timeout/revert (caller handles status).
  const awaitReceipt = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) return true; // optimistic if no client
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 90_000,
          confirmations: 1,
        });
        return receipt.status === 'success';
      } catch {
        // Timeout or dropped tx — surface as error; user can retry.
        return false;
      }
    },
    [publicClient]
  );

  const buy = useCallback(
    async (ethAmount: string, opts: BuyOpts | number = {}) => {
      if (!bondingCurveAddress || !isConnected) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      lastAttemptRef.current = { kind: 'buy', ethAmount, opts };

      // Back-compat: earlier callers passed slippageBps as a number directly.
      const resolved: BuyOpts = typeof opts === 'number' ? { slippageBps: opts } : opts;
      const slippageBps = resolved.slippageBps ?? DEFAULT_BONDING_CURVE_SLIPPAGE_BPS;

      try {
        setStatus('confirming');
        setError(null);
        setTxHash(null);

        const value = parseEther(ethAmount);

        // Compute minTokensOut from a fresh on-chain quote so the tx aborts
        // if another trade lands between preview and execution.
        let minTokensOut = resolved.minTokensOut ?? 0n;
        if (resolved.minTokensOut === undefined) {
          if (!publicClient) {
            setError('RPC unavailable — cannot quote slippage protection');
            setStatus('error');
            return;
          }
          const expected = (await publicClient.readContract({
            address: bondingCurveAddress,
            abi: BONDING_CURVE_ABI,
            functionName: 'getTokensForEth',
            args: [value],
          })) as bigint;
          if (expected === 0n) {
            setError('Quote returned zero tokens — curve may be graduated or halted');
            setStatus('error');
            return;
          }
          minTokensOut = applySlippage(expected, slippageBps);
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

        const hash = (await writeContractAsync({
          address: bondingCurveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: 'buy',
          args: [minTokensOut, deadline],
          value,
        })) as `0x${string}`;

        setTxHash(hash);
        setStatus('pending');

        const ok = await awaitReceipt(hash);
        if (!ok) {
          setError('Transaction did not confirm in time — you can retry');
          setStatus('error');
          return hash;
        }
        setStatus('success');
        return hash;
      } catch (err: any) {
        const message = err?.shortMessage ?? err?.message ?? 'Buy failed';
        if (message.includes('User rejected') || message.includes('user rejected')) {
          setStatus('idle');
          return;
        }
        setError(message);
        setStatus('error');
      }
    },
    [bondingCurveAddress, isConnected, writeContractAsync, publicClient, awaitReceipt]
  );

  const sell = useCallback(
    async (tokenAmount: bigint, opts: SellOpts | bigint = {}) => {
      if (!bondingCurveAddress || !isConnected) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      lastAttemptRef.current = { kind: 'sell', tokenAmount, opts };

      // Back-compat: earlier callers passed minEthOut as a bigint directly.
      const resolved: SellOpts = typeof opts === 'bigint' ? { minEthOut: opts } : opts;
      const slippageBps = resolved.slippageBps ?? DEFAULT_BONDING_CURVE_SLIPPAGE_BPS;

      try {
        setStatus('confirming');
        setError(null);
        setTxHash(null);

        let minEthOut = resolved.minEthOut ?? 0n;
        if (resolved.minEthOut === undefined) {
          if (!publicClient) {
            setError('RPC unavailable — cannot quote slippage protection');
            setStatus('error');
            return;
          }
          const expected = (await publicClient.readContract({
            address: bondingCurveAddress,
            abi: BONDING_CURVE_ABI,
            functionName: 'getEthForTokens',
            args: [tokenAmount],
          })) as bigint;
          if (expected === 0n) {
            setError('Quote returned zero ETH — insufficient curve supply');
            setStatus('error');
            return;
          }
          minEthOut = applySlippage(expected, slippageBps);
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

        const hash = (await writeContractAsync({
          address: bondingCurveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: 'sell',
          args: [tokenAmount, minEthOut, deadline],
        })) as `0x${string}`;

        setTxHash(hash);
        setStatus('pending');

        const ok = await awaitReceipt(hash);
        if (!ok) {
          setError('Transaction did not confirm in time — you can retry');
          setStatus('error');
          return hash;
        }
        setStatus('success');
        return hash;
      } catch (err: any) {
        const message = err?.shortMessage ?? err?.message ?? 'Sell failed';
        if (message.includes('User rejected') || message.includes('user rejected')) {
          setStatus('idle');
          return;
        }
        setError(message);
        setStatus('error');
      }
    },
    [bondingCurveAddress, isConnected, writeContractAsync, publicClient, awaitReceipt]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
    lastAttemptRef.current = null;
  }, []);

  const retry = useCallback(async () => {
    const last = lastAttemptRef.current;
    if (!last) return;
    if (last.kind === 'buy') return buy(last.ethAmount, last.opts);
    return sell(last.tokenAmount, last.opts);
  }, [buy, sell]);

  const canRetry = status === 'error' && lastAttemptRef.current !== null;

  return { buy, sell, status, error, txHash, reset, retry, canRetry };
}

// ── Composite hook ───────────────────────────────────────────────────

export function useBondingCurve(bondingCurveAddress: Address | undefined) {
  const { state, isLoading: stateLoading, refetch } = useCurveState(bondingCurveAddress);
  const { progress, isLoading: progressLoading } = useCurveProgress(bondingCurveAddress);
  const actions = useBondingCurveActions(bondingCurveAddress);

  const isInBondingPhase = !!bondingCurveAddress && state != null && !state.graduated;

  return {
    state,
    progress,
    isInBondingPhase,
    isLoading: stateLoading || progressLoading,
    refetch,
    ...actions,
  };
}
