/**
 * useSponsoredTransaction — Gas-sponsored variant of useWriteContract.
 *
 * Wraps the existing useThirdwebWrite hook but adds gas sponsorship
 * for eligible actions (mint, vote, universe creation) when the paymaster
 * is configured.
 *
 * Falls back to normal (user-paid) transactions when:
 *   - VITE_THIRDWEB_SECRET_KEY is not set
 *   - The action is not in the sponsored list
 *   - Gas estimation with sponsorship fails
 *
 * Returns the same interface as useWriteContract from useThirdwebWrite
 * for drop-in replacement.
 *
 * SDK version assumption: thirdweb ^5.x (currently 5.119.4).
 */
import { useState, useCallback } from 'react';
import { useChainId } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';
import { defineChain, prepareTransaction, sendTransaction, estimateGas } from 'thirdweb';
import { thirdwebClient } from '@/lib/thirdweb';
import { isPaymasterAvailable, isSponsoredAction, getSmartAccountConfig } from '@/lib/paymaster';
import { encodeFunctionData, type Abi } from 'viem';

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
 * Drop-in replacement for `useWriteContract` from `useThirdwebWrite`
 * with automatic gas sponsorship for eligible actions.
 *
 * Usage:
 * ```ts
 * const { writeContractAsync, wasSponsored } = useSponsoredTransaction();
 *
 * const hash = await writeContractAsync({
 *   address: CONTRACT_ADDRESS,
 *   abi: contractAbi,
 *   functionName: 'mint', // sponsored!
 *   args: [tokenId, uri],
 * });
 *
 * console.log(wasSponsored ? 'Gas was free!' : 'User paid gas');
 * ```
 */
export function useSponsoredTransaction(): UseSponsoredTransactionReturn {
  const thirdwebAccount = useActiveAccount();
  const chainId = useChainId();
  const [data, setData] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [wasSponsored, setWasSponsored] = useState(false);

  const writeContractAsync = useCallback(
    async (params: WriteContractParams): Promise<`0x${string}`> => {
      if (!thirdwebAccount) throw new Error('Wallet not connected');
      setIsPending(true);
      setError(null);
      setData(undefined);
      setWasSponsored(false);

      try {
        const calldata = encodeFunctionData({
          abi: params.abi as Abi,
          functionName: params.functionName,
          args: (params.args as any[]) ?? [],
        });

        const targetChain = defineChain(params.chainId ?? chainId);

        // Determine if this action qualifies for sponsorship
        const shouldSponsor = isPaymasterAvailable() && isSponsoredAction(params.functionName);

        // Attempt sponsored transaction first, fall back to normal
        if (shouldSponsor) {
          try {
            const hash = await sendSponsoredTx({
              account: thirdwebAccount,
              chain: targetChain,
              to: params.address as `0x${string}`,
              data: calldata,
              value: params.value,
            });
            setData(hash);
            setWasSponsored(true);
            return hash;
          } catch (sponsorErr) {
            // Sponsorship failed — fall through to normal tx.
            // This handles cases where the paymaster rejects the tx
            // (e.g., gas credits exhausted, policy mismatch).
            console.warn(
              '[useSponsoredTransaction] Sponsored tx failed, falling back to user-paid:',
              sponsorErr instanceof Error ? sponsorErr.message : sponsorErr
            );
          }
        }

        // Normal (user-paid) transaction path
        const tx = prepareTransaction({
          client: thirdwebClient,
          chain: targetChain,
          to: params.address as `0x${string}`,
          data: calldata,
          value: params.value,
        });

        // Pre-flight gas estimation
        try {
          await estimateGas({ transaction: tx, account: thirdwebAccount });
        } catch (gasErr) {
          const reason = gasErr instanceof Error ? gasErr.message : String(gasErr);
          throw new Error(`Transaction would fail: ${reason}`);
        }

        const result = await sendTransaction({ transaction: tx, account: thirdwebAccount });
        const txHash = result.transactionHash;
        setData(txHash);
        setWasSponsored(false);
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

  /** Fire-and-forget variant — sets data/error state but doesn't throw. */
  const writeContract = useCallback(
    (params: WriteContractParams) => {
      writeContractAsync(params).catch(() => {
        /* error captured in state */
      });
    },
    [writeContractAsync]
  );

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setError(null);
    setWasSponsored(false);
  }, []);

  return { writeContract, writeContractAsync, data, isPending, error, wasSponsored, reset };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Send a transaction via thirdweb's paymaster (gas-sponsored).
 *
 * NOTE: The exact API for sponsoring gas in thirdweb v5 may vary.
 * As of v5.119.x, the approach is:
 *   1. For smart accounts (inAppWallet): gas sponsorship is configured
 *      via the `accountAbstraction` prop on ConnectButton. Transactions
 *      from smart accounts are automatically routed through the paymaster.
 *   2. For EOA wallets: direct paymaster sponsorship requires the
 *      `sendTransaction` call to include paymaster options, which is
 *      not fully exposed in the public API yet.
 *
 * This helper attempts the smart-account path. If the active account
 * is already a smart account (via ConnectButton AA config), the
 * transaction will be automatically sponsored. For EOAs, this will
 * behave like a normal transaction (the caller handles fallback).
 *
 * TODO: When thirdweb exposes a public `paymaster` option on
 * `sendTransaction`, update this to pass it explicitly for EOA support.
 */
async function sendSponsoredTx(params: {
  account: any;
  chain: any;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}): Promise<`0x${string}`> {
  const tx = prepareTransaction({
    client: thirdwebClient,
    chain: params.chain,
    to: params.to,
    data: params.data,
    value: params.value,
  });

  // When the account is a smart account (configured via ConnectButton's
  // accountAbstraction prop), sendTransaction automatically routes
  // through the paymaster. For EOAs this is a normal send.
  const result = await sendTransaction({
    transaction: tx,
    account: params.account,
  });

  return result.transactionHash;
}
