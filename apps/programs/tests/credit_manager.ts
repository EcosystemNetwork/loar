import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import { expect } from 'chai';
import { CreditManager } from '../target/types/credit_manager';

describe('credit_manager', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CreditManager as Program<CreditManager>;
  const admin = provider.wallet as anchor.Wallet;

  const platform = Keypair.generate();
  const buyer = Keypair.generate();
  const recipient = Keypair.generate();

  let configPda: PublicKey;
  let solVaultPda: PublicKey;
  let loarVaultPda: PublicKey;
  let loarVaultAta: PublicKey;
  let loarMint: PublicKey;
  let package1Pda: PublicKey;
  let userCreditsPda: PublicKey;
  let recipientCreditsPda: PublicKey;

  const DAILY_GRANT_LIMIT = new BN(10_000_000);
  const MAX_GRANT_PER_USER = new BN(100_000);
  const SOL_PRICE = new BN(LAMPORTS_PER_SOL / 100); // 0.01 SOL
  const CREDITS = new BN(1000);
  const BONUS = new BN(100);

  before(async () => {
    for (const kp of [platform, buyer, recipient]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('credit_manager_config')],
      program.programId
    );
    [solVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('credit_sol_vault')],
      program.programId
    );
    [loarVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('credit_loar_vault')],
      program.programId
    );

    loarMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      9
    );
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    loarVaultAta = getAssociatedTokenAddressSync(loarMint, loarVaultPda, true);

    [package1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('package'), new anchor.BN(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
    [userCreditsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_credits'), buyer.publicKey.toBuffer()],
      program.programId
    );
    [recipientCreditsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_credits'), recipient.publicKey.toBuffer()],
      program.programId
    );
  });

  it('initializes config', async () => {
    await program.methods
      .initialize(platform.publicKey, DAILY_GRANT_LIMIT, MAX_GRANT_PER_USER)
      .accountsPartial({
        admin: admin.publicKey,
        loarMint,
        config: configPda,
        solVault: solVaultPda,
        loarVault: loarVaultPda,
        loarVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.platform.toBase58()).to.equal(platform.publicKey.toBase58());
    expect(c.dailyGrantLimit.toString()).to.equal(DAILY_GRANT_LIMIT.toString());
  });

  it('admin creates a SOL-priced package', async () => {
    await program.methods
      .createPackage('starter', CREDITS, SOL_PRICE, new BN(0), BONUS)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        package: package1Pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const p = await program.account.package.fetch(package1Pda);
    expect(p.id.toString()).to.equal('1');
    expect(p.credits.toString()).to.equal(CREDITS.toString());
    expect(p.bonusCredits.toString()).to.equal(BONUS.toString());
    expect(p.active).to.equal(true);
  });

  it('buyer purchases with SOL: balance = credits + bonus', async () => {
    await program.methods
      .purchaseWithSol(new BN(1))
      .accountsPartial({
        buyer: buyer.publicKey,
        config: configPda,
        package: package1Pda,
        solVault: solVaultPda,
        userCredits: userCreditsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    const u = await program.account.userCredits.fetch(userCreditsPda);
    expect(u.balance.toString()).to.equal(CREDITS.add(BONUS).toString());
    expect(u.totalPurchased.toString()).to.equal(CREDITS.toString());
    expect(u.totalBonusReceived.toString()).to.equal(BONUS.toString());
  });

  it('platform spends credits, balance decrements', async () => {
    const spendAmount = new BN(50);
    await program.methods
      .spendCredits(spendAmount, 'image-gen')
      .accountsPartial({
        platform: platform.publicKey,
        config: configPda,
        userCredits: userCreditsPda,
      })
      .signers([platform])
      .rpc();
    const u = await program.account.userCredits.fetch(userCreditsPda);
    expect(u.balance.toString()).to.equal(CREDITS.add(BONUS).sub(spendAmount).toString());
    expect(u.totalSpent.toString()).to.equal(spendAmount.toString());
  });

  it('platform grants credits (cumulative cap enforced via granted_total)', async () => {
    const grantAmount = new BN(500);
    await program.methods
      .grantCredits(grantAmount, 'welcome bonus')
      .accountsPartial({
        platform: platform.publicKey,
        recipient: recipient.publicKey,
        payer: platform.publicKey,
        config: configPda,
        userCredits: recipientCreditsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([platform])
      .rpc();
    const u = await program.account.userCredits.fetch(recipientCreditsPda);
    expect(u.balance.toString()).to.equal(grantAmount.toString());
    expect(u.grantedTotal.toString()).to.equal(grantAmount.toString());
  });

  it('rejects grant exceeding max_grant_per_user (cumulative, not balance)', async () => {
    // Already granted 500; max is 100k. Try to grant 99_600 — should work.
    // Then try to grant 1000 more — should fail because cumulative 100_600 > 100_000.
    await program.methods
      .grantCredits(new BN(99_500), 'big grant')
      .accountsPartial({
        platform: platform.publicKey,
        recipient: recipient.publicKey,
        payer: platform.publicKey,
        config: configPda,
        userCredits: recipientCreditsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([platform])
      .rpc();

    let err: unknown;
    try {
      await program.methods
        .grantCredits(new BN(1000), 'overflow')
        .accountsPartial({
          platform: platform.publicKey,
          recipient: recipient.publicKey,
          payer: platform.publicKey,
          config: configPda,
          userCredits: recipientCreditsPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([platform])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/MaxGrantPerUserExceeded/);
  });

  it('rejects spend by non-platform', async () => {
    let err: unknown;
    try {
      await program.methods
        .spendCredits(new BN(10), 'x')
        .accountsPartial({
          platform: buyer.publicKey, // not platform
          config: configPda,
          userCredits: userCreditsPda,
        })
        .signers([buyer])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/NotPlatform/);
  });
});
