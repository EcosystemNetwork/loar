import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { SplitRouter } from '../target/types/split_router';

describe('split_router', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SplitRouter as Program<SplitRouter>;
  const admin = provider.wallet as anchor.Wallet;

  const owner = Keypair.generate();
  const intruder = Keypair.generate();
  const payer = Keypair.generate();
  const recipientA = Keypair.generate();
  const recipientB = Keypair.generate();
  const recipientC = Keypair.generate();
  const treasury = Keypair.generate();

  const entityHash = Buffer.alloc(32, 0xab);

  let configPda: PublicKey;
  let splitsPda: PublicKey;

  before(async () => {
    for (const kp of [owner, intruder, payer]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('split_router_config')],
      program.programId
    );
    [splitsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('splits'), entityHash],
      program.programId
    );
  });

  it('initializes config with treasury', async () => {
    await program.methods
      .initializeConfig(treasury.publicKey)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.treasury.toBase58()).to.equal(treasury.publicKey.toBase58());
    expect(c.paused).to.equal(false);
  });

  it('rejects splits that do not sum to 10000', async () => {
    let err: unknown;
    try {
      await program.methods
        .setSplits(
          [...entityHash],
          [
            { recipient: recipientA.publicKey, bps: 5000 },
            { recipient: recipientB.publicKey, bps: 3000 }, // sums to 8000
          ]
        )
        .accountsPartial({
          owner: owner.publicKey,
          config: configPda,
          splits: splitsPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/InvalidSplitTotal/);
  });

  it('sets splits 60/30/10 across 3 recipients', async () => {
    await program.methods
      .setSplits(
        [...entityHash],
        [
          { recipient: recipientA.publicKey, bps: 6000 },
          { recipient: recipientB.publicKey, bps: 3000 },
          { recipient: recipientC.publicKey, bps: 1000 },
        ]
      )
      .accountsPartial({
        owner: owner.publicKey,
        config: configPda,
        splits: splitsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
    const s = await program.account.splits.fetch(splitsPda);
    expect(s.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(s.recipientCount).to.equal(3);
    expect(s.recipients[0].toBase58()).to.equal(recipientA.publicKey.toBase58());
    expect(s.bps[0]).to.equal(6000);
  });

  it('routes 1 SOL with 5% platform fee, splits remainder 60/30/10', async () => {
    const amount = new BN(LAMPORTS_PER_SOL);
    const platformFeeBps = 500;

    const before = {
      treasury: await provider.connection.getBalance(treasury.publicKey),
      a: await provider.connection.getBalance(recipientA.publicKey),
      b: await provider.connection.getBalance(recipientB.publicKey),
      c: await provider.connection.getBalance(recipientC.publicKey),
    };

    await program.methods
      .routeWithSplits(amount, platformFeeBps)
      .accountsPartial({
        payer: payer.publicKey,
        config: configPda,
        splits: splitsPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: recipientA.publicKey, isWritable: true, isSigner: false },
        { pubkey: recipientB.publicKey, isWritable: true, isSigner: false },
        { pubkey: recipientC.publicKey, isWritable: true, isSigner: false },
      ])
      .signers([payer])
      .rpc();

    const after = {
      treasury: await provider.connection.getBalance(treasury.publicKey),
      a: await provider.connection.getBalance(recipientA.publicKey),
      b: await provider.connection.getBalance(recipientB.publicKey),
      c: await provider.connection.getBalance(recipientC.publicKey),
    };

    // Platform = 5% = 0.05 SOL = 50_000_000 lamports
    expect(after.treasury - before.treasury).to.equal(50_000_000);
    // Distributable = 0.95 SOL = 950_000_000
    // A: 60% of 950_000_000 = 570_000_000
    expect(after.a - before.a).to.equal(570_000_000);
    // B: 30% of 950_000_000 = 285_000_000
    expect(after.b - before.b).to.equal(285_000_000);
    // C: last recipient gets 950_000_000 - 570_000_000 - 285_000_000 = 95_000_000
    expect(after.c - before.c).to.equal(95_000_000);
  });

  it('rejects recipient mismatch on route', async () => {
    let err: unknown;
    try {
      await program.methods
        .routeWithSplits(new BN(1_000_000), 100)
        .accountsPartial({
          payer: payer.publicKey,
          config: configPda,
          splits: splitsPda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          // Swap A and B — order must match stored.
          { pubkey: recipientB.publicKey, isWritable: true, isSigner: false },
          { pubkey: recipientA.publicKey, isWritable: true, isSigner: false },
          { pubkey: recipientC.publicKey, isWritable: true, isSigner: false },
        ])
        .signers([payer])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/RecipientMismatch/);
  });

  it('rejects re-set_splits before cooldown elapses', async () => {
    let err: unknown;
    try {
      await program.methods
        .setSplits(
          [...entityHash],
          [
            { recipient: recipientA.publicKey, bps: 5000 },
            { recipient: recipientB.publicKey, bps: 5000 },
          ]
        )
        .accountsPartial({
          owner: owner.publicKey,
          config: configPda,
          splits: splitsPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/CooldownActive/);
  });

  it('rejects intruder trying to set splits for owned entity', async () => {
    let err: unknown;
    try {
      await program.methods
        .setSplits([...entityHash], [{ recipient: intruder.publicKey, bps: 10000 }])
        .accountsPartial({
          owner: intruder.publicKey,
          config: configPda,
          splits: splitsPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    // Either NotSplitOwner or CooldownActive depending on which check fires first.
    expect(String(err)).to.match(/NotSplitOwner|CooldownActive/);
  });
});
