import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from 'chai';

describe('credit_manager', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CreditManager as Program<any>;
  const PROGRAM_ID = new PublicKey('CrdMgrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

  const admin = provider.wallet;
  const loarMint = Keypair.generate();
  const backendSigner = Keypair.generate();
  const newBackendSigner = Keypair.generate();
  const buyer = Keypair.generate();
  const unauthorizedSigner = Keypair.generate();

  let configPda: PublicKey;
  let creditAccountPda: PublicKey;

  // Starter tier: 100 credits, 540_000 lamports
  const STARTER_CREDITS = 100;
  const STARTER_PRICE_LAMPORTS = new anchor.BN(540_000);

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);

    [creditAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('credits'), buyer.publicKey.toBuffer()],
      program.programId
    );

    // Fund test accounts
    const airdrops = [buyer, backendSigner, unauthorizedSigner, newBackendSigner].map(
      async (kp) => {
        const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
        return provider.connection.confirmTransaction(sig);
      }
    );
    await Promise.all(airdrops);
  });

  describe('initialize_config', () => {
    it('initializes config with loar_mint and backend_signer', async () => {
      const tx = await program.methods
        .initializeConfig(loarMint.publicKey, backendSigner.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.ok(config.admin.equals(admin.publicKey));
      assert.ok(config.loarMint.equals(loarMint.publicKey));
      assert.ok(config.backendSigner.equals(backendSigner.publicKey));
    });
  });

  describe('purchase_credits', () => {
    it('purchases credits with SOL (Starter tier = 100 credits, 540_000 lamports)', async () => {
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault')],
        program.programId
      );

      const tx = await program.methods
        .purchaseCredits(0) // tier 0 = Starter
        .accounts({
          buyer: buyer.publicKey,
          config: configPda,
          creditAccount: creditAccountPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const credits = await program.account.creditAccount.fetch(creditAccountPda);
      assert.ok(credits.owner.equals(buyer.publicKey));
      assert.equal(
        credits.balance.toNumber(),
        STARTER_CREDITS,
        'Should have 100 credits after Starter purchase'
      );
    });

    it('credit balance updates correctly on additional purchase', async () => {
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault')],
        program.programId
      );

      const creditsBefore = await program.account.creditAccount.fetch(creditAccountPda);
      const balanceBefore = creditsBefore.balance.toNumber();

      await program.methods
        .purchaseCredits(0) // another Starter purchase
        .accounts({
          buyer: buyer.publicKey,
          config: configPda,
          creditAccount: creditAccountPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const creditsAfter = await program.account.creditAccount.fetch(creditAccountPda);
      assert.equal(
        creditsAfter.balance.toNumber(),
        balanceBefore + STARTER_CREDITS,
        'Credits should accumulate on repeated purchases'
      );
    });
  });

  describe('deduct_credits', () => {
    it('backend_signer can deduct credits', async () => {
      const deductAmount = new anchor.BN(10);

      const creditsBefore = await program.account.creditAccount.fetch(creditAccountPda);
      const balanceBefore = creditsBefore.balance.toNumber();

      await program.methods
        .deductCredits(deductAmount)
        .accounts({
          authority: backendSigner.publicKey,
          config: configPda,
          creditAccount: creditAccountPda,
          owner: buyer.publicKey,
        })
        .signers([backendSigner])
        .rpc();

      const creditsAfter = await program.account.creditAccount.fetch(creditAccountPda);
      assert.equal(
        creditsAfter.balance.toNumber(),
        balanceBefore - deductAmount.toNumber(),
        'Balance should decrease by deduct amount'
      );
    });

    it('admin can also deduct credits', async () => {
      const deductAmount = new anchor.BN(5);

      const creditsBefore = await program.account.creditAccount.fetch(creditAccountPda);
      const balanceBefore = creditsBefore.balance.toNumber();

      await program.methods
        .deductCredits(deductAmount)
        .accounts({
          authority: admin.publicKey,
          config: configPda,
          creditAccount: creditAccountPda,
          owner: buyer.publicKey,
        })
        .rpc();

      const creditsAfter = await program.account.creditAccount.fetch(creditAccountPda);
      assert.equal(
        creditsAfter.balance.toNumber(),
        balanceBefore - deductAmount.toNumber(),
        'Admin should also be able to deduct credits'
      );
    });

    it('rejects deduct if insufficient credits', async () => {
      const credits = await program.account.creditAccount.fetch(creditAccountPda);
      const excessiveAmount = new anchor.BN(credits.balance.toNumber() + 1);

      try {
        await program.methods
          .deductCredits(excessiveAmount)
          .accounts({
            authority: backendSigner.publicKey,
            config: configPda,
            creditAccount: creditAccountPda,
            owner: buyer.publicKey,
          })
          .signers([backendSigner])
          .rpc();
        assert.fail('Expected error: insufficient credits');
      } catch (err: any) {
        assert.include(err.toString(), 'InsufficientCredits');
      }
    });

    it('unauthorized signer cannot deduct', async () => {
      try {
        await program.methods
          .deductCredits(new anchor.BN(1))
          .accounts({
            authority: unauthorizedSigner.publicKey,
            config: configPda,
            creditAccount: creditAccountPda,
            owner: buyer.publicKey,
          })
          .signers([unauthorizedSigner])
          .rpc();
        assert.fail('Expected error: unauthorized');
      } catch (err: any) {
        assert.include(err.toString(), 'Unauthorized');
      }
    });
  });

  describe('admin settings', () => {
    it('admin can set backend signer', async () => {
      await program.methods
        .setBackendSigner(newBackendSigner.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.ok(
        config.backendSigner.equals(newBackendSigner.publicKey),
        'Backend signer should be updated'
      );
    });

    it('admin can set margins with caps (max 50% margin, max 20% bonus)', async () => {
      const marginBps = 3000; // 30%
      const bonusBps = 1500; // 15%

      await program.methods
        .setMargins(marginBps, bonusBps)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.equal(config.marginBps, 3000);
      assert.equal(config.bonusBps, 1500);
    });

    it('rejects margin exceeding 50%', async () => {
      try {
        await program.methods
          .setMargins(5001, 1000) // margin > 50%
          .accounts({
            admin: admin.publicKey,
            config: configPda,
          })
          .rpc();
        assert.fail('Expected error: margin too high');
      } catch (err: any) {
        assert.include(err.toString(), 'MarginTooHigh');
      }
    });

    it('rejects bonus exceeding 20%', async () => {
      try {
        await program.methods
          .setMargins(3000, 2001) // bonus > 20%
          .accounts({
            admin: admin.publicKey,
            config: configPda,
          })
          .rpc();
        assert.fail('Expected error: bonus too high');
      } catch (err: any) {
        assert.include(err.toString(), 'BonusTooHigh');
      }
    });
  });
});
