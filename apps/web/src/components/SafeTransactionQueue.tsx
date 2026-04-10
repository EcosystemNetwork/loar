/**
 * SafeTransactionQueue — display and manage pending Safe transactions
 *
 * Shows pending multi-sig transactions for a universe's Safe admin.
 * Allows signers to confirm and execute transactions.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { decodeFunctionData } from 'viem';
import { universeAbi } from '@loar/abis/generated';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSafe, type PendingSafeTransaction } from '@/hooks/useSafe';
import { CheckCircle2, Clock, Loader2, PlayCircle, RefreshCw, FileText } from 'lucide-react';

interface SafeTransactionQueueProps {
  safeAddress: string;
  universeAddress?: string;
}

export function SafeTransactionQueue({ safeAddress, universeAddress }: SafeTransactionQueueProps) {
  const { address } = useAccount();
  const { getPendingTransactions, confirmTransaction, executeTransaction, isLoading } = useSafe();

  const [transactions, setTransactions] = useState<PendingSafeTransaction[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [actionTxHash, setActionTxHash] = useState<string | null>(null);

  const loadTransactions = useCallback(async () => {
    setLoadingTxs(true);
    try {
      const txs = await getPendingTransactions(safeAddress);
      setTransactions(txs);
    } catch (err) {
      console.error('Failed to load Safe transactions:', err);
    } finally {
      setLoadingTxs(false);
    }
  }, [safeAddress, getPendingTransactions]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const handleConfirm = async (safeTxHash: string) => {
    setActionTxHash(safeTxHash);
    try {
      await confirmTransaction(safeAddress, safeTxHash);
      await loadTransactions();
    } catch (err) {
      console.error('Confirmation failed:', err);
    } finally {
      setActionTxHash(null);
    }
  };

  const handleExecute = async (safeTxHash: string) => {
    setActionTxHash(safeTxHash);
    try {
      await executeTransaction(safeAddress, safeTxHash);
      await loadTransactions();
    } catch (err) {
      console.error('Execution failed:', err);
    } finally {
      setActionTxHash(null);
    }
  };

  const decodeTxDescription = (tx: PendingSafeTransaction): string => {
    if (!tx.data || tx.data === '0x') return 'ETH Transfer';

    // Try decoding against Universe ABI
    try {
      const decoded = decodeFunctionData({
        abi: universeAbi,
        data: tx.data as `0x${string}`,
      });
      return decoded.functionName;
    } catch {
      return `Call to ${tx.to.slice(0, 10)}...`;
    }
  };

  const hasConfirmed = (tx: PendingSafeTransaction) =>
    address && tx.confirmations.some((c) => c.owner.toLowerCase() === address.toLowerCase());

  const canExecute = (tx: PendingSafeTransaction) =>
    tx.confirmations.length >= tx.confirmationsRequired;

  if (loadingTxs && transactions.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading pending transactions...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Pending Transactions
          {transactions.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {transactions.length}
            </Badge>
          )}
        </h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadTransactions}
          disabled={loadingTxs}
          className="h-7 w-7 p-0"
        >
          <RefreshCw className={`h-3 w-3 ${loadingTxs ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {transactions.length === 0 ? (
        <p className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-lg text-center">
          No pending transactions
        </p>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => (
            <div key={tx.safeTxHash} className="p-3 bg-muted/50 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium">{decodeTxDescription(tx)}</span>
                </div>
                <Badge variant={canExecute(tx) ? 'default' : 'outline'} className="text-[10px]">
                  {tx.confirmations.length}/{tx.confirmationsRequired}
                </Badge>
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                {tx.confirmations.map((c) => (
                  <Badge key={c.owner} variant="secondary" className="text-[9px] font-mono">
                    <CheckCircle2 className="h-2 w-2 mr-1 text-green-500" />
                    {c.owner.slice(0, 6)}...{c.owner.slice(-4)}
                  </Badge>
                ))}
              </div>

              <div className="flex gap-2">
                {!hasConfirmed(tx) && !canExecute(tx) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConfirm(tx.safeTxHash)}
                    disabled={isLoading && actionTxHash === tx.safeTxHash}
                    className="h-7 text-xs flex-1"
                  >
                    {isLoading && actionTxHash === tx.safeTxHash ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                    )}
                    Confirm
                  </Button>
                )}
                {canExecute(tx) && (
                  <Button
                    size="sm"
                    onClick={() => handleExecute(tx.safeTxHash)}
                    disabled={isLoading && actionTxHash === tx.safeTxHash}
                    className="h-7 text-xs flex-1"
                  >
                    {isLoading && actionTxHash === tx.safeTxHash ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <PlayCircle className="h-3 w-3 mr-1" />
                    )}
                    Execute
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
