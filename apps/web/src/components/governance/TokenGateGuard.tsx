/**
 * TokenGateGuard — wraps content that requires token ownership.
 * Shows a locked overlay when the connected wallet doesn't meet the minimum
 * ownership threshold for the specified gate target.
 */
import { useTokenGate, type GateTarget } from '../../hooks/useTokenGate';
import { useAccount, useReadContract } from 'wagmi';
import { governanceErc20Abi } from '@loar/abis/generated';
import { useUniverseAddresses } from '../../hooks/useUniverseAddresses';

interface TokenGateGuardProps {
  universeId: string;
  /** Which gate target to enforce (view, create, canon, wiki, governance, play) */
  target?: GateTarget;
  children: React.ReactNode;
}

export function TokenGateGuard({ universeId, target = 'view', children }: TokenGateGuardProps) {
  const { isConnected } = useAccount();
  const gate = useTokenGate(universeId, target);
  const { tokenAddress } = useUniverseAddresses(universeId);

  const { data: tokenSymbol } = useReadContract({
    address: tokenAddress,
    abi: governanceErc20Abi,
    functionName: 'symbol',
    query: { enabled: !!tokenAddress && gate.hasGate },
  });

  // No gate configured for this target — show content freely
  if (!gate.hasGate) return <>{children}</>;

  // Still loading
  if (gate.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // User passes the gate
  if (gate.passes) return <>{children}</>;

  // User does NOT pass — show locked overlay
  const targetLabels: Record<GateTarget, string> = {
    view: 'View Content',
    create: 'Create Nodes',
    canon: 'Canon Marketplace',
    wiki: 'Wiki & Lore',
    governance: 'Governance',
    play: 'Player',
  };

  return (
    <div className="relative">
      {/* Blurred content preview */}
      <div className="filter blur-md pointer-events-none select-none opacity-40" aria-hidden>
        {children}
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm rounded-xl">
        <div className="text-center max-w-sm px-6 py-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-violet-600/20 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
          </div>

          <h3 className="text-white font-semibold text-lg mb-2">
            {gate.label || `${targetLabels[target]} — Token Gated`}
          </h3>

          <p className="text-zinc-400 text-sm mb-4">
            {!isConnected ? (
              'Connect your wallet to access this content.'
            ) : (
              <>
                You need at least{' '}
                <span className="text-violet-400 font-mono font-semibold">
                  {gate.minPercentage}%
                </span>{' '}
                ownership of {tokenSymbol ? `$${tokenSymbol}` : 'the governance token'} to{' '}
                {target === 'view'
                  ? 'view this content'
                  : target === 'create'
                    ? 'create nodes'
                    : target === 'canon'
                      ? 'access the canon marketplace'
                      : target === 'wiki'
                        ? 'access the wiki'
                        : target === 'governance'
                          ? 'participate in governance'
                          : 'use the player'}
                .
              </>
            )}
          </p>

          {isConnected && (
            <div className="bg-zinc-800/50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-zinc-500">Your ownership</span>
                <span
                  className={`font-mono ${gate.ownershipPercentage > 0 ? 'text-white' : 'text-zinc-500'}`}
                >
                  {gate.ownershipPercentage.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Required</span>
                <span className="text-violet-400 font-mono">{gate.minPercentage}%</span>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-zinc-700 rounded-full h-1.5 mt-2">
                <div
                  className="bg-violet-500 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${Math.min((gate.ownershipPercentage / gate.minPercentage) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
