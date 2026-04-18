import { useReadContract } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { governanceErc20Abi } from '@loar/abis/generated';
import { formatEther } from 'viem';
import { useUniverseAddresses } from '../../hooks/useUniverseAddresses';
import { useVocab } from '../../hooks/use-vocab';

export function VotingPowerCard({ universeId }: { universeId: string }) {
  const { address } = useAccount();
  const v = useVocab();

  const { tokenAddress } = useUniverseAddresses(universeId);

  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: governanceErc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });

  const { data: votes } = useReadContract({
    address: tokenAddress,
    abi: governanceErc20Abi,
    functionName: 'getVotes',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });

  const { data: delegates } = useReadContract({
    address: tokenAddress,
    abi: governanceErc20Abi,
    functionName: 'delegates',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });

  const isSelfDelegated = delegates && address && delegates.toLowerCase() === address.toLowerCase();

  return (
    <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
      <h3 className="font-semibold text-white mb-4">Your {v('voting-power')}</h3>

      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-zinc-400 text-sm">{v('token-balance')}</span>
          <span className="text-white font-mono text-sm">
            {balance ? Number(formatEther(balance)).toLocaleString() : '0'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-400 text-sm">{v('voting-power')}</span>
          <span className="text-white font-mono text-sm">
            {votes ? Number(formatEther(votes)).toLocaleString() : '0'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-400 text-sm">Delegated To</span>
          <span className="text-white text-sm">
            {!delegates
              ? 'None'
              : isSelfDelegated
                ? 'Self'
                : `${delegates.slice(0, 6)}...${delegates.slice(-4)}`}
          </span>
        </div>
      </div>

      {!address && (
        <p className="text-zinc-500 text-sm mt-4">
          {v('connect-wallet')} to see {v('voting-power').toLowerCase()}
        </p>
      )}

      {address && !isSelfDelegated && (
        <p className="text-yellow-400/70 text-xs mt-4">
          You must delegate to yourself to activate voting power
        </p>
      )}
    </div>
  );
}
