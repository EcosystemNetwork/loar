import { createFileRoute } from '@tanstack/react-router';
import { BridgeForm } from '../components/bridge/BridgeForm';
import { BridgeStatus } from '../components/bridge/BridgeStatus';
import { useState } from 'react';
import { BRIDGE_FEE_NOTE } from '../configs/bridge';

export const Route = createFileRoute('/bridge')({
  component: BridgePage,
});

function BridgePage() {
  const [activeTx, setActiveTx] = useState<{
    txHash: string;
    sourceChain: 'base' | 'solana' | 'sui';
    destChain: 'base' | 'solana' | 'sui';
    amount: string;
  } | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Bridge $LOAR</h1>
        <p className="text-muted-foreground mb-8">
          Transfer $LOAR between Base, Solana, and SUI via Wormhole.
        </p>

        <BridgeForm onBridgeInitiated={(tx) => setActiveTx(tx)} />

        {activeTx && (
          <div className="mt-8">
            <BridgeStatus
              txHash={activeTx.txHash}
              sourceChain={activeTx.sourceChain}
              destChain={activeTx.destChain}
              amount={activeTx.amount}
              onComplete={() => setActiveTx(null)}
            />
          </div>
        )}

        <p className="mt-8 text-xs text-muted-foreground border-t pt-4">{BRIDGE_FEE_NOTE}</p>
      </div>
    </div>
  );
}
