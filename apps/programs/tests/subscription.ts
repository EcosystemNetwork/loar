import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { Subscription } from '../target/types/subscription';
import { Universe } from '../target/types/universe';

describe('subscription', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Subscription as Program<Subscription>;
  const universeProgram = anchor.workspace.Universe as Program<Universe>;
  const admin = provider.wallet as anchor.Wallet;

  const creator = Keypair.generate();
  const subscriber = Keypair.generate();
  const platform = Keypair.generate();

  let subConfigPda: PublicKey;
  let universePda: PublicKey;
  let universeConfigPda: PublicKey;
  let tier1Pda: PublicKey;
  let subscriptionPda: PublicKey;

  const contentHash = Buffer.alloc(32, 0x21);
  const plotHash = Buffer.alloc(32, 0x22);
  const Visibility = { Public: { public: {} } };
  const PRICE_PER_MONTH = new BN(LAMPORTS_PER_SOL / 100); // 0.01 SOL/mo

  before(async () => {
    for (const kp of [creator, subscriber, platform]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    // Bring up a Universe so we can read its creator live.
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
      [Buffer.from('universe'), creator.publicKey.toBuffer(), contentHash],
      universeProgram.programId
    );
    await universeProgram.methods
      .initializeUniverse([...contentHash], [...plotHash], Visibility.Public)
      .accountsPartial({
        creator: creator.publicKey,
        universe: universePda,
        config: universeConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    [subConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('subscription_config')],
      program.programId
    );
    [tier1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('tier'), universePda.toBuffer(), Buffer.from([1])],
      program.programId
    );
    [subscriptionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('subscription'), subscriber.publicKey.toBuffer(), universePda.toBuffer()],
      program.programId
    );
  });

  it('initializes config with platform fee', async () => {
    await program.methods
      .initializeConfig(platform.publicKey, 1000)
      .accountsPartial({
        admin: admin.publicKey,
        config: subConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(subConfigPda);
    expect(c.platform.toBase58()).to.equal(platform.publicKey.toBase58());
    expect(c.platformFeeBps).to.equal(1000);
  });

  it('creator configures tier 1 (BASIC)', async () => {
    await program.methods
      .configureTier(universePda, 1, PRICE_PER_MONTH, 0x01, 0)
      .accountsPartial({
        signer: creator.publicKey,
        config: subConfigPda,
        universeAccount: universePda,
        tier: tier1Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    const t = await program.account.tier.fetch(tier1Pda);
    expect(t.active).to.equal(true);
    expect(t.pricePerMonthLamports.toString()).to.equal(PRICE_PER_MONTH.toString());
  });

  it('rejects tier_id >= 4', async () => {
    let err: unknown;
    const [bogusTier] = PublicKey.findProgramAddressSync(
      [Buffer.from('tier'), universePda.toBuffer(), Buffer.from([99])],
      program.programId
    );
    try {
      await program.methods
        .configureTier(universePda, 99, PRICE_PER_MONTH, 0, 0)
        .accountsPartial({
          signer: creator.publicKey,
          config: subConfigPda,
          universeAccount: universePda,
          tier: bogusTier,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/InvalidTier|ConstraintSeeds/);
  });

  it('subscribes 3 months, pays creator + platform', async () => {
    const months = 3;
    const total = PRICE_PER_MONTH.mul(new BN(months));
    const platformCut = total.mul(new BN(1000)).div(new BN(10000));
    const creatorCut = total.sub(platformCut);

    const creatorBefore = await provider.connection.getBalance(creator.publicKey);
    const platformBefore = await provider.connection.getBalance(platform.publicKey);

    await program.methods
      .subscribe(universePda, 1, months)
      .accountsPartial({
        subscriber: subscriber.publicKey,
        config: subConfigPda,
        universeAccount: universePda,
        tier: tier1Pda,
        subscription: subscriptionPda,
        creator: creator.publicKey,
        platformTreasury: platform.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([subscriber])
      .rpc();

    const creatorAfter = await provider.connection.getBalance(creator.publicKey);
    const platformAfter = await provider.connection.getBalance(platform.publicKey);
    expect(creatorAfter - creatorBefore).to.equal(creatorCut.toNumber());
    expect(platformAfter - platformBefore).to.equal(platformCut.toNumber());

    const s = await program.account.subscription.fetch(subscriptionPda);
    expect(s.tierId).to.equal(1);
    expect(s.user.toBase58()).to.equal(subscriber.publicKey.toBase58());
  });

  it('extends existing subscription on same tier', async () => {
    const before = await program.account.subscription.fetch(subscriptionPda);
    await program.methods
      .subscribe(universePda, 1, 1)
      .accountsPartial({
        subscriber: subscriber.publicKey,
        config: subConfigPda,
        universeAccount: universePda,
        tier: tier1Pda,
        subscription: subscriptionPda,
        creator: creator.publicKey,
        platformTreasury: platform.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([subscriber])
      .rpc();
    const after = await program.account.subscription.fetch(subscriptionPda);
    expect(after.expiresAt.toNumber()).to.be.greaterThan(before.expiresAt.toNumber());
  });

  it('blocks tier change on active subscription', async () => {
    // Configure tier 2 first.
    const [tier2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('tier'), universePda.toBuffer(), Buffer.from([2])],
      program.programId
    );
    await program.methods
      .configureTier(universePda, 2, PRICE_PER_MONTH.mul(new BN(5)), 0x0f, 100)
      .accountsPartial({
        signer: creator.publicKey,
        config: subConfigPda,
        universeAccount: universePda,
        tier: tier2Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    let err: unknown;
    try {
      await program.methods
        .subscribe(universePda, 2, 1)
        .accountsPartial({
          subscriber: subscriber.publicKey,
          config: subConfigPda,
          universeAccount: universePda,
          tier: tier2Pda,
          subscription: subscriptionPda,
          creator: creator.publicKey,
          platformTreasury: platform.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([subscriber])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/TierChangeBlocked/);
  });
});
