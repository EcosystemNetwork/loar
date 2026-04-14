/**
 * useSafe — Safe (Gnosis Safe) multi-sig integration hook
 *
 * Wraps @safe-global/protocol-kit and @safe-global/api-kit to provide:
 *   - deploySafe()           — deploy a new Safe wallet
 *   - getSafeInfo()          — read owners + threshold
 *   - proposeTransaction()   — sign & submit tx to Safe TX Service
 *   - confirmTransaction()   — add a confirmation signature
 *   - executeTransaction()   — execute once threshold met
 *   - getPendingTransactions() — list pending Safe txs
 */
import { useCallback, useState } from 'react';
import { useWalletClient, usePublicClient, useChainId } from 'wagmi';
import { type MetaTransactionData } from '@safe-global/types-kit';

// Lazy-load heavy Safe SDKs to avoid bundling ethers + node builtins
// in the initial page load (they use node-fetch/stream/http internally).
async function loadSafe() {
  const { default: Safe } = await import('@safe-global/protocol-kit');
  return Safe;
}
async function loadSafeApiKit(chainId: number) {
  const { default: SafeApiKit } = await import('@safe-global/api-kit');
  return new SafeApiKit({ chainId: BigInt(chainId) });
}
const OperationType = { Call: 0, DelegateCall: 1 } as const;

// Safe Transaction Service URLs per chain
const TX_SERVICE_URLS: Record<number, string> = {
  11155111: 'https://safe-transaction-sepolia.safe.global',
  8453: 'https://safe-transaction-base.safe.global',
  84532: 'https://safe-transaction-base-sepolia.safe.global',
};

export interface SafeInfo {
  address: string;
  owners: string[];
  threshold: number;
  nonce: number;
}

export interface PendingSafeTransaction {
  safeTxHash: string;
  to: string;
  value: string;
  data: string | null;
  nonce: number;
  confirmations: { owner: string }[];
  confirmationsRequired: number;
  isExecuted: boolean;
  submissionDate: string;
}

