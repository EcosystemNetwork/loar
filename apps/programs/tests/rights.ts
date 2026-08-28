import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { Rights } from '../target/types/rights';

describe('rights', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Rights as Program<Rights>;
  const admin = provider.wallet as anchor.Wallet;

  const rightsOperator = Keypair.generate();
  const newOperator = Keypair.generate();
  const intruder = Keypair.generate();
  const creator = Keypair.generate();

  let configPda: PublicKey;

  // Test content hash (fan/parody content).
  const contentHashA = Buffer.alloc(32, 0xaa);
  // Test content hash (original IP).
  const contentHashB = Buffer.alloc(32, 0xbb);

  // EVM provenance fields.
  const evmCreator = Buffer.alloc(20, 0x99);
  const evmTxHash = Buffer.alloc(32, 0xee);

  // Anchor 0.31 IDL enum encoding: { unset: {} } | { fun: {} } | { original: {} } | …
  const RightsType = {
    Unset: { unset: {} },
    Fun: { fun: {} },
    Original: { original: {} },
    Licensed: { licensed: {} },
    PublicDomain: { publicDomain: {} },
    Frozen: { frozen: {} },
  };

  function rightsPda(contentHash: Buffer): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('rights'), contentHash],
      program.programId
    )[0];
  }

  before(async () => {
    for (const kp of [rightsOperator, newOperator, intruder, creator]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('rights_config')],
      program.programId
    );
  });

  it('initializes config with admin + rights_operator', async () => {
    await program.methods
      .initializeConfig(rightsOperator.publicKey)
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const c = await program.account.config.fetch(configPda);
    expect(c.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(c.rightsOperator.toBase58()).to.equal(rightsOperator.publicKey.toBase58());
    expect(c.paused).to.equal(false);
  });

  it('writes first attestation for new content_hash', async () => {
    const rights = rightsPda(contentHashA);
    await program.methods
      .setRightsViaAttestation(
        [...contentHashA],
        RightsType.Fun,
        creator.publicKey,
        [...evmCreator],
        new BN(1),
        [...evmTxHash],
        new BN(100)
      )
      .accountsPartial({
        operator: rightsOperator.publicKey,
        config: configPda,
        rights,
        systemProgram: SystemProgram.programId,
      })
      .signers([rightsOperator])
      .rpc();

    const r = await program.account.rights.fetch(rights);
    expect(r.contentHash).to.deep.equal([...contentHashA]);
    expect(r.rightsType).to.deep.equal(RightsType.Fun);
    expect(r.creator.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(r.evmCreator).to.deep.equal([...evmCreator]);
    expect(r.version.toString()).to.equal('1');
    expect(r.evmBlockNumber.toString()).to.equal('100');
  });

  it('updates attestation when version strictly increases', async () => {
    const rights = rightsPda(contentHashA);
    await program.methods
      .setRightsViaAttestation(
        [...contentHashA],
        RightsType.Original, // upgraded classification
        creator.publicKey,
        [...evmCreator],
        new BN(2),
        [...evmTxHash],
        new BN(200)
      )
      .accountsPartial({
        operator: rightsOperator.publicKey,
        config: configPda,
        rights,
        systemProgram: SystemProgram.programId,
      })
      .signers([rightsOperator])
      .rpc();

    const r = await program.account.rights.fetch(rights);
    expect(r.rightsType).to.deep.equal(RightsType.Original);
    expect(r.version.toString()).to.equal('2');
  });

  it('rejects stale version (replay protection)', async () => {
    const rights = rightsPda(contentHashA);
    let err: unknown;
    try {
      await program.methods
        .setRightsViaAttestation(
          [...contentHashA],
          RightsType.Fun, // attempt rollback
          creator.publicKey,
          [...evmCreator],
          new BN(2), // same version — must be STRICTLY greater
          [...evmTxHash],
          new BN(200)
        )
        .accountsPartial({
          operator: rightsOperator.publicKey,
          config: configPda,
          rights,
          systemProgram: SystemProgram.programId,
        })
        .signers([rightsOperator])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/VersionNotMonotonic/);
  });

  it('rejects zero version on first attestation', async () => {
    const fresh = Buffer.alloc(32, 0xcc);
    let err: unknown;
    try {
      await program.methods
        .setRightsViaAttestation(
          [...fresh],
          RightsType.Original,
          creator.publicKey,
          [...evmCreator],
          new BN(0),
          [...evmTxHash],
          new BN(0)
        )
        .accountsPartial({
          operator: rightsOperator.publicKey,
          config: configPda,
          rights: rightsPda(fresh),
          systemProgram: SystemProgram.programId,
        })
        .signers([rightsOperator])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/ZeroVersion/);
  });

  it('rejects zero content_hash', async () => {
    const zero = Buffer.alloc(32, 0x00);
    let err: unknown;
    try {
      await program.methods
        .setRightsViaAttestation(
          [...zero],
          RightsType.Original,
          creator.publicKey,
          [...evmCreator],
          new BN(1),
          [...evmTxHash],
          new BN(1)
        )
        .accountsPartial({
          operator: rightsOperator.publicKey,
          config: configPda,
          rights: rightsPda(zero),
          systemProgram: SystemProgram.programId,
        })
        .signers([rightsOperator])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/ZeroHash/);
  });

  it('rejects unauthorized operator', async () => {
    let err: unknown;
    try {
      await program.methods
        .setRightsViaAttestation(
          [...contentHashB],
          RightsType.Original,
          creator.publicKey,
          [...evmCreator],
          new BN(1),
          [...evmTxHash],
          new BN(1)
        )
        .accountsPartial({
          operator: intruder.publicKey, // wrong signer
          config: configPda,
          rights: rightsPda(contentHashB),
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    // Anchor's address constraint surfaces as a generic constraint violation;
    // the on-chain error variant resolves to Unauthorized.
    expect(String(err)).to.match(/Unauthorized|ConstraintAddress/);
  });

  it('pause blocks attestation writes, unpause restores', async () => {
    await program.methods
      .pause()
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();

    let err: unknown;
    try {
      await program.methods
        .setRightsViaAttestation(
          [...contentHashB],
          RightsType.Original,
          creator.publicKey,
          [...evmCreator],
          new BN(1),
          [...evmTxHash],
          new BN(1)
        )
        .accountsPartial({
          operator: rightsOperator.publicKey,
          config: configPda,
          rights: rightsPda(contentHashB),
          systemProgram: SystemProgram.programId,
        })
        .signers([rightsOperator])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Paused/);

    await program.methods
      .unpause()
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();

    // Now the same write should succeed.
    await program.methods
      .setRightsViaAttestation(
        [...contentHashB],
        RightsType.Original,
        creator.publicKey,
        [...evmCreator],
        new BN(1),
        [...evmTxHash],
        new BN(1)
      )
      .accountsPartial({
        operator: rightsOperator.publicKey,
        config: configPda,
        rights: rightsPda(contentHashB),
        systemProgram: SystemProgram.programId,
      })
      .signers([rightsOperator])
      .rpc();
  });

  it('two-step rights operator rotation', async () => {
    await program.methods
      .transferRightsOperator(newOperator.publicKey)
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();

    let c = await program.account.config.fetch(configPda);
    expect(c.pendingRightsOperator.toBase58()).to.equal(newOperator.publicKey.toBase58());
    expect(c.rightsOperator.toBase58()).to.equal(rightsOperator.publicKey.toBase58());

    // Wrong pending accepter is rejected.
    let err: unknown;
    try {
      await program.methods
        .acceptRightsOperator()
        .accountsPartial({ newOperator: intruder.publicKey, config: configPda })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Unauthorized/);

    await program.methods
      .acceptRightsOperator()
      .accountsPartial({ newOperator: newOperator.publicKey, config: configPda })
      .signers([newOperator])
      .rpc();

    c = await program.account.config.fetch(configPda);
    expect(c.rightsOperator.toBase58()).to.equal(newOperator.publicKey.toBase58());
    expect(c.pendingRightsOperator.toBase58()).to.equal(PublicKey.default.toBase58());
  });
});
