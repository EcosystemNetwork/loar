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
import { Staking } from '../target/types/staking';

describe('staking', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Staking as Program<Staking>;
  const admin = provider.wallet as anchor.Wallet;

  const user = Keypair.generate();
  const treasury = Keypair.generate();
  const liquidityPool = Keypair.generate();

  let configPda: PublicKey;
  let globalVault: PublicKey;
  let globalVaultAta: PublicKey;
  let stakeInfoPda: PublicKey;
  let loarMint: PublicKey;
  let userAta: PublicKey;
  let penaltyAta: PublicKey;

  const DECIMALS = 9;
  const STAKE_AMOUNT = 5_000_000_000_000n; // 5000 LOAR (above Bronze threshold of 1k)
  const MIN_LOCK_SECS = new BN(60); // 60s to allow quick unstake test
  const EARLY_PENALTY_BPS = 500; // 5%

  before(async () => {
    for (const kp of [user, treasury, liquidityPool]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 3 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('staking_config')],
      program.programId
    );
    [globalVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('global_vault')],
      program.programId
    );
    [stakeInfoPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('stake_info'), user.publicKey.toBuffer()],
      program.programId
    );

    loarMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      DECIMALS
    );
    globalVaultAta = getAssociatedTokenAddressSync(loarMint, globalVault, true);
    userAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        user.publicKey
      )
    ).address;
    penaltyAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        liquidityPool.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      (admin as any).payer,
      loarMint,
      userAta,
      admin.publicKey,
      Number(STAKE_AMOUNT) * 2
    );
  });

  it('initializes config with default tier ladder', async () => {
    await program.methods
      .initialize(treasury.publicKey, liquidityPool.publicKey, MIN_LOCK_SECS, EARLY_PENALTY_BPS)
      .accountsPartial({
        admin: admin.publicKey,
        loarMint,
        config: configPda,
        globalVault,
        globalVaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.loarMint.toBase58()).to.equal(loarMint.toBase58());
    expect(c.earlyUnstakePenaltyBps).to.equal(EARLY_PENALTY_BPS);
    expect(c.tierConfigs[1].minStake.toString()).to.equal('1000000000000'); // Bronze 1k LOAR
  });

  it('stakes LOAR, tier upgrades to Silver (10k threshold not met → Bronze)', async () => {
    await program.methods
      .stake(new BN(STAKE_AMOUNT.toString()))
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        loarMint,
        stakeInfo: stakeInfoPda,
        globalVault,
        globalVaultAta,
        userLoarAta: userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const s = await program.account.stakeInfo.fetch(stakeInfoPda);
    expect(s.amount.toString()).to.equal(STAKE_AMOUNT.toString());
    expect(s.tier).to.equal(1); // Bronze (5k LOAR is above 1k but below Silver's 10k)

    const vaultBal = BigInt(
      (await getAccount(provider.connection, globalVaultAta)).amount.toString()
    );
    expect(vaultBal.toString()).to.equal(STAKE_AMOUNT.toString());
  });

  it('unstake within lock period applies 5% penalty', async () => {
    const unstakeAmount = new BN((STAKE_AMOUNT / 2n).toString());
    const userBalBefore = BigInt(
      (await getAccount(provider.connection, userAta)).amount.toString()
    );
    const penaltyBalBefore = BigInt(
      (await getAccount(provider.connection, penaltyAta)).amount.toString()
    );

    await program.methods
      .unstake(unstakeAmount)
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        loarMint,
        stakeInfo: stakeInfoPda,
        globalVault,
        globalVaultAta,
        userLoarAta: userAta,
        penaltyDestinationAta: penaltyAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const userBalAfter = BigInt((await getAccount(provider.connection, userAta)).amount.toString());
    const penaltyBalAfter = BigInt(
      (await getAccount(provider.connection, penaltyAta)).amount.toString()
    );

    const amount = BigInt(unstakeAmount.toString());
    const expectedPenalty = (amount * 500n) / 10000n;
    const expectedUserShare = amount - expectedPenalty;

    expect((userBalAfter - userBalBefore).toString()).to.equal(expectedUserShare.toString());
    expect((penaltyBalAfter - penaltyBalBefore).toString()).to.equal(expectedPenalty.toString());
  });

  it('rejects unstake amount > staked', async () => {
    let err: unknown;
    try {
      await program.methods
        .unstake(new BN((STAKE_AMOUNT * 10n).toString()))
        .accountsPartial({
          user: user.publicKey,
          config: configPda,
          loarMint,
          stakeInfo: stakeInfoPda,
          globalVault,
          globalVaultAta,
          userLoarAta: userAta,
          penaltyDestinationAta: penaltyAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/InsufficientStake/);
  });

  it('weighted-average staked_at on incremental stake (STAKE-01 analog)', async () => {
    const before = await program.account.stakeInfo.fetch(stakeInfoPda);
    const stakedAtBefore = before.stakedAt.toNumber();

    // Wait a moment so the timestamp differs.
    await new Promise((r) => setTimeout(r, 2000));

    await program.methods
      .stake(new BN((STAKE_AMOUNT * 10n).toString())) // much larger stake
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        loarMint,
        stakeInfo: stakeInfoPda,
        globalVault,
        globalVaultAta,
        userLoarAta: userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const after = await program.account.stakeInfo.fetch(stakeInfoPda);
    // staked_at should have moved forward (weighted toward the larger,
    // later stake) but not jumped to exactly "now" — it's a weighted avg.
    expect(after.stakedAt.toNumber()).to.be.greaterThan(stakedAtBefore);
  });
});
