import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from 'chai';

describe('payment_router', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PaymentRouter as Program<any>;
  const PROGRAM_ID = new PublicKey('PayRtrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

  const admin = provider.wallet;
  const treasury = Keypair.generate();
  const recipient = Keypair.generate();
  const payer = Keypair.generate();
  const nonAdmin = Keypair.generate();
  const newTreasury = Keypair.generate();

  let configPda: PublicKey;

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);

    // Fund test accounts
    const airdrops = [payer, nonAdmin].map(async (kp) => {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      return provider.connection.confirmTransaction(sig);
    });
    await Promise.all(airdrops);
  });

  describe('initialize', () => {
    it('initializes with platform fee (<= 5000 bps)', async () => {
      const platformFeeBps = 1000; // 10%

      const tx = await program.methods
        .initialize(platformFeeBps)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.ok(config.admin.equals(admin.publicKey));
      assert.ok(config.treasury.equals(treasury.publicKey));
      assert.equal(config.platformFeeBps, 1000);
    });

    it('rejects fee > 50% (5000 bps)', async () => {
      // This would fail on a second init anyway, but tests the validation logic
      const [tempConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('config_test')],
        program.programId
      );

      try {
        await program.methods
          .initialize(5001)
          .accounts({
            admin: admin.publicKey,
            config: configPda,
            treasury: treasury.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail('Expected error: fee exceeds maximum');
      } catch (err: any) {
        assert.include(err.toString(), 'FeeTooHigh');
      }
    });
  });

  describe('route_payment', () => {
    it('correct fee split: fee to treasury, remainder to recipient', async () => {
      const paymentAmount = new anchor.BN(1_000_000_000); // 1 SOL
      const platformFeeBps = 1000; // 10%
      const expectedFee = (paymentAmount.toNumber() * platformFeeBps) / 10000; // 0.1 SOL
      const expectedRecipientAmount = paymentAmount.toNumber() - expectedFee;

      const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);
      const recipientBefore = await provider.connection.getBalance(recipient.publicKey);

      await program.methods
        .routePayment(paymentAmount)
        .accounts({
          payer: payer.publicKey,
          config: configPda,
          treasury: treasury.publicKey,
          recipient: recipient.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
      const recipientAfter = await provider.connection.getBalance(recipient.publicKey);

      assert.equal(
        treasuryAfter - treasuryBefore,
        expectedFee,
        'Treasury should receive the platform fee'
      );
      assert.equal(
        recipientAfter - recipientBefore,
        expectedRecipientAmount,
        'Recipient should receive amount minus fee'
      );
    });

    it('rejects zero amount', async () => {
      try {
        await program.methods
          .routePayment(new anchor.BN(0))
          .accounts({
            payer: payer.publicKey,
            config: configPda,
            treasury: treasury.publicKey,
            recipient: recipient.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer])
          .rpc();
        assert.fail('Expected error: zero amount');
      } catch (err: any) {
        assert.include(err.toString(), 'ZeroAmount');
      }
    });
  });

  describe('route_split_payment', () => {
    it('validates shares sum to 10000', async () => {
      const recipient1 = Keypair.generate();
      const recipient2 = Keypair.generate();

      // Shares that don't sum to 10000
      const shares = [
        { recipient: recipient1.publicKey, share: 5000 },
        { recipient: recipient2.publicKey, share: 4000 },
      ];

      try {
        await program.methods
          .routeSplitPayment(new anchor.BN(1_000_000_000), shares)
          .accounts({
            payer: payer.publicKey,
            config: configPda,
            treasury: treasury.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(
            shares.map((s) => ({
              pubkey: s.recipient,
              isSigner: false,
              isWritable: true,
            }))
          )
          .signers([payer])
          .rpc();
        assert.fail('Expected error: shares must sum to 10000');
      } catch (err: any) {
        assert.include(err.toString(), 'InvalidShares');
      }
    });

    it('dust-safe: last recipient gets remainder', async () => {
      const recipient1 = Keypair.generate();
      const recipient2 = Keypair.generate();
      const recipient3 = Keypair.generate();

      // Use an amount that creates rounding dust: 1_000_003 with 3 recipients
      const paymentAmount = new anchor.BN(1_000_003);
      const platformFeeBps = 1000; // 10%
      const afterFee = 1_000_003 - Math.floor((1_000_003 * platformFeeBps) / 10000);

      const shares = [
        { recipient: recipient1.publicKey, share: 3333 },
        { recipient: recipient2.publicKey, share: 3333 },
        { recipient: recipient3.publicKey, share: 3334 },
      ];

      const balancesBefore = await Promise.all(
        [recipient1, recipient2, recipient3].map((r) => provider.connection.getBalance(r.publicKey))
      );

      await program.methods
        .routeSplitPayment(paymentAmount, shares)
        .accounts({
          payer: payer.publicKey,
          config: configPda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(
          shares.map((s) => ({
            pubkey: s.recipient,
            isSigner: false,
            isWritable: true,
          }))
        )
        .signers([payer])
        .rpc();

      const balancesAfter = await Promise.all(
        [recipient1, recipient2, recipient3].map((r) => provider.connection.getBalance(r.publicKey))
      );

      const totalDistributed =
        balancesAfter[0] -
        balancesBefore[0] +
        (balancesAfter[1] - balancesBefore[1]) +
        (balancesAfter[2] - balancesBefore[2]);

      assert.equal(
        totalDistributed,
        afterFee,
        'Total distributed to recipients should equal payment minus fee (dust-safe)'
      );
    });

    it('validates recipient accounts match', async () => {
      const recipient1 = Keypair.generate();
      const recipient2 = Keypair.generate();
      const wrongRecipient = Keypair.generate();

      const shares = [
        { recipient: recipient1.publicKey, share: 5000 },
        { recipient: recipient2.publicKey, share: 5000 },
      ];

      try {
        await program.methods
          .routeSplitPayment(new anchor.BN(1_000_000), shares)
          .accounts({
            payer: payer.publicKey,
            config: configPda,
            treasury: treasury.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts([
            {
              pubkey: recipient1.publicKey,
              isSigner: false,
              isWritable: true,
            },
            {
              // Wrong account — doesn't match shares[1].recipient
              pubkey: wrongRecipient.publicKey,
              isSigner: false,
              isWritable: true,
            },
          ])
          .signers([payer])
          .rpc();
        assert.fail('Expected error: recipient mismatch');
      } catch (err: any) {
        assert.include(err.toString(), 'RecipientMismatch');
      }
    });
  });

  describe('admin settings', () => {
    it('admin can set platform fee (max 5000 bps)', async () => {
      await program.methods
        .setPlatformFee(2500)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.equal(config.platformFeeBps, 2500);
    });

    it('rejects fee > 50%', async () => {
      try {
        await program.methods
          .setPlatformFee(5001)
          .accounts({
            admin: admin.publicKey,
            config: configPda,
          })
          .rpc();
        assert.fail('Expected error: fee too high');
      } catch (err: any) {
        assert.include(err.toString(), 'FeeTooHigh');
      }
    });

    it('admin can set treasury', async () => {
      await program.methods
        .setTreasury(newTreasury.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.ok(config.treasury.equals(newTreasury.publicKey));
    });

    it('rejects zero address for treasury', async () => {
      try {
        await program.methods
          .setTreasury(PublicKey.default)
          .accounts({
            admin: admin.publicKey,
            config: configPda,
          })
          .rpc();
        assert.fail('Expected error: zero address');
      } catch (err: any) {
        assert.include(err.toString(), 'ZeroAddress');
      }
    });

    it('non-admin cannot update config', async () => {
      try {
        await program.methods
          .setPlatformFee(100)
          .accounts({
            admin: nonAdmin.publicKey,
            config: configPda,
          })
          .signers([nonAdmin])
          .rpc();
        assert.fail('Expected error: unauthorized');
      } catch (err: any) {
        assert.include(err.toString(), 'Unauthorized');
      }
    });
  });
});
