import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { expect } from 'chai';
import { PremiumActions } from '../target/types/premium_actions';

describe('premium_actions', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PremiumActions as Program<PremiumActions>;
  const admin = provider.wallet as anchor.Wallet;

  const user = Keypair.generate();
  const treasury = Keypair.generate();
  const liquidityPool = Keypair.generate();
  const platform = Keypair.generate();

  let configPda: PublicKey;
  let loarMint: PublicKey;
  let userAta: PublicKey;
  let treasuryAta: PublicKey;
  let lpAta: PublicKey;

  const DECIMALS = 9;
  const ACTION_COST = 100_000_000_000n; // 100 LOAR (9 decimals)

  // sha256("PRIORITY_GENERATION") — same scheme as the server SDK
  const actionName = createHash('sha256').update('PRIORITY_GENERATION').digest();

  let actionPda: PublicKey;

  before(async () => {
    for (const kp of [user, treasury, liquidityPool, platform]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('burner_config')],
      program.programId
    );
    loarMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      DECIMALS
    );
    userAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (admin as any).payer,
        loarMint,
        user.publicKey
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
    lpAta = (
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
      Number(ACTION_COST) * 5
    );
    [actionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('burner_action'), actionName],
      program.programId
    );
  });

  it('initializes config with 50/50 LP/treasury split', async () => {
    await program.methods
      .initializeConfig(treasury.publicKey, liquidityPool.publicKey, platform.publicKey, 5000)
      .accountsPartial({
        admin: admin.publicKey,
        loarMint,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.treasury.toBase58()).to.equal(treasury.publicKey.toBase58());
    expect(c.liquidityPool.toBase58()).to.equal(liquidityPool.publicKey.toBase58());
    expect(c.lpRatioBps).to.equal(5000);
  });

  it('rejects lp_ratio above 10000 bps', async () => {
    let err: unknown;
    try {
      await program.methods
        .setLpRatio(20_000)
        .accountsPartial({ admin: admin.publicKey, config: configPda })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/RatioTooHigh/);
  });

  it('configures an action', async () => {
    await program.methods
      .setActionConfig([...actionName], new BN(ACTION_COST.toString()), true)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        action: actionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const a = await program.account.action.fetch(actionPda);
    expect(a.cost.toString()).to.equal(ACTION_COST.toString());
    expect(a.active).to.equal(true);
  });

  it('rejects execute on inactive action', async () => {
    // Flip to inactive
    await program.methods
      .setActionConfig([...actionName], new BN(ACTION_COST.toString()), false)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        action: actionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    let err: unknown;
    try {
      await program.methods
        .executeAction([...actionName])
        .accountsPartial({
          user: user.publicKey,
          config: configPda,
          loarMint,
          action: actionPda,
          userLoarAta: userAta,
          lpAta,
          treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/ActionNotActive/);

    // Reactivate for the next test.
    await program.methods
      .setActionConfig([...actionName], new BN(ACTION_COST.toString()), true)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        action: actionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it('executes action: splits 50/50 between LP and treasury', async () => {
    const { getAccount } = await import('@solana/spl-token');
    const before = {
      treasury: BigInt((await getAccount(provider.connection, treasuryAta)).amount.toString()),
      lp: BigInt((await getAccount(provider.connection, lpAta)).amount.toString()),
    };

    await program.methods
      .executeAction([...actionName])
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        loarMint,
        action: actionPda,
        userLoarAta: userAta,
        lpAta,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const after = {
      treasury: BigInt((await getAccount(provider.connection, treasuryAta)).amount.toString()),
      lp: BigInt((await getAccount(provider.connection, lpAta)).amount.toString()),
    };
    expect((after.lp - before.lp).toString()).to.equal((ACTION_COST / 2n).toString());
    expect((after.treasury - before.treasury).toString()).to.equal((ACTION_COST / 2n).toString());

    const a = await program.account.action.fetch(actionPda);
    expect(a.totalCount.toString()).to.equal('1');
    expect(a.totalCollected.toString()).to.equal(ACTION_COST.toString());
  });
});