export function useSafe() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getApiKit = useCallback(async () => {
    const txServiceUrl = TX_SERVICE_URLS[chainId];
    if (!txServiceUrl) {
      throw new Error(`Safe Transaction Service not available for chain ${chainId}`);
    }
    return loadSafeApiKit(chainId);
  }, [chainId]);

  /**
   * Deploy a new Safe multi-sig wallet.
   */
  const deploySafe = useCallback(
    async (owners: string[], threshold: number): Promise<string> => {
      if (!walletClient) throw new Error('Wallet not connected');
      if (owners.length < 2) throw new Error('Need at least 2 owners');
      if (threshold < 1 || threshold > owners.length) {
        throw new Error(`Threshold must be between 1 and ${owners.length}`);
      }

      setIsLoading(true);
      setError(null);

      try {
        const protocolKit = await (
          await loadSafe()
        ).init({
          provider: walletClient.transport,
          signer: walletClient.account.address,
          predictedSafe: {
            safeAccountConfig: {
              owners,
              threshold,
            },
          },
        });

        const safeAddress = await protocolKit.getAddress();

        // Deploy the Safe
        const deploymentTx = await protocolKit.createSafeDeploymentTransaction();

        const txHash = await walletClient.sendTransaction({
          to: deploymentTx.to as `0x${string}`,
          data: deploymentTx.data as `0x${string}`,
          value: BigInt(deploymentTx.value),
          chain: walletClient.chain,
          account: walletClient.account,
        });

        // Wait for deployment
        await publicClient!.waitForTransactionReceipt({ hash: txHash });

        return safeAddress;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [walletClient, publicClient]
  );

  /**
   * Get Safe wallet info (owners, threshold, nonce).
   */
  const getSafeInfo = useCallback(
    async (safeAddress: string): Promise<SafeInfo> => {
      if (!walletClient) throw new Error('Wallet not connected');

      const protocolKit = await (
        await loadSafe()
      ).init({
        provider: walletClient.transport,
        signer: walletClient.account.address,
        safeAddress,
      });

      const [owners, threshold, nonce] = await Promise.all([
        protocolKit.getOwners(),
        protocolKit.getThreshold(),
        protocolKit.getNonce(),
      ]);

      return {
        address: safeAddress,
        owners,
        threshold,
        nonce,
      };
    },
    [walletClient]
  );

  /**
   * Propose a transaction through the Safe.
   * Signs it with the connected wallet and submits to the TX Service.
   */
  const proposeTransaction = useCallback(
    async (
      safeAddress: string,
      tx: { to: string; data: string; value?: string }
    ): Promise<string> => {
      if (!walletClient) throw new Error('Wallet not connected');

      setIsLoading(true);
      setError(null);

      try {
        const protocolKit = await (
          await loadSafe()
        ).init({
          provider: walletClient.transport,
          signer: walletClient.account.address,
          safeAddress,
        });

        const apiKit = await getApiKit();

        const metaTx: MetaTransactionData = {
          to: tx.to,
          data: tx.data,
          value: tx.value ?? '0',
          operation: OperationType.Call,
        };

        const safeTx = await protocolKit.createTransaction({
          transactions: [metaTx],
        });

        const safeTxHash = await protocolKit.getTransactionHash(safeTx);
        const signature = await protocolKit.signHash(safeTxHash);

        await apiKit.proposeTransaction({
          safeAddress,
          safeTransactionData: safeTx.data,
          safeTxHash,
          senderAddress: walletClient.account.address,
          senderSignature: signature.data,
        });

        return safeTxHash;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [walletClient, getApiKit]
  );

  /**
   * Add a confirmation signature to a pending Safe transaction.
   */
  const confirmTransaction = useCallback(
    async (safeAddress: string, safeTxHash: string): Promise<void> => {
      if (!walletClient) throw new Error('Wallet not connected');

      setIsLoading(true);
      setError(null);

      try {
        const protocolKit = await (
          await loadSafe()
        ).init({
          provider: walletClient.transport,
          signer: walletClient.account.address,
          safeAddress,
        });

        const signature = await protocolKit.signHash(safeTxHash);
        const apiKit = await getApiKit();

        await apiKit.confirmTransaction(safeTxHash, signature.data);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [walletClient, getApiKit]
  );

  /**
   * Execute a Safe transaction once the confirmation threshold is met.
   */
  const executeTransaction = useCallback(
    async (safeAddress: string, safeTxHash: string): Promise<string> => {
      if (!walletClient) throw new Error('Wallet not connected');

      setIsLoading(true);
      setError(null);

      try {
        const protocolKit = await (
          await loadSafe()
        ).init({
          provider: walletClient.transport,
          signer: walletClient.account.address,
          safeAddress,
        });

        const apiKit = await getApiKit();
        const safeTx = await apiKit.getTransaction(safeTxHash);

        const execResult = await protocolKit.executeTransaction(safeTx);
        const txHash = execResult.hash;

        if (txHash) {
          await publicClient!.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
        }

        return txHash ?? '';
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [walletClient, publicClient, getApiKit]
  );

  /**
   * List pending (unexecuted) transactions for a Safe.
   */
  const getPendingTransactions = useCallback(
    async (safeAddress: string): Promise<PendingSafeTransaction[]> => {
      const apiKit = await getApiKit();
      const response = await apiKit.getPendingTransactions(safeAddress);

      return response.results.map((tx: any) => ({
        safeTxHash: tx.safeTxHash,
        to: tx.to,
        value: tx.value,
        data: tx.data,
        nonce: tx.nonce,
        confirmations: (tx.confirmations ?? []).map((c: any) => ({ owner: c.owner })),
        confirmationsRequired: tx.confirmationsRequired,
        isExecuted: tx.isExecuted,
        submissionDate: tx.submissionDate,
      }));
    },
    [getApiKit]
  );

  return {
    deploySafe,
    getSafeInfo,
    proposeTransaction,
    confirmTransaction,
    executeTransaction,
    getPendingTransactions,
    isLoading,
    error,
  };
}
