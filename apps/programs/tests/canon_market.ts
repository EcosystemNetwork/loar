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
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { expect } from 'chai';
import { CanonMarket } from '../target/types/canon_market';
import { Universe } from '../target/types/universe';
import { BondingCurve } from '../target/types/bonding_curve';

describe('canon_market', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CanonMarket as Program<CanonMarket>;
  const universeProgram = anchor.workspace.Universe as Program<Universe>;
  const bondingCurveProgram = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const admin = provider.wallet as anchor.Wallet;

  const creator = Keypair.generate();
  const submitter = Keypair.generate();
  const voter = Keypair.generate();
  const treasury = Keypair.generate();

  const contentHashUniverse = Buffer.alloc(32, 0x91);
  const plotHash = Buffer.alloc(32, 0x92);
  const submissionContent = Buffer.alloc(32, 0x93);
  const Visibility = { Public: { public: {} } };

  let universePda: PublicKey;
  let universeConfigPda: PublicKey;
  let tokenMint: PublicKey;
  let canonConfigPda: PublicKey;
  let curvePda: PublicKey;
  let tokenVaultAuth: PublicKey;
  let tokenVaultAta: PublicKey;
  let curveSolVaultPda: PublicKey;
  let voterAta: PublicKey;

  const SUBMISSION_FEE = new BN(LAMPORTS_PER_SOL / 100); // 0.01 SOL
  const VOTING_PERIOD = new BN(3600); // 1h
  const QUORUM_BPS = 1000; // 10%
  const VOTER_TOKEN_AMOUNT = 100_000n;

  before(async () => {
    for (const kp of [creator, submitter, voter, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    // Universe.
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
      /* idempotent */
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

    // Universe token + bonding curve (the curve provides token_mint to canon).
    tokenMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      0
    );
    [curvePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve'), universePda.toBuffer()],
      bondingCurveProgram.programId
    );
    [tokenVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve_token_vault'), universePda.toBuffer()],
      bondingCurveProgram.programId
    );
    [curveSolVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve_sol_vault'), universePda.toBuffer()],
      bondingCurveProgram.programId
    );
    tokenVaultAta = getAssociatedTokenAddressSync(tokenMint, tokenVaultAuth, true);
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      tokenMint,
      tokenVaultAuth,
      true
    );
    await mintTo(
      provider.connection,
      (admin as any).payer,
      tokenMint,
      tokenVaultAta,
      admin.publicKey,
      1_000_000_000
    );
    await bondingCurveProgram.methods
      .initializeCurve(new BN(1_000_000_000), new BN(10 * LAMPORTS_PER_SOL), 2000)
      .accountsPartial({
        creator: creator.publicKey,
        universeAccount: universePda,
        tokenMint,
        curve: curvePda,
        tokenVaultAuthority: tokenVaultAuth,
        tokenVault: tokenVaultAta,
        solVault: curveSolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Give the voter some universe tokens directly (skip the curve buy
    // for test simplicity — we just need them in the voter's ATA).
    voterAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        tokenMint,
        voter.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      (admin as any).payer,
      tokenMint,
      voterAta,
      admin.publicKey,
      Number(VOTER_TOKEN_AMOUNT)
    );

    [canonConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_config')],
      program.programId
    );
  });

  it('initializes canon_market config', async () => {
    await program.methods
      .initializeConfig(treasury.publicKey, SUBMISSION_FEE, VOTING_PERIOD, QUORUM_BPS)
      .accountsPartial({
        admin: admin.publicKey,
        config: canonConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(canonConfigPda);
    expect(c.treasury.toBase58()).to.equal(treasury.publicKey.toBase58());
    expect(c.quorumBps).to.equal(QUORUM_BPS);
  });

  it('rejects invalid voting period', async () => {
    let err: unknown;
    try {
      await program.methods
        .setParams(SUBMISSION_FEE, new BN(60), QUORUM_BPS) // 60s < 1h min
        .accountsPartial({ admin: admin.publicKey, config: canonConfigPda })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/InvalidVotingPeriod/);
  });

  it('submits a canon proposal', async () => {
    const c = await program.account.config.fetch(canonConfigPda);
    const submissionId = c.nextSubmissionId;
    const [submissionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_submission'), universePda.toBuffer(), submissionContent],
      program.programId
    );
    const [voteVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_vote_vault'), submissionPda.toBuffer()],
      program.programId
    );

    const fakeEpisode = Keypair.generate().publicKey;
    await program.methods
      .submit([...submissionContent], fakeEpisode)
      .accountsPartial({
        submitter: submitter.publicKey,
        config: canonConfigPda,
        universeAccount: universePda,
        curve: curvePda,
        submission: submissionPda,
        voteVault: voteVaultAuth,
        systemProgram: SystemProgram.programId,
      })
      .signers([submitter])
      .rpc();

    const sub = await program.account.submission.fetch(submissionPda);
    expect(sub.id.toString()).to.equal(submissionId.toString());
    expect(sub.universe.toBase58()).to.equal(universePda.toBase58());
    expect(sub.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(JSON.stringify(sub.state)).to.match(/active/i);
  });

  it('voter locks tokens for a vote, tally increments', async () => {
    const [submissionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_submission'), universePda.toBuffer(), submissionContent],
      program.programId
    );
    const [voteVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_vote_vault'), submissionPda.toBuffer()],
      program.programId
    );
    const voteVaultAta = getAssociatedTokenAddressSync(tokenMint, voteVaultAuth, true);
    const [voteLockPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_vote_lock'), submissionPda.toBuffer(), voter.publicKey.toBuffer()],
      program.programId
    );

    const voteAmount = new BN(50_000); // half of VOTER_TOKEN_AMOUNT
    await program.methods
      .vote(true, voteAmount)
      .accountsPartial({
        voter: voter.publicKey,
        config: canonConfigPda,
        submission: submissionPda,
        tokenMint,
        voteVaultAuthority: voteVaultAuth,
        voteVault: voteVaultAta,
        voterTokenAta: voterAta,
        voteLock: voteLockPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter])
      .rpc();

    const sub = await program.account.submission.fetch(submissionPda);
    expect(sub.votesFor.toString()).to.equal(voteAmount.toString());
    const lock = await program.account.voteLock.fetch(voteLockPda);
    expect(lock.amount.toString()).to.equal(voteAmount.toString());
    expect(lock.support).to.equal(true);

    const vaultBal = BigInt(
      (await getAccount(provider.connection, voteVaultAta)).amount.toString()
    );
    expect(vaultBal.toString()).to.equal(voteAmount.toString());
  });

  it('rejects direction switch on additive vote', async () => {
    const [submissionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_submission'), universePda.toBuffer(), submissionContent],
      program.programId
    );
    const [voteVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_vote_vault'), submissionPda.toBuffer()],
      program.programId
    );
    const voteVaultAta = getAssociatedTokenAddressSync(tokenMint, voteVaultAuth, true);
    const [voteLockPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('canon_vote_lock'), submissionPda.toBuffer(), voter.publicKey.toBuffer()],
      program.programId
    );

    let err: unknown;
    try {
      await program.methods
        .vote(false, new BN(1000)) // already voted `true`, can't switch
        .accountsPartial({
          voter: voter.publicKey,
          config: canonConfigPda,
          submission: submissionPda,
          tokenMint,
          voteVaultAuthority: voteVaultAuth,
          voteVault: voteVaultAta,
          voterTokenAta: voterAta,
          voteLock: voteLockPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/DirectionConflict/);
  });
});
