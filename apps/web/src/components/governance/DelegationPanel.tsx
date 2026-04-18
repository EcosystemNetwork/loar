import { useState } from 'react';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { governanceErc20Abi } from '@loar/abis/generated';
import { isAddress } from 'viem';
import { useUniverseAddresses } from '../../hooks/useUniverseAddresses';

export function DelegationPanel({ universeId }: { universeId: string }) {
  const { address } = useAccount();
  const [delegatee, setDelegatee] = useState('');

  const { tokenAddress } = useUniverseAddresses(universeId);

  const { writeContract, data: txHash, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const handleDelegate = () => {
    if (!tokenAddress || !isAddress(delegatee)) return;

    writeContract({
      address: tokenAddress,
      abi: governanceErc20Abi,
      functionName: 'delegate',
      args: [delegatee as `0x${string}`],
    });
  };

  const handleSelfDelegate = () => {
    if (!tokenAddress || !address) return;

    writeContract({
      address: tokenAddress,
      abi: governanceErc20Abi,
      functionName: 'delegate',
      args: [address],
    });
  };

  return (
    <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
      <h3 className="font-semibold text-white mb-4">Delegate Votes</h3>

      <button
        onClick={handleSelfDelegate}
        disabled={isPending || isConfirming || !address}
        className="w-full px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-sm font-medium transition-colors mb-3"
      >
        {isPending || isConfirming ? 'Confirming...' : 'Delegate to Self'}
      </button>

      <div className="relative">
        <p className="text-zinc-500 text-xs mb-2">Or delegate to another address:</p>
        <input
          type="text"
          placeholder="0x..."
          value={delegatee}
          onChange={(e) => setDelegatee(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
        />
        <button
          onClick={handleDelegate}
          disabled={!isAddress(delegatee) || isPending || isConfirming}
          className="mt-2 w-full px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg text-sm font-medium transition-colors"
        >
          Delegate
        </button>
      </div>

      {isSuccess && <p className="text-green-400 text-xs mt-3">Delegation successful!</p>}
    </div>
  );
}
