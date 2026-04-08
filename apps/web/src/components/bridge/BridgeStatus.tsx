import { useState, useEffect, useMemo } from 'react';
import { estimateBridgeTime } from '../../configs/bridge';
import { getExplorerTxUrl } from '../../configs/chains';

type Chain = 'base' | 'solana' | 'sui';

interface BridgeStatusProps {
  txHash: string;
  sourceChain: Chain;
  destChain: Chain;
  amount: string;
  onComplete: () => void;
}

const STEPS = [
  'Initiated',
  'Submitted',
  'Guardian Attestation',
  'Redeemed on Destination',
] as const;

const CHAIN_LABELS: Record<Chain, string> = {
  base: 'Base',
  solana: 'Solana',
  sui: 'SUI',
};

function chainToExplorerParam(chain: Chain): number | 'solana' | 'sui' {
  if (chain === 'solana') return 'solana';
  if (chain === 'sui') return 'sui';
  // Default to Base mainnet chain ID (8453)
  return 8453;
}

export function BridgeStatus({
  txHash,
  sourceChain,
  destChain,
  amount,
  onComplete,
}: BridgeStatusProps) {
  // Simulated step progression (advances every 5 seconds)
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, 3)), 5000);
    return () => clearInterval(timer);
  }, []);

  const isComplete = step === 3;

  const estimatedTime = useMemo(() => {
    const est = estimateBridgeTime(sourceChain);
    const minMin = Math.floor(est.minSeconds / 60);
    const maxMin = Math.ceil(est.maxSeconds / 60);
    return `${minMin}-${maxMin} min`;
  }, [sourceChain]);

  const explorerUrl = useMemo(
    () => getExplorerTxUrl(chainToExplorerParam(sourceChain), txHash),
    [sourceChain, txHash]
  );

  return (
    <div className="bg-card border rounded-xl p-6">
      {/* Header: source -> dest */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center justify-center px-2 py-1 rounded bg-muted text-muted-foreground font-medium">
            {CHAIN_LABELS[sourceChain]}
          </span>
          <svg
            width="20"
            height="12"
            viewBox="0 0 20 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-muted-foreground"
          >
            <path
              d="M1 6H19M19 6L14 1M19 6L14 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="inline-flex items-center justify-center px-2 py-1 rounded bg-muted text-muted-foreground font-medium">
            {CHAIN_LABELS[destChain]}
          </span>
        </div>
        <span className="text-sm font-medium text-foreground">
          {parseFloat(amount).toLocaleString()} LOAR
        </span>
      </div>

      {/* Progress steps */}
      <div className="space-y-4 mb-6">
        {STEPS.map((label, i) => {
          const isCompleted = step > i;
          const isActive = step === i;

          return (
            <div key={label} className="flex items-center gap-3">
              {/* Step indicator */}
              <div className="flex-shrink-0">
                {isCompleted ? (
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2 6L5 9L10 3"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                ) : isActive ? (
                  <div className="w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full border-2 border-muted" />
                )}
              </div>
              {/* Step label */}
              <span
                className={`text-sm ${
                  isCompleted
                    ? 'text-foreground'
                    : isActive
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Estimated time */}
      {!isComplete && (
        <p className="text-xs text-muted-foreground mb-4">
          Estimated time remaining: {estimatedTime}
        </p>
      )}

      {/* Tx hash link */}
      <div className="mb-4">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline font-mono break-all"
        >
          {txHash.slice(0, 10)}...{txHash.slice(-8)}
        </a>
      </div>

      {/* Done button */}
      {isComplete && (
        <button
          onClick={onComplete}
          className="w-full py-3 rounded-lg font-semibold transition bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Done
        </button>
      )}
    </div>
  );
}
