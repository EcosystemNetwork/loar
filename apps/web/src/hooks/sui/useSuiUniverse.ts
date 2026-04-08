/**
 * SUI universe creation & management hook.
 * Interacts with the loar::universe_manager Move module.
 */
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useState, useCallback } from 'react';
import { getSuiAddresses } from '@/configs/addresses';
import { SUI_NETWORK } from '@/configs/chains';

export function useSuiUniverse() {
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getSuiAddresses(SUI_NETWORK);
  const packageId = addresses.universeManager;

  const createUniverse = useCallback(
    async (config: {
      name: string;
      description: string;
      imageUrl: string;
      contentHash: number[];
      globalStateId: string;
      paymentCoinId: string;
      clockId?: string;
    }) => {
      if (!packageId) {
        setError('Package not deployed');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${packageId}::universe_manager::create_universe`,
          arguments: [
            tx.object(config.globalStateId),
            tx.pure.vector('u8', new TextEncoder().encode(config.name)),
            tx.pure.vector('u8', new TextEncoder().encode(config.description)),
            tx.pure.vector('u8', new TextEncoder().encode(config.imageUrl)),
            tx.pure.vector('u8', config.contentHash),
            tx.object(config.paymentCoinId),
            tx.object(config.clockId || '0x6'), // SUI Clock object
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        setTxHash(result.digest);
      } catch (err: any) {
        setError(err.message || 'Transaction failed');
      } finally {
        setIsPending(false);
      }
    },
    [packageId, signAndExecute]
  );

  return { createUniverse, isPending, error, txHash, packageId };
}
