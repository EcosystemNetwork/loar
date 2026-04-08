/**
 * SUI credit purchase hook.
 * Interacts with the credit_manager Move module.
 */
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useState, useCallback } from 'react';
import { getSuiAddresses } from '@/configs/addresses';
import { SUI_NETWORK } from '@/configs/chains';

export function useSuiCredits() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getSuiAddresses(SUI_NETWORK);
  const packageId = addresses.creditManager;

  const purchaseWithSui = useCallback(
    async (configId: string, balanceId: string, paymentCoinId: string, tier: number) => {
      if (!packageId) {
        setError('creditManager package not deployed');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${packageId}::credit_manager::purchase_credits_sui`,
          arguments: [
            tx.object(configId),
            tx.object(balanceId),
            tx.object(paymentCoinId),
            tx.pure.u8(tier),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        setTxHash(result.digest);
      } catch (err: any) {
        setError(err.message || 'Credit purchase failed');
      } finally {
        setIsPending(false);
      }
    },
    [packageId, signAndExecute]
  );

  const createBalance = useCallback(async () => {
    if (!packageId) {
      setError('creditManager package not deployed');
      return;
    }
    setIsPending(true);
    setError(null);

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::credit_manager::create_balance`,
        arguments: [],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxHash(result.digest);
    } catch (err: any) {
      setError(err.message || 'Create balance failed');
    } finally {
      setIsPending(false);
    }
  }, [packageId, signAndExecute]);

  return {
    purchaseWithSui,
    createBalance,
    isPending,
    error,
    txHash,
  };
}
