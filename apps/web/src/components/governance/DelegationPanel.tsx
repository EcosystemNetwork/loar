import { useState } from 'react';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useWriteContract } from '@/hooks/useCircleWrite';
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
    <div className="bg-card rounded-xl p-5 border border-border">
      <h3 className="font-semibold text-foreground mb-4">Delegate Votes</h3>

      <button
        onClick={handleSelfDelegate}
        disabled={isPending || isConfirming || !address}
        className="w-full px-3 py-2 bg-primary hover:bg-primary/90 disabled:bg-foreground/10 disabled:text-muted-foreground rounded-lg text-sm font-medium transition-colors mb-3"
      >
        {isPending || isConfirming ? 'Confirming...' : 'Delegate to Self'}
      </button>

      <div className="relative">
        <p className="text-muted-foreground text-xs mb-2">Or delegate to another address:</p>
        <input
          type="text"
          placeholder="0x..."
          value={delegatee}
          onChange={(e) => setDelegatee(e.target.value)}
          className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-violet-500"
        />
        <button
          onClick={handleDelegate}
          disabled={!isAddress(delegatee) || isPending || isConfirming}
          className="mt-2 w-full px-3 py-2 bg-muted hover:bg-foreground/10 disabled:bg-muted disabled:text-muted-foreground/70 rounded-lg text-sm font-medium transition-colors"
        >
          Delegate
        </button>
      </div>

      {isSuccess && <p className="text-green-400 text-xs mt-3">Delegation successful!</p>}
    </div>
  );
}
