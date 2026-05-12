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
import { Payment } from '../target/types/payment';

describe('payment', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Payment as Program<Payment>;
  const owner = provider.wallet as anchor.Wallet;

  const treasury = Keypair.generate();
  const creator = Keypair.generate();
  const intruder = Keypair.generate();

  let configPda: PublicKey;
  let solVaultPda: PublicKey;
  let loarVaultPda: PublicKey;
  let claimSolPda: PublicKey;
  let claimLoarPda: PublicKey;

  // Set up a classic SPL mint to stand in for $LOAR in tests (the program
  // uses `token_interface`, so it works against both classic and Token-2022).
  let loarMint: PublicKey;
  let payerLoarAta: PublicKey;
  let vaultLoarAta: PublicKey;
  let creatorLoarAta: PublicKey;
  let treasuryLoarAta: PublicKey;
  const LOAR_DECIMALS = 9;

  before(async () => {
    // Fund the secondary signers.
    for (const kp of [creator, intruder, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
    [solVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('sol_vault')], program.programId);
    [loarVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('loar_vault')],
      program.programId
    );
    [claimSolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('claim_sol'), creator.publicKey.toBuffer()],
      program.programId
    );
    [claimLoarPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('claim_loar'), creator.publicKey.toBuffer()],
      program.programId
    );
  });

  it('initializes config with treasury + default fee', async () => {
    await program.methods
      .initialize(treasury.publicKey, 250) // 2.5%
      .accounts({
        owner: owner.publicKey,
        config: configPda,
        solVault: solVaultPda,
        loarVault: loarVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const c = await program.account.config.fetch(configPda);
    expect(c.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(c.treasury.toBase58()).to.equal(treasury.publicKey.toBase58());
    expect(c.defaultFeeBps).to.equal(250);
    expect(c.paused).to.equal(false);
    expect(c.loarLocked).to.equal(false);
  });

  it('rejects fee above MAX_FEE_BPS on init', async () => {
    // Already initialized — try with a fresh program instance check via setDefaultFee path.
    let err: unknown;
    try {
      await program.methods
        .setDefaultFee(1500) // > 10%
        .accounts({ owner: owner.publicKey, config: configPda })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/FeeTooHigh/);
  });

  it('routes SOL with platform/creator split', async () => {
    const amount = new BN(1_000_000_000); // 1 SOL
    await program.methods
      .route(amount, null)
      .accounts({
        payer: owner.publicKey,
        creator: creator.publicKey,
        config: configPda,
        solVault: solVaultPda,
        claimSol: claimSolPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const claim = await program.account.claimSol.fetch(claimSolPda);
    const c = await program.account.config.fetch(configPda);
    // 2.5% fee on 1 SOL = 0.025 SOL platform, 0.975 SOL creator.
    expect(claim.amount.toString()).to.equal('975000000');
    expect(c.treasuryClaimableSol.toString()).to.equal('25000000');
  });

  it('rejects route while paused, allows claim', async () => {
    await program.methods.pause().accounts({ owner: owner.publicKey, config: configPda }).rpc();
    let err: unknown;
    try {
      await program.methods
        .route(new BN(1_000_000), null)
        .accounts({
          payer: owner.publicKey,
          creator: creator.publicKey,
          config: configPda,
          solVault: solVaultPda,
          claimSol: claimSolPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Paused/);

    // Claim is still allowed while paused (exit hatch).
    const before = await provider.connection.getBalance(creator.publicKey);
    await program.methods
      .claim()
      .accounts({
        creator: creator.publicKey,
        config: configPda,
        solVault: solVaultPda,
        claimSol: claimSolPda,
      })
      .signers([creator])
      .rpc();
    const after = await provider.connection.getBalance(creator.publicKey);
    expect(after - before).to.equal(975_000_000);

    await program.methods.unpause().accounts({ owner: owner.publicKey, config: configPda }).rpc();
  });

  it('rejects claim by non-creator', async () => {
    // Re-accumulate first.
    await program.methods
      .route(new BN(100_000_000), null)
      .accounts({
        payer: owner.publicKey,
        creator: creator.publicKey,
        config: configPda,
        solVault: solVaultPda,
        claimSol: claimSolPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let err: unknown;
    try {
      await program.methods
        .claim()
        .accounts({
          creator: intruder.publicKey,
          config: configPda,
          solVault: solVaultPda,
          claimSol: claimSolPda,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    // PDA seed mismatch — Anchor surfaces ConstraintSeeds, not our Unauthorized.
    expect(String(err)).to.match(/ConstraintSeeds|seeds constraint|Unauthorized/i);
  });

  it('owner claims treasury SOL', async () => {
    const before = await provider.connection.getBalance(treasury.publicKey);
    const c0 = await program.account.config.fetch(configPda);
    const accrued = c0.treasuryClaimableSol.toNumber();
    expect(accrued).to.be.greaterThan(0);

    await program.methods
      .claimTreasurySol()
      .accounts({
        owner: owner.publicKey,
        config: configPda,
        solVault: solVaultPda,
        treasury: treasury.publicKey,
      })
      .rpc();
    const after = await provider.connection.getBalance(treasury.publicKey);
    expect(after - before).to.equal(accrued);

    const c1 = await program.account.config.fetch(configPda);
    expect(c1.treasuryClaimableSol.toNumber()).to.equal(0);
  });

  it('rejects non-owner from owner-gated ops', async () => {
    let err: unknown;
    try {
      await program.methods
        .setDefaultFee(100)
        .accounts({ owner: intruder.publicKey, config: configPda })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Unauthorized|address constraint/i);
  });

  describe('SPL ($LOAR) flow', () => {
    before(async () => {
      // Create a stand-in classic SPL mint for $LOAR in tests.
      loarMint = await createMint(
        provider.connection,
        owner.payer,
        owner.publicKey, // mint authority
        owner.publicKey, // freeze authority
        LOAR_DECIMALS
      );

      const payerAtaAcc = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        owner.payer,
        loarMint,
        owner.publicKey
      );
      payerLoarAta = payerAtaAcc.address;
      await mintTo(
        provider.connection,
        owner.payer,
        loarMint,
        payerLoarAta,
        owner.publicKey,
        BigInt(10_000) * 10n ** BigInt(LOAR_DECIMALS)
      );

      // ATAs that Anchor will init_if_needed:
      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
      vaultLoarAta = getAssociatedTokenAddressSync(loarMint, loarVaultPda, true);
      creatorLoarAta = getAssociatedTokenAddressSync(loarMint, creator.publicKey);
      treasuryLoarAta = getAssociatedTokenAddressSync(loarMint, treasury.publicKey);

      await program.methods
        .setLoarMint(loarMint)
        .accounts({ owner: owner.publicKey, config: configPda })
        .rpc();
    });

    it('routes $LOAR with fee discount applied', async () => {
      await program.methods
        .setLoarFeeDiscount(50) // 0.5% off the SPL path
        .accounts({ owner: owner.publicKey, config: configPda })
        .rpc();

      const amount = new BN(1_000_000_000); // 1 token (9 decimals)
      await program.methods
        .routeSpl(amount, null)
        .accounts({
          payer: owner.publicKey,
          creator: creator.publicKey,
          config: configPda,
          loarVault: loarVaultPda,
          loarMint,
          payerAta: payerLoarAta,
          vaultAta: vaultLoarAta,
          claimLoar: claimLoarPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // default 2.5% - 0.5% discount = 2% effective fee = 20 bps off 1B = 20_000_000.
      const claim = await program.account.claimLoar.fetch(claimLoarPda);
      const c = await program.account.config.fetch(configPda);
      expect(claim.amount.toString()).to.equal('980000000');
      expect(c.treasuryClaimableLoar.toString()).to.equal('20000000');
    });

    it('creator claims $LOAR to their ATA', async () => {
      await program.methods
        .claimSpl()
        .accounts({
          creator: creator.publicKey,
          config: configPda,
          loarVault: loarVaultPda,
          loarMint,
          claimLoar: claimLoarPda,
          vaultAta: vaultLoarAta,
          creatorAta: creatorLoarAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      const acc = await provider.connection.getTokenAccountBalance(creatorLoarAta);
      expect(acc.value.amount).to.equal('980000000');
      const claim = await program.account.claimLoar.fetch(claimLoarPda);
      expect(claim.amount.toString()).to.equal('0');
    });

    it('locks LOAR mint and blocks further updates', async () => {
      await program.methods
        .lockLoarMint()
        .accounts({ owner: owner.publicKey, config: configPda })
        .rpc();

      let err: unknown;
      try {
        await program.methods
          .setLoarMint(Keypair.generate().publicKey)
          .accounts({ owner: owner.publicKey, config: configPda })
          .rpc();
      } catch (e) {
        err = e;
      }
      expect(String(err)).to.match(/LoarMintLocked/);
    });
  });

  describe('ownership transfer', () => {
    const newOwner = Keypair.generate();

    before(async () => {
      const sig = await provider.connection.requestAirdrop(newOwner.publicKey, 1e9);
      await provider.connection.confirmTransaction(sig);
    });

    it('proposes + accepts new owner', async () => {
      await program.methods
        .transferOwnership(newOwner.publicKey)
        .accounts({ owner: owner.publicKey, config: configPda })
        .rpc();
      let c = await program.account.config.fetch(configPda);
      expect(c.pendingOwner.toBase58()).to.equal(newOwner.publicKey.toBase58());

      await program.methods
        .acceptOwnership()
        .accounts({ newOwner: newOwner.publicKey, config: configPda })
        .signers([newOwner])
        .rpc();
      c = await program.account.config.fetch(configPda);
      expect(c.owner.toBase58()).to.equal(newOwner.publicKey.toBase58());
      expect(c.pendingOwner.toBase58()).to.equal(PublicKey.default.toBase58());
    });

    it('rejects accept_ownership by anyone other than pending_owner', async () => {
      // Already accepted; propose again to set up the case.
      await program.methods
        .transferOwnership(owner.publicKey)
        .accounts({ owner: newOwner.publicKey, config: configPda })
        .signers([newOwner])
        .rpc();
      let err: unknown;
      try {
        await program.methods
          .acceptOwnership()
          .accounts({ newOwner: intruder.publicKey, config: configPda })
          .signers([intruder])
          .rpc();
      } catch (e) {
        err = e;
      }
      expect(String(err)).to.match(/Unauthorized/);

      // Real accept restores the original owner for the rest of the suite.
      await program.methods
        .acceptOwnership()
        .accounts({ newOwner: owner.publicKey, config: configPda })
        .rpc();
    });
  });
});
