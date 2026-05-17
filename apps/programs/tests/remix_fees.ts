import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
import { expect } from 'chai';
import { RemixFees } from '../target/types/remix_fees';
import { Universe } from '../target/types/universe';

describe('remix_fees', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.RemixFees as Program<RemixFees>;
  const universeProgram = anchor.workspace.Universe as Program<Universe>;
  const admin = provider.wallet as anchor.Wallet;

  const creator = Keypair.generate();
  const remixer = Keypair.generate();
  const treasury = Keypair.generate();
  const lp = Keypair.generate();

  const contentHashUniverse = Buffer.alloc(32, 0x33);
  const plotHash = Buffer.alloc(32, 0x44);
  const remixContentHash = Buffer.alloc(32, 0x55);
  const Visibility = { Public: { public: {} } };

  let configPda: PublicKey;
  let universeConfigPda: PublicKey;
  let universePda: PublicKey;
  let loarMint: PublicKey;
  let remixerAta: PublicKey;
  let creatorAta: PublicKey;
  let lpAta: PublicKey;
  let treasuryAta: PublicKey;
  let universeFeePda: PublicKey;

  const DEFAULT_FEE = new BN(100_000_000_000n.toString()); // 100 LOAR @ 9 decimals
  const MIN_FEE = new BN(1_000_000_000n.toString());

  before(async () => {
    for (const kp of [creator, remixer, treasury, lp]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 3 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    // Universe setup so the program can read .creator live.
    [universeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe_config')],
      universeProgram.programId
    );
    try {
      await universeProgram.methods
        .initializeConfig()
        .accountsPartial({
          admin: admin.publicKey,
          config: universeConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      /* already initialized */
    }
    [universePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creator.publicKey.toBuffer(), contentHashUniverse],
      universeProgram.programId
    );
    await universeProgram.methods
      .initializeUniverse([...contentHashUniverse], [...plotHash], Visibility.Public)
      .accountsPartial({
        creator: creator.publicKey,
        universe: universePda,
        config: universeConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Token setup.
    loarMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      9
    );
    remixerAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        remixer.publicKey
      )
    ).address;
    creatorAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        creator.publicKey
      )
    ).address;
    lpAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        lp.publicKey
      )
    ).address;
    treasuryAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        treasury.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      (admin as any).payer,
      loarMint,
      remixerAta,
      admin.publicKey,
      Number(DEFAULT_FEE.toString()) * 5
    );

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('remix_fees_config')],
      program.programId
    );
    [universeFeePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe_fee'), universePda.toBuffer()],
      program.programId
    );
  });

  it('initializes config with 70/20/10 split', async () => {
    await program.methods
      .initializeConfig(treasury.publicKey, lp.publicKey, DEFAULT_FEE, MIN_FEE, 7000, 2000, 1000)
      .accountsPartial({
        admin: admin.publicKey,
        loarMint,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.creatorShareBps).to.equal(7000);
    expect(c.lpShareBps).to.equal(2000);
    expect(c.treasuryShareBps).to.equal(1000);
  });

  it('rejects split bps not summing to 10000', async () => {
    let err: unknown;
    try {
      await program.methods
        .setSplitBps(7000, 2000, 500) // 9500 total
        .accountsPartial({ admin: admin.publicKey, config: configPda })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/InvalidSplitTotal/);
  });

  it('charges remix fee with 3-way split using default fee', async () => {
    const remixerBefore = BigInt(
      (await getAccount(provider.connection, remixerAta)).amount.toString()
    );
    const creatorBefore = BigInt(
      (await getAccount(provider.connection, creatorAta)).amount.toString()
    );
    const lpBefore = BigInt((await getAccount(provider.connection, lpAta)).amount.toString());
    const treasuryBefore = BigInt(
      (await getAccount(provider.connection, treasuryAta)).amount.toString()
    );

    await program.methods
      .chargeRemixFee(universePda, [...remixContentHash])
      .accountsPartial({
        remixer: remixer.publicKey,
        config: configPda,
        loarMint,
        universeAccount: universePda,
        universeFee: universeFeePda,
        remixerAta,
        originalCreator: creator.publicKey,
        creatorAta,
        lpAta,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([remixer])
      .rpc();

    const remixerAfter = BigInt(
      (await getAccount(provider.connection, remixerAta)).amount.toString()
    );
    const creatorAfter = BigInt(
      (await getAccount(provider.connection, creatorAta)).amount.toString()
    );
    const lpAfter = BigInt((await getAccount(provider.connection, lpAta)).amount.toString());
    const treasuryAfter = BigInt(
      (await getAccount(provider.connection, treasuryAta)).amount.toString()
    );

    const fee = BigInt(DEFAULT_FEE.toString());
    const creatorCut = (fee * 7000n) / 10000n;
    const lpCut = (fee * 2000n) / 10000n;
    const treasuryCut = fee - creatorCut - lpCut; // rounding dust

    expect((remixerBefore - remixerAfter).toString()).to.equal(fee.toString());
    expect((creatorAfter - creatorBefore).toString()).to.equal(creatorCut.toString());
    expect((lpAfter - lpBefore).toString()).to.equal(lpCut.toString());
    expect((treasuryAfter - treasuryBefore).toString()).to.equal(treasuryCut.toString());
  });

  it('rejects charge with wrong original_creator (rerouted payout guard)', async () => {
    const wrongCreator = Keypair.generate();
    const wrongAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        wrongCreator.publicKey
      )
    ).address;
    let err: unknown;
    try {
      await program.methods
        .chargeRemixFee(universePda, [...Buffer.alloc(32, 0x66)])
        .accountsPartial({
          remixer: remixer.publicKey,
          config: configPda,
          loarMint,
          universeAccount: universePda,
          universeFee: universeFeePda,
          remixerAta,
          originalCreator: wrongCreator.publicKey,
          creatorAta: wrongAta,
          lpAta,
          treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([remixer])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/CreatorMismatch/);
  });
});
