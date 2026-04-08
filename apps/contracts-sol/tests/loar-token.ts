import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { assert } from 'chai';

describe('loar_token', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LoarToken as Program<any>;
  const PROGRAM_ID = new PublicKey('LoarTokenxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

  const admin = provider.wallet;
  const treasury = Keypair.generate();
  const liquidityPool = Keypair.generate();
  const newLiquidityPool = Keypair.generate();
  const nonAdmin = Keypair.generate();
  const newAuthority = Keypair.generate();

  let configPda: PublicKey;
  let configBump: number;
  let mintPda: PublicKey;

  before(async () => {
    // Derive PDAs
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      program.programId
    );

    [mintPda] = PublicKey.findProgramAddressSync([Buffer.from('loar_mint')], program.programId);

    // Fund test accounts
    const airdropSig = await provider.connection.requestAirdrop(
      nonAdmin.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);
  });

  describe('initialize_config', () => {
    it('initializes config with treasury and liquidity pool', async () => {
      const tx = await program.methods
        .initializeConfig()
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          loarMint: mintPda,
          treasury: treasury.publicKey,
          liquidityPool: liquidityPool.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const configAccount = await program.account.config.fetch(configPda);
      assert.ok(configAccount.admin.equals(admin.publicKey));
      assert.ok(configAccount.treasury.equals(treasury.publicKey));
      assert.ok(configAccount.liquidityPool.equals(liquidityPool.publicKey));
      assert.equal(configAccount.totalMinted.toNumber(), 0);
    });
  });

  describe('mint_initial_distribution', () => {
    it('mints initial distribution (treasury 70%, team 30%) when total_minted == 0', async () => {
      const [treasuryAta] = PublicKey.findProgramAddressSync(
        [treasury.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPda.toBuffer()],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      const [teamAta] = PublicKey.findProgramAddressSync(
        [admin.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPda.toBuffer()],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      const tx = await program.methods
        .mintInitialDistribution()
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          loarMint: mintPda,
          treasuryTokenAccount: treasuryAta,
          teamTokenAccount: teamAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
        })
        .rpc();

      const configAccount = await program.account.config.fetch(configPda);
      assert.ok(
        configAccount.totalMinted.toNumber() > 0,
        'total_minted should be > 0 after distribution'
      );
    });

    it('cannot mint distribution twice', async () => {
      const [treasuryAta] = PublicKey.findProgramAddressSync(
        [treasury.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPda.toBuffer()],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      const [teamAta] = PublicKey.findProgramAddressSync(
        [admin.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPda.toBuffer()],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      try {
        await program.methods
          .mintInitialDistribution()
          .accounts({
            admin: admin.publicKey,
            config: configPda,
            loarMint: mintPda,
            treasuryTokenAccount: treasuryAta,
            teamTokenAccount: teamAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
          })
          .rpc();
        assert.fail('Expected error: distribution already minted');
      } catch (err: any) {
        assert.include(
          err.toString(),
          'AlreadyMinted',
          'Should reject duplicate mint distribution'
        );
      }
    });
  });

  describe('harvest_fees', () => {
    it('harvests fees (permissionless)', async () => {
      const [feeVault] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_vault')],
        program.programId
      );

      const [treasuryAta] = PublicKey.findProgramAddressSync(
        [treasury.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPda.toBuffer()],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      // Anyone can call harvest_fees — use nonAdmin as the payer
      const tx = await program.methods
        .harvestFees()
        .accounts({
          payer: nonAdmin.publicKey,
          config: configPda,
          feeVault: feeVault,
          treasuryTokenAccount: treasuryAta,
          loarMint: mintPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([nonAdmin])
        .rpc();

      assert.ok(tx, 'harvest_fees transaction should succeed');
    });
  });

  describe('set_liquidity_pool', () => {
    it('admin can set liquidity pool', async () => {
      const tx = await program.methods
        .setLiquidityPool(newLiquidityPool.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .rpc();

      const configAccount = await program.account.config.fetch(configPda);
      assert.ok(
        configAccount.liquidityPool.equals(newLiquidityPool.publicKey),
        'Liquidity pool should be updated'
      );
    });

    it('non-admin cannot set config', async () => {
      try {
        await program.methods
          .setLiquidityPool(Keypair.generate().publicKey)
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

  describe('transfer_authority', () => {
    it('admin can transfer authority', async () => {
      const tx = await program.methods
        .transferAuthority(newAuthority.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .rpc();

      const configAccount = await program.account.config.fetch(configPda);
      assert.ok(
        configAccount.admin.equals(newAuthority.publicKey),
        'Admin should be transferred to new authority'
      );
    });

    it('rejects zero address for transfer authority', async () => {
      try {
        await program.methods
          .transferAuthority(PublicKey.default)
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
  });
});
