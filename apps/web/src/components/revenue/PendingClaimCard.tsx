import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther } from 'viem';
import { useMutation } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';

// PaymentRouter ABI (minimal for claim + claimable)
const paymentRouterAbi = [
  {
    inputs: [{ name: 'creator', type: 'address' }],
    name: 'claimable',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export function PendingClaimCard({
  paymentRouterAddress,
}: {
  paymentRouterAddress?: `0x${string}`;
}) {
  const { address } = useAccount();

  const { data: claimableAmount, refetch } = useReadContract({
    address: paymentRouterAddress,
    abi: paymentRouterAbi,
    functionName: 'claimable',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!paymentRouterAddress, refetchInterval: 30_000 },
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const recordClaim = useMutation(trpc.revenue.recordClaim.mutationOptions());

  // Record claim after tx confirms
  const onClaimConfirmed = async () => {
    if (txHash && claimableAmount) {
      await recordClaim.mutateAsync({
        amountWei: claimableAmount.toString(),
        txHash,
      });
      refetch();
    }
  };

  // Trigger recording when tx confirms
  if (isSuccess && txHash) {
    onClaimConfirmed();
  }

  const handleClaim = () => {
    if (!paymentRouterAddress || !claimableAmount) return;

    writeContract({
      address: paymentRouterAddress,
      abi: paymentRouterAbi,
      functionName: 'claim',
    });
  };

  const ethAmount = claimableAmount ? formatEther(claimableAmount) : '0';
  const hasClaimable = claimableAmount && claimableAmount > 0n;

  return (
    <div className="bg-gradient-to-br from-violet-900/20 to-zinc-900 rounded-xl p-6 border border-violet-800/30">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-400">Pending Earnings</p>
          <p className="text-3xl font-bold text-white mt-1">
            {Number(ethAmount).toFixed(4)} <span className="text-lg text-zinc-400">ETH</span>
          </p>
        </div>

        <button
          onClick={handleClaim}
          disabled={!hasClaimable || isPending || isConfirming}
          className="px-6 py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-xl font-semibold transition-colors"
        >
          {isPending
            ? 'Confirming...'
            : isConfirming
              ? 'Processing...'
              : isSuccess
                ? 'Claimed!'
                : 'Claim ETH'}
        </button>
      </div>

      {!paymentRouterAddress && (
        <p className="text-zinc-500 text-xs mt-3">PaymentRouter address not configured</p>
      )}
    </div>
  );
}
