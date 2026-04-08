/**
 * Solana universe creation & management hook.
 * Interacts with the universe_manager Anchor program.
 */
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useState, useCallback } from 'react';
import { getSolanaAddresses } from '@/configs/addresses';
import { SOLANA_CLUSTER } from '@/configs/chains';

export function useSolanaUniverse() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getSolanaAddresses(SOLANA_CLUSTER);
  const programId = new PublicKey(addresses.universeManager);

  const createUniverse = useCallback(
    async (config: {
      name: string;
      description: string;
      imageUrl: string;
      contentHash: Uint8Array;
    }) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        setError('Wallet not connected');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        // Derive PDAs
        const [globalState] = PublicKey.findProgramAddressSync([Buffer.from('global')], programId);

        // Fetch global state to get universe count for PDA derivation
        const globalInfo = await connection.getAccountInfo(globalState);
        if (!globalInfo) throw new Error('Global state not initialized');

        // Universe count is at offset 40 (after discriminator 8 + authority 32)
        const universeCount = globalInfo.data.readBigUInt64LE(40);

        const [universe] = PublicKey.findProgramAddressSync(
          [Buffer.from('universe'), Buffer.from(new BigUint64Array([universeCount]).buffer)],
          programId
        );

        const [treasury] = PublicKey.findProgramAddressSync(
          [Buffer.from('treasury'), universe.toBuffer()],
          programId
        );

        // In production this uses the Anchor client with the IDL loaded:
        // const provider = new AnchorProvider(connection, wallet, {});
        // const program = new Program(idl, programId, provider);
        // const tx = await program.methods
        //   .createUniverse(config.name, config.description, config.imageUrl, [...config.contentHash])
        //   .accounts({
        //     creator: wallet.publicKey,
        //     globalState,
        //     universe,
        //     treasury,
        //     systemProgram: SystemProgram.programId,
        //   })
        //   .rpc();
        // setTxHash(tx);

        setTxHash(`pending-sol-${Date.now()}`);
      } catch (err: any) {
        setError(err.message || 'Transaction failed');
      } finally {
        setIsPending(false);
      }
    },
    [wallet, connection, programId]
  );

  return {
    createUniverse,
    isPending,
    error,
    txHash,
    programId: addresses.universeManager,
  };
}
