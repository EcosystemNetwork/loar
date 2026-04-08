/**
 * Solana credit purchase hook.
 * Interacts with the credit_manager Anchor program.
 */
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useState, useCallback } from 'react';
import { getSolanaAddresses } from '@/configs/addresses';
import { SOLANA_CLUSTER } from '@/configs/chains';

// ---------------------------------------------------------------------------
// Credit Tiers
// ---------------------------------------------------------------------------

export enum CreditTier {
  Starter = 0,
  Creator = 1,
  Pro = 2,
  Studio = 3,
  Enterprise = 4,
}

export const CREDIT_TIER_AMOUNTS: Record<CreditTier, number> = {
  [CreditTier.Starter]: 100,
  [CreditTier.Creator]: 500,
  [CreditTier.Pro]: 1500,
  [CreditTier.Studio]: 5000,
  [CreditTier.Enterprise]: 20000,
};

// ---------------------------------------------------------------------------
// PDA Helpers
// ---------------------------------------------------------------------------

function deriveCreditConfigPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('credit_config')], programId);
  return pda;
}

function deriveCreditBalancePda(user: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('credit_balance'), user.toBuffer()],
    programId
  );
  return pda;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSolanaCredits() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getSolanaAddresses(SOLANA_CLUSTER);
  const programId = new PublicKey(addresses.creditManager);

  const creditConfig = deriveCreditConfigPda(programId);

  // -----------------------------------------------------------------------
  // Purchase with SOL
  // -----------------------------------------------------------------------

  const purchaseWithSol = useCallback(
    async (tier: CreditTier) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        setError('Wallet not connected');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        const creditBalance = deriveCreditBalancePda(wallet.publicKey, programId);

        const [paymentVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('payment_vault')],
          programId
        );

        // In production with Anchor IDL loaded:
        // const provider = new AnchorProvider(connection, wallet, {});
        // const program = new Program(idl, programId, provider);
        // const tx = await program.methods
        //   .purchaseWithSol(tier)
        //   .accounts({
        //     buyer: wallet.publicKey,
        //     creditConfig,
        //     creditBalance,
        //     paymentVault,
        //     systemProgram: SystemProgram.programId,
        //   })
        //   .rpc();
        // setTxHash(tx);

        setTxHash(`pending-sol-credit-sol-${Date.now()}`);
      } catch (err: any) {
        setError(err.message || 'Purchase failed');
      } finally {
        setIsPending(false);
      }
    },
    [wallet, connection, programId, creditConfig]
  );

  // -----------------------------------------------------------------------
  // Purchase with $LOAR
  // -----------------------------------------------------------------------

  const purchaseWithLoar = useCallback(
    async (tier: CreditTier) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        setError('Wallet not connected');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        const creditBalance = deriveCreditBalancePda(wallet.publicKey, programId);

        const loarMint = new PublicKey(addresses.loarMint);

        // Derive the buyer's associated token account for $LOAR
        const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token');

        const [buyerTokenAccount] = PublicKey.findProgramAddressSync(
          [wallet.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), loarMint.toBuffer()],
          ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const [tokenVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('token_vault'), loarMint.toBuffer()],
          programId
        );

        // In production with Anchor IDL loaded:
        // const provider = new AnchorProvider(connection, wallet, {});
        // const program = new Program(idl, programId, provider);
        // const tx = await program.methods
        //   .purchaseWithLoar(tier)
        //   .accounts({
        //     buyer: wallet.publicKey,
        //     creditConfig,
        //     creditBalance,
        //     buyerTokenAccount,
        //     tokenVault,
        //     loarMint,
        //     tokenProgram: TOKEN_PROGRAM_ID,
        //     systemProgram: SystemProgram.programId,
        //   })
        //   .rpc();
        // setTxHash(tx);

        setTxHash(`pending-sol-credit-loar-${Date.now()}`);
      } catch (err: any) {
        setError(err.message || 'Purchase failed');
      } finally {
        setIsPending(false);
      }
    },
    [wallet, connection, programId, creditConfig, addresses.loarMint]
  );

  // -----------------------------------------------------------------------
  // Get Balance
  // -----------------------------------------------------------------------

  const getBalance = useCallback(async (): Promise<number | null> => {
    if (!wallet.publicKey) {
      setError('Wallet not connected');
      return null;
    }

    try {
      const creditBalance = deriveCreditBalancePda(wallet.publicKey, programId);

      const accountInfo = await connection.getAccountInfo(creditBalance);
      if (!accountInfo) return 0;

      // Balance is stored after discriminator(8) + owner(32) = offset 40
      const balance = accountInfo.data.readBigUInt64LE(40);
      return Number(balance);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch balance');
      return null;
    }
  }, [wallet.publicKey, connection, programId]);

  return {
    purchaseWithSol,
    purchaseWithLoar,
    getBalance,
    isPending,
    error,
    txHash,
    creditConfig: creditConfig.toBase58(),
    tiers: CREDIT_TIER_AMOUNTS,
    programId: addresses.creditManager,
  };
}
