/**
 * useSwapExecution — Execute token swaps on-chain via the LoarSwapRouter.
 *
 * When the swap router is deployed, executes trades natively in-app.
 * Falls back to Uniswap deep link when router is not available.
 */
import { useState, useCallback } from 'react';
import { useChainId, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { useWriteContract } from '@/hooks/useCircleWrite';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { parseEther, formatEther, type Address, maxUint256 } from 'viem';
import { getSwapUrl } from '@/hooks/useTokenSwap';
import { openExternal } from '@/utils/open-external';
import { confirmTx } from '@/components/tx-confirm';

function swapChainName(id: number | undefined): string {
  switch (id) {
    case 11155111:
      return 'Sepolia';
    case 1:
      return 'Ethereum';
    default:
      return id ? `Chain ${id}` : 'Unknown chain';
  }
}

// Minimal ERC20 subset for allowance + approve (used for native sell)
const ERC20_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

// LoarSwapRouter ABI (minimal — just the swap functions we need)
const SWAP_ROUTER_ABI = [
  {
    name: 'swapExactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'deadline', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: 'delta', type: 'int256' }],
  },
] as const;

// Swap router addresses per chain (null = not deployed → fallback to Uniswap link)
const SWAP_ROUTER_ADDRESSES: Record<number, Address | null> = {
  11155111: '0x7E156f3Ddd56539aB941DeEfEd1342ae5C9C09a5', // Sepolia
  1: null, // Ethereum mainnet — deploy before mainnet launch
};

// Uniswap v4 V4Quoter per chain. Quotes by simulating the real swap through
// the PoolManager (hooks + dynamic fees included), so it works for pools the
// indexer has never seen a trade on.
const V4_QUOTER_ADDRESSES: Record<number, Address | null> = {
  11155111: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227', // Sepolia
  1: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203', // Ethereum mainnet
};

const V4_QUOTER_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/**
 * On-chain exact-input quote from the v4 quoter. Returns `amountOut` in wei,
 * `null` while there's nothing to quote, or `isError` when the quoter reverts
 * (e.g. the pool has no liquidity).
 */
export function usePoolQuote({
  poolKey,
  zeroForOne,
  amountInWei,
}: {
  poolKey: PoolKey | null;
  zeroForOne: boolean;
  amountInWei: bigint | null;
}) {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const quoter = V4_QUOTER_ADDRESSES[chainId] ?? null;
  const enabled = !!quoter && !!publicClient && !!poolKey && !!amountInWei && amountInWei > 0n;

  const query = useQuery({
    queryKey: [
      'v4-quote',
      chainId,
      poolKey?.currency0,
      poolKey?.currency1,
      poolKey?.fee,
      poolKey?.tickSpacing,
      poolKey?.hooks,
      zeroForOne,
      amountInWei?.toString(),
    ],
    queryFn: async () => {
      const { result } = await publicClient!.simulateContract({
        address: quoter!,
        abi: V4_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{ poolKey: poolKey!, zeroForOne, exactAmount: amountInWei!, hookData: '0x' }],
      });
      return result[0];
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  return {
    amountOut: enabled ? (query.data ?? null) : null,
    isLoading: enabled && query.isLoading,
    isError: enabled && query.isError,
    isAvailable: !!quoter,
  };
}

export interface SwapConfig {
  tokenAddress: string;
  tokenSymbol: string;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  } | null;
  mode: 'buy' | 'sell';
  amount: string; // ETH for buy, tokens for sell
  slippageBps?: number; // default 100 = 1%
  // Expected output in wei (tokens for buy, ETH for sell). Required for on-chain
  // slippage protection — without it, amountOutMinimum defaults to 0 (unsafe).
  expectedOutWei?: bigint;
}

const NATIVE_ETH: Address = '0x0000000000000000000000000000000000000000';

// Graduated bonding-curve pools pair the token with WETH (LoarHook rejects
// native-ETH pools), so in-app trades wrap/unwrap around the swap.
const WETH_ADDRESSES: Record<number, Address> = {
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
};

const WETH_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export type SwapStatus =
  | 'idle'
  | 'approving'
  | 'approval-pending'
  | 'confirming'
  | 'pending'
  | 'success'
  | 'error';

export function useSwapExecution() {
  const chainId = useChainId();
  const { address } = useWalletAccount();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<SwapStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  const routerAddress = SWAP_ROUTER_ADDRESSES[chainId] ?? null;
  const isNativeSwapAvailable = routerAddress !== null;

  const executeSwap = useCallback(
    async (config: SwapConfig) => {
      setError(null);
      setTxHash(null);

      // If no router deployed, fallback to Uniswap link
      if (!routerAddress || !config.poolKey) {
        const swapUrl = getSwapUrl(config.tokenAddress, chainId);
        const amount = config.amount;
        if (config.mode === 'buy') {
          openExternal(`${swapUrl}${amount ? `&exactAmount=${amount}&exactField=input` : ''}`);
        } else {
          const sellUrl = swapUrl
            .replace(
              'inputCurrency=ETH&outputCurrency=',
              `inputCurrency=${config.tokenAddress}&outputCurrency=`
            )
            .replace(`outputCurrency=${config.tokenAddress}`, 'outputCurrency=ETH');
          openExternal(`${sellUrl}${amount ? `&exactAmount=${amount}&exactField=input` : ''}`);
        }
        return { fallback: true };
      }

      if (!address) {
        setError('Wallet not connected');
        setStatus('error');
        return { fallback: false, error: 'Wallet not connected' };
      }

      try {
        setStatus('confirming');

        const slippageBps = config.slippageBps ?? 100; // 1% default
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

        if (config.mode === 'buy') {
          // Buy tokens with ETH
          const amountIn = parseEther(config.amount);

          // zeroForOne: true if input currency sorts lower (i.e. is currency0).
          // For native-ETH pools, Currency.wrap(address(0)) sorts lowest so ETH is
          // always currency0 — but we check explicitly to support any ordering.
          const weth = WETH_ADDRESSES[chainId];
          const isCurrency = (c: Address, want: Address | undefined) =>
            !!want && c.toLowerCase() === want.toLowerCase();
          const nativeInput =
            isCurrency(config.poolKey.currency0, NATIVE_ETH) ||
            isCurrency(config.poolKey.currency1, NATIVE_ETH);
          const wethInput =
            !nativeInput &&
            (isCurrency(config.poolKey.currency0, weth) ||
              isCurrency(config.poolKey.currency1, weth));
          if (!nativeInput && !wethInput) {
            setError('Pool is not paired with ETH or WETH');
            setStatus('error');
            return { fallback: false, error: 'Pool missing ETH pairing' };
          }
          const zeroForOne =
            isCurrency(config.poolKey.currency0, NATIVE_ETH) ||
            (wethInput && isCurrency(config.poolKey.currency0, weth));

          // Enforce slippage on-chain. Without expectedOutWei we cannot compute a
          // safe min-out, so we refuse to swap rather than accept 0.
          if (config.expectedOutWei === undefined) {
            setError('Missing expected output — cannot enforce slippage');
            setStatus('error');
            return { fallback: false, error: 'Missing slippage bound' };
          }
          const bps = BigInt(slippageBps);
          const amountOutMinimum = (config.expectedOutWei * (10_000n - bps)) / 10_000n;

          const approved = await confirmTx({
            title: 'Swap ETH → token',
            description: 'Spot swap via LoarSwapRouter. Slippage-protected.',
            chainName: swapChainName(chainId),
            functionName: 'swapExactInput',
            to: routerAddress,
            valueEth: formatEther(amountIn),
            summary: [
              ['Min out', amountOutMinimum.toString()],
              ['Slippage max', `${slippageBps / 100}%`],
            ],
            confirmLabel: 'Confirm swap',
          });
          if (!approved) {
            setStatus('idle');
            return { fallback: false, error: undefined };
          }

          // WETH pool: wrap the ETH and let the router pull it.
          if (wethInput) {
            if (!publicClient) throw new Error('RPC client unavailable');
            const wrapHash = await writeContractAsync({
              address: weth,
              abi: WETH_ABI,
              functionName: 'deposit',
              value: amountIn,
              chainId,
            });
            await publicClient.waitForTransactionReceipt({ hash: wrapHash as `0x${string}` });
            const wethAllowance = (await publicClient.readContract({
              address: weth,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [address, routerAddress],
            })) as bigint;
            if (wethAllowance < amountIn) {
              setStatus('approving');
              const approveHash = await writeContractAsync({
                address: weth,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [routerAddress, maxUint256],
                chainId,
              });
              setStatus('approval-pending');
              await publicClient.waitForTransactionReceipt({
                hash: approveHash as `0x${string}`,
              });
            }
            setStatus('confirming');
          }

          const hash = await writeContractAsync({
            address: routerAddress,
            abi: SWAP_ROUTER_ABI,
            functionName: 'swapExactInput',
            args: [
              config.poolKey,
              zeroForOne,
              amountIn,
              amountOutMinimum,
              deadline,
              '0x', // hookData
            ],
            value: wethInput ? 0n : amountIn,
            chainId,
          });

          setTxHash(hash);
          setStatus('pending');
          return { fallback: false, txHash: hash };
        } else {
          // Sell tokens for ETH — native flow: ensure ERC20 allowance, then swap.
          if (!publicClient) {
            setError('RPC client unavailable');
            setStatus('error');
            return { fallback: false, error: 'RPC client unavailable' };
          }

          const amountIn = parseEther(config.amount);
          const tokenAddr = config.tokenAddress as Address;

          // Determine direction: selling the token means input = token, output = ETH.
          // zeroForOne = input currency is currency0.
          const tokenIsCurrency0 =
            config.poolKey.currency0.toLowerCase() === tokenAddr.toLowerCase();
          const tokenIsCurrency1 =
            config.poolKey.currency1.toLowerCase() === tokenAddr.toLowerCase();
          if (!tokenIsCurrency0 && !tokenIsCurrency1) {
            setError('Pool does not include this token');
            setStatus('error');
            return { fallback: false, error: 'Token not in pool' };
          }
          const zeroForOne = tokenIsCurrency0;

          if (config.expectedOutWei === undefined) {
            setError('Missing expected output — cannot enforce slippage');
            setStatus('error');
            return { fallback: false, error: 'Missing slippage bound' };
          }
          const bps = BigInt(slippageBps);
          const amountOutMinimum = (config.expectedOutWei * (10_000n - bps)) / 10_000n;

          // 1) Allowance check. If < amountIn, approve max first.
          const allowance = (await publicClient.readContract({
            address: tokenAddr,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [address, routerAddress],
          })) as bigint;

          if (allowance < amountIn) {
            const approveOk = await confirmTx({
              title: 'Approve token for swap router',
              description:
                'Unlimited (maxUint256) approval so future sells do not require a fresh approval.',
              chainName: swapChainName(chainId),
              functionName: 'approve',
              to: tokenAddr,
              summary: [
                ['Spender', routerAddress],
                ['Amount', 'unlimited'],
              ],
              confirmLabel: 'Approve',
            });
            if (!approveOk) {
              setStatus('idle');
              return { fallback: false, error: undefined };
            }
            setStatus('approving');
            const approveHash = await writeContractAsync({
              address: tokenAddr,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [routerAddress, maxUint256],
              chainId,
            });
            setStatus('approval-pending');
            await publicClient.waitForTransactionReceipt({
              hash: approveHash as `0x${string}`,
            });
          }

          // 2) Swap.
          const swapOk = await confirmTx({
            title: 'Swap token → ETH',
            description: 'Spot swap via LoarSwapRouter. Slippage-protected.',
            chainName: swapChainName(chainId),
            functionName: 'swapExactInput',
            to: routerAddress,
            summary: [
              ['Token in', tokenAddr],
              ['Amount in', amountIn.toString()],
              ['Min ETH out', `${formatEther(amountOutMinimum)} ETH`],
              ['Slippage max', `${slippageBps / 100}%`],
            ],
            confirmLabel: 'Confirm swap',
          });
          if (!swapOk) {
            setStatus('idle');
            return { fallback: false, error: undefined };
          }
          setStatus('confirming');
          const weth = WETH_ADDRESSES[chainId];
          const outputCurrency = zeroForOne ? config.poolKey.currency1 : config.poolKey.currency0;
          const wethOutput = !!weth && outputCurrency.toLowerCase() === weth.toLowerCase();
          const wethBefore = wethOutput
            ? ((await publicClient.readContract({
                address: weth,
                abi: WETH_ABI,
                functionName: 'balanceOf',
                args: [address],
              })) as bigint)
            : 0n;
          const hash = await writeContractAsync({
            address: routerAddress,
            abi: SWAP_ROUTER_ABI,
            functionName: 'swapExactInput',
            args: [
              config.poolKey,
              zeroForOne,
              amountIn,
              amountOutMinimum,
              deadline,
              '0x', // hookData
            ],
            chainId,
          });

          setTxHash(hash);
          setStatus('pending');

          // WETH pool: unwrap what the swap paid out so the seller gets ETH.
          if (wethOutput) {
            await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
            const wethAfter = (await publicClient.readContract({
              address: weth,
              abi: WETH_ABI,
              functionName: 'balanceOf',
              args: [address],
            })) as bigint;
            const received = wethAfter - wethBefore;
            if (received > 0n) {
              await writeContractAsync({
                address: weth,
                abi: WETH_ABI,
                functionName: 'withdraw',
                args: [received],
                chainId,
              });
            }
          }
          return { fallback: false, txHash: hash };
        }
      } catch (err: any) {
        // Distinguish user rejection from real errors
        const message = err?.shortMessage ?? err?.message ?? 'Swap failed';
        if (message.includes('User rejected') || message.includes('user rejected')) {
          setStatus('idle');
          return { fallback: false, error: undefined };
        }
        const msg = message.includes('insufficient funds')
          ? 'Insufficient balance for this swap'
          : message.includes('exceeds balance')
            ? 'Token balance too low'
            : message;
        setError(msg);
        setStatus('error');
        return { fallback: false, error: msg };
      }
    },
    [routerAddress, chainId, address, writeContractAsync, publicClient]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
  }, []);

  return {
    executeSwap,
    reset,
    status,
    txHash,
    error,
    isNativeSwapAvailable,
    routerAddress,
  };
}
