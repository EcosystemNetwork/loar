import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { CollabManager } from '../target/types/collab_manager';
import { Universe } from '../target/types/universe';

describe('collab_manager', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CollabManager as Program<CollabManager>;
  const universeProgram = anchor.workspace.Universe as Program<Universe>;
  const admin = provider.wallet as anchor.Wallet;

  const creatorA = Keypair.generate();
  const creatorB = Keypair.generate();
  const platform = Keypair.generate();
  const intruder = Keypair.generate();

  const contentHashA = Buffer.alloc(32, 0xa1);
  const contentHashB = Buffer.alloc(32, 0xb2);
  const plotHash = Buffer.alloc(32, 0xc3);
  const Visibility = { Public: { public: {} } };

  let configPda: PublicKey;
  let universeAPda: PublicKey;
  let universeBPda: PublicKey;
  let universeConfigPda: PublicKey;
  let collabPda: PublicKey;
  let collabId: BN;

  const SHARE_A_BPS = 6000; // A gets 60%, B gets 40%
  const DURATION = new BN(3600); // 1h

  before(async () => {
    for (const kp of [creatorA, creatorB, platform, intruder]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 3 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

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

    [universeAPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creatorA.publicKey.toBuffer(), contentHashA],
      universeProgram.programId
    );
    [universeBPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creatorB.publicKey.toBuffer(), contentHashB],
      universeProgram.programId
    );
    await universeProgram.methods
      .initializeUniverse([...contentHashA], [...plotHash], Visibility.Public)
      .accountsPartial({
        creator: creatorA.publicKey,
        universe: universeAPda,
        config: universeConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creatorA])
      .rpc();
    await universeProgram.methods
      .initializeUniverse([...contentHashB], [...plotHash], Visibility.Public)
      .accountsPartial({
        creator: creatorB.publicKey,
        universe: universeBPda,
        config: universeConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creatorB])
      .rpc();

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('collab_config')],
      program.programId
    );
  });

  it('initializes config', async () => {
    await program.methods
      .initializeConfig(platform.publicKey, 500)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.platform.toBase58()).to.equal(platform.publicKey.toBase58());
    expect(c.platformFeeBps).to.equal(500);
  });

  it('Universe A creator proposes a collab with B', async () => {
    const c = await program.account.config.fetch(configPda);
    collabId = c.nextCollabId;
    [collabPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('collab'), collabId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
    await program.methods
      .proposeCollab(collabId, SHARE_A_BPS, DURATION, 'ipfs://collab-meta')
      .accountsPartial({
        proposer: creatorA.publicKey,
        config: configPda,
        universeA: universeAPda,
        universeB: universeBPda,
        collab: collabPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creatorA])
      .rpc();

    const collab = await program.account.collab.fetch(collabPda);
    expect(collab.universeA.toBase58()).to.equal(universeAPda.toBase58());
    expect(collab.universeB.toBase58()).to.equal(universeBPda.toBase58());
    expect(collab.proposer.toBase58()).to.equal(creatorA.publicKey.toBase58());
    expect(collab.revenueShareABps).to.equal(SHARE_A_BPS);
    expect(JSON.stringify(collab.status)).to.match(/proposed/i);
  });

  it('rejects propose from non-creator of universe A', async () => {
    const c = await program.account.config.fetch(configPda);
    const nextId = c.nextCollabId;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('collab'), nextId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
    let err: unknown;
    try {
      await program.methods
        .proposeCollab(nextId, SHARE_A_BPS, DURATION, 'ipfs://meta')
        .accountsPartial({
          proposer: intruder.publicKey,
          config: configPda,
          universeA: universeAPda, // intruder is not creator of A
          universeB: universeBPda,
          collab: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/NotUniverseACreator/);
  });

  it('Universe B creator accepts', async () => {
    await program.methods
      .acceptCollab()
      .accountsPartial({
        acceptor: creatorB.publicKey,
        config: configPda,
        universeB: universeBPda,
        collab: collabPda,
      })
      .signers([creatorB])
      .rpc();
    const collab = await program.account.collab.fetch(collabPda);
    expect(collab.acceptor.toBase58()).to.equal(creatorB.publicKey.toBase58());
    expect(JSON.stringify(collab.status)).to.match(/accepted/i);
  });

  it('rejects accept by non-creator of universe B', async () => {
    let err: unknown;
    try {
      await program.methods
        .acceptCollab()
        .accountsPartial({
          acceptor: intruder.publicKey,
          config: configPda,
          universeB: universeBPda,
          collab: collabPda,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/NotUniverseBCreator|InvalidStatus/);
  });

  it('activates collab → ACTIVE state with end_time set', async () => {
    await program.methods
      .activateCollab()
      .accountsPartial({
        signer: creatorA.publicKey,
        config: configPda,
        collab: collabPda,
      })
      .signers([creatorA])
      .rpc();
    const collab = await program.account.collab.fetch(collabPda);
    expect(JSON.stringify(collab.status)).to.match(/active/i);
    expect(collab.endTime.toNumber()).to.be.greaterThan(collab.startTime.toNumber());
  });

  it('platform records an episode + revenue', async () => {
    const epRevenue = new BN(LAMPORTS_PER_SOL);
    await program.methods
      .recordEpisode(epRevenue)
      .accountsPartial({
        platform: platform.publicKey,
        config: configPda,
        collab: collabPda,
      })
      .signers([platform])
      .rpc();
    const collab = await program.account.collab.fetch(collabPda);
    expect(collab.episodeCount.toString()).to.equal('1');
    expect(collab.totalRevenue.toString()).to.equal(epRevenue.toString());
  });

  it('rejects record_episode from non-platform', async () => {
    let err: unknown;
    try {
      await program.methods
        .recordEpisode(new BN(1))
        .accountsPartial({
          platform: intruder.publicKey,
          config: configPda,
          collab: collabPda,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/NotPlatform/);
  });

  it('admin can complete an Active collab anytime', async () => {
    await program.methods
      .completeCollab()
      .accountsPartial({
        signer: admin.publicKey,
        config: configPda,
        collab: collabPda,
      })
      .rpc();
    const collab = await program.account.collab.fetch(collabPda);
    expect(JSON.stringify(collab.status)).to.match(/completed/i);
  });
});
