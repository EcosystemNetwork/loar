/**
 * Live on-chain balances for one wallet — what a creator can claim from
 * PaymentRouter and how much $LOAR they hold. Read straight from the chain
 * (not the indexer) so the mobile earnings/tokens screens show real figures.
 *
 * Values come back as trimmed decimal strings so clients don't need chain
 * maths (mobile has no EVM stack).
 */
import {
  ContractFunctionRevertedError,
  formatEther,
  formatUnits,
  isAddress,
  type Address,
  type BaseError,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { LoarToken, PaymentRouter } from '@loar/abis/addresses';
import { loarTokenAbi, paymentRouterAbi } from '@loar/abis/generated';

export interface OnchainBalances {
  chainId: number;
  /** ETH the wallet can `PaymentRouter.claim()` right now. */
  claimableEth: string;
  /** ETH stuck in `PaymentRouter.pendingWithdrawals` (failed pushes) — `claimPending()`. */
  pendingWithdrawalsEth: string;
  /** $LOAR the wallet can `PaymentRouter.claimLoar()`. */
  claimableLoar: string;
  /** $LOAR held in the wallet. */
  loarBalance: string;
}

/** Trim a decimal string to at most `maxFrac` fractional digits, dropping trailing zeros. */
export function trimDecimals(value: string, maxFrac = 6): string {
  const [int, frac = ''] = value.split('.');
  const cut = frac.slice(0, maxFrac).replace(/0+$/, '');
  return cut ? `${int}.${cut}` : int;
}

export function isEvmAddress(value: string | null | undefined): value is Address {
  return !!value && isAddress(value);
}

/** Chains where both PaymentRouter and LoarToken are deployed. */
export function supportedChainId(chainId: number): boolean {
  const k = String(chainId);
  return k in PaymentRouter && k in LoarToken;
}

export async function readOnchainBalances(
  client: Pick<PublicClient, 'readContract'>,
  address: Address,
  chainId: number = sepolia.id
): Promise<OnchainBalances> {
  if (!supportedChainId(chainId))
    throw new Error(`PaymentRouter/LoarToken not deployed on chain ${chainId}`);
  const router = (PaymentRouter as Record<string, Address>)[String(chainId)];
  const loar = (LoarToken as Record<string, Address>)[String(chainId)];

  const [claimable, pending, claimableLoar, loarBalance] = await Promise.all([
    client.readContract({
      address: router,
      abi: paymentRouterAbi,
      functionName: 'claimable',
      args: [address],
    }),
    // The deployed PaymentRouter proxy can point at an implementation that predates
    // `pendingWithdrawals` (the call reverts). It's a supplementary figure, so a
    // revert reads as 0 — a network/RPC failure still fails the whole call.
    client
      .readContract({
        address: router,
        abi: paymentRouterAbi,
        functionName: 'pendingWithdrawals',
        args: [address],
      })
      .catch((err: BaseError) => {
        if (err?.walk?.((e) => e instanceof ContractFunctionRevertedError)) return 0n;
        throw err;
      }),
    client.readContract({
      address: router,
      abi: paymentRouterAbi,
      functionName: 'claimableLoar',
      args: [address],
    }),
    client.readContract({
      address: loar,
      abi: loarTokenAbi,
      functionName: 'balanceOf',
      args: [address],
    }),
  ]);

  return {
    chainId,
    claimableEth: trimDecimals(formatEther(claimable as bigint)),
    pendingWithdrawalsEth: trimDecimals(formatEther(pending as bigint)),
    claimableLoar: trimDecimals(formatUnits(claimableLoar as bigint, 18)),
    loarBalance: trimDecimals(formatUnits(loarBalance as bigint, 18)),
  };
}
