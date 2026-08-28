import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { expect } from 'chai';
import { FeeLocker } from '../target/types/fee_locker';

describe('fee_locker', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.FeeLocker as Program<FeeLocker>;
  const admin = provider.wallet as anchor.Wallet;

  const depositorKp = Keypair.generate();
  const feeOwner = Keypair.generate();
  const intruder = Keypair.generate();

  let configPda: PublicKey;
  let depositorPda: PublicKey;
  let mint: PublicKey;
  let depositorAta: PublicKey;
  let feeOwnerAta: PublicKey;
  let vaultAta: PublicKey;
  let vaultAuthority: PublicKey;
  let feeBalancePda: PublicKey;

  const DECIMALS = 6;
  const DEPOSIT_AMOUNT = 1_000_000n; // 1.0 with 6 decimals

  before(async () => {
    for (const kp of [depositorKp, feeOwner, intruder]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_locker_config')],
      program.programId
    );
    [depositorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_locker_depositor'), depositorKp.publicKey.toBuffer()],
      program.programId
    );

    // Create a test mint.
    mint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      DECIMALS
    );
    const depositorAtaAcc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      mint,
      depositorKp.publicKey
    );
    depositorAta = depositorAtaAcc.address;
    const feeOwnerAtaAcc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      mint,
      feeOwner.publicKey
    );
    feeOwnerAta = feeOwnerAtaAcc.address;

    // Mint to depositor so it has something to store as fees.
    await mintTo(
      provider.connection,
      (admin as any).payer,
      mint,
      depositorAta,
      admin.publicKey,
      Number(DEPOSIT_AMOUNT) * 10
    );

    [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_vault'), mint.toBuffer()],
      program.programId
    );
    [feeBalancePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_balance'), feeOwner.publicKey.toBuffer(), mint.toBuffer()],
      program.programId
    );
    // vaultAta is the ATA owned by vault authority.
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    vaultAta = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
  });

  it('initializes config', async () => {
    await program.methods
      .initializeConfig()
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.admin.toBase58()).to.equal(admin.publicKey.toBase58());
  });

  it('rejects store_fees from unwhitelisted caller', async () => {
    let err: unknown;
    try {
      await program.methods
        .storeFees(feeOwner.publicKey, new BN(DEPOSIT_AMOUNT.toString()))
        .accountsPartial({
          depositorSigner: depositorKp.publicKey,
          config: configPda,
          depositor: depositorPda, // doesn't exist yet
          mint,
          vaultAuthority,
          vaultAta,
          depositorAta,
          feeBalance: feeBalancePda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositorKp])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/AccountNotInitialized|NotActiveDepositor/);
  });

  it('admin adds depositor + deposits fees', async () => {
    await program.methods
      .addDepositor(depositorKp.publicKey)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        depositor: depositorPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .storeFees(feeOwner.publicKey, new BN(DEPOSIT_AMOUNT.toString()))
      .accountsPartial({
        depositorSigner: depositorKp.publicKey,
        config: configPda,
        depositor: depositorPda,
        mint,
        vaultAuthority,
        vaultAta,
        depositorAta,
        feeBalance: feeBalancePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositorKp])
      .rpc();

    const bal = await program.account.feeBalance.fetch(feeBalancePda);
    expect(bal.amount.toString()).to.equal(DEPOSIT_AMOUNT.toString());
    expect(bal.totalDeposited.toString()).to.equal(DEPOSIT_AMOUNT.toString());
  });

  it('fee_owner claims full balance', async () => {
    await program.methods
      .claim()
      .accountsPartial({
        feeOwner: feeOwner.publicKey,
        mint,
        vaultAuthority,
        vaultAta,
        feeOwnerAta,
        feeBalance: feeBalancePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([feeOwner])
      .rpc();
    const bal = await program.account.feeBalance.fetch(feeBalancePda);
    expect(bal.amount.toString()).to.equal('0');
    expect(bal.totalClaimed.toString()).to.equal(DEPOSIT_AMOUNT.toString());
  });

  it('rejects claim by non-owner', async () => {
    // Re-deposit so there's something to (try to) claim.
    await program.methods
      .storeFees(feeOwner.publicKey, new BN(DEPOSIT_AMOUNT.toString()))
      .accountsPartial({
        depositorSigner: depositorKp.publicKey,
        config: configPda,
        depositor: depositorPda,
        mint,
        vaultAuthority,
        vaultAta,
        depositorAta,
        feeBalance: feeBalancePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositorKp])
      .rpc();

    const { getOrCreateAssociatedTokenAccount } = await import('@solana/spl-token');
    const intruderAtaAcc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      mint,
      intruder.publicKey
    );
    let err: unknown;
    try {
      await program.methods
        .claim()
        .accountsPartial({
          feeOwner: intruder.publicKey,
          mint,
          vaultAuthority,
          vaultAta,
          feeOwnerAta: intruderAtaAcc.address,
          feeBalance: feeBalancePda, // same PDA — intruder doesn't own it
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Unauthorized|ConstraintSeeds/);
  });
});
