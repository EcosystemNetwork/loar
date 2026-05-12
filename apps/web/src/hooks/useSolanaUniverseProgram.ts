/**
 * useSolanaUniverseProgram — single-shot hook to deploy a Solana Universe PDA.
 *
 * Mirrors `useUniverseManager` (EVM) at the surface level: caller passes the
 * universe inputs, hook returns a mutation-like `{ initializeUniverse, isPending, error }`
 * trio. Internally it ties together:
 *   - @solana/wallet-adapter-react (Phantom/Solflare signer)
 *   - apps/web/src/lib/solana-universe-program.ts (instruction builder)
 *   - the configured cluster from `apps/web/src/configs/chains.ts`
 */
import { useCallback, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  initializeUniverse as runInitializeUniverse,
  sha256Bytes,
  type UniverseProgramCluster,
  type Visibility,
} from '@/lib/solana-universe-program';

export interface SolanaUniverseInput {
  /** Cluster the program lives on — typically derived from the chain selector. */
  cluster: UniverseProgramCluster;
  /** Visibility on creation — 'private' (fun mode) or 'public' (monetized). */
  visibility: Visibility;
  /** Free-form text hashed into the content_hash seed. Stable per universe. */
  contentSeed: string;
  /** Free-form text hashed into plot_hash. Doesn't need to be unique. */
  plotSeed: string;
}

export interface SolanaUniverseResult {
  signature: string;
  universePda: string;
  cluster: UniverseProgramCluster;
}

export function useSolanaUniverseProgram() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const initializeUniverse = useCallback(
    async (input: SolanaUniverseInput): Promise<SolanaUniverseResult> => {
      if (!wallet.publicKey || !wallet.sendTransaction) {
        throw new Error('Solana wallet not connected');
      }
      setIsPending(true);
      setError(null);
      try {
        const contentHash = await sha256Bytes(input.contentSeed);
        const plotHash = await sha256Bytes(input.plotSeed);

        const result = await runInitializeUniverse({
          cluster: input.cluster,
          creator: wallet.publicKey,
          contentHash,
          plotHash,
          visibility: input.visibility,
          // Use the wallet-adapter's `sendTransaction` so the wallet handles
          // signing, simulation, and submission. We pass our own connection
          // (from useConnection) so the cluster is consistent end-to-end.
          signAndSend: async (tx: Transaction) =>
            wallet.sendTransaction(tx, connection, { skipPreflight: false }),
        });

        return {
          signature: result.signature,
          universePda: result.universePda.toBase58(),
          cluster: result.cluster,
        };
      } catch (e) {
        const err = e instanceof Error ? e : new Error('Failed to initialize Solana universe');
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [wallet, connection]
  );

  return {
    initializeUniverse,
    isPending,
    error,
    /** Solana address of the connected wallet, base58 — null when disconnected. */
    address: wallet.publicKey ? wallet.publicKey.toBase58() : null,
    isConnected: wallet.connected,
    /** Underlying wallet adapter — exposed so callers can drive connect/disconnect. */
    wallet,
    /** Helper to materialize a `PublicKey` from a base58 string. */
    toPublicKey: (b58: string) => new PublicKey(b58),
  };
}
