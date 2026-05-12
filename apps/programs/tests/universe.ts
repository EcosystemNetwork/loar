import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { Universe } from '../target/types/universe';

describe('universe', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Universe as Program<Universe>;
  const creator = provider.wallet as anchor.Wallet;

  // Distinct content hashes per test for PDA uniqueness.
  const hashA = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
  const hashB = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 100));
  const plotA = Uint8Array.from(Array.from({ length: 32 }, () => 9));

  function universePda(creatorKey: PublicKey, contentHash: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creatorKey.toBuffer(), Buffer.from(contentHash)],
      program.programId
    );
  }

  it('initializes a private universe', async () => {
    const [pda] = universePda(creator.publicKey, hashA);
    await program.methods
      .initializeUniverse(Array.from(hashA), Array.from(plotA), { private: {} } as never)
      .accounts({
        creator: creator.publicKey,
        universe: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const u = await program.account.universe.fetch(pda);
    expect(u.creator.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(Buffer.from(u.contentHash).equals(Buffer.from(hashA))).to.equal(true);
    expect(u.canonCount.toNumber()).to.equal(0);
    expect(JSON.stringify(u.visibility)).to.equal(JSON.stringify({ private: {} }));
  });

  it('publishes a private universe', async () => {
    const [pda] = universePda(creator.publicKey, hashA);
    await program.methods
      .publishUniverse()
      .accounts({ signer: creator.publicKey, universe: pda })
      .rpc();
    const u = await program.account.universe.fetch(pda);
    expect(JSON.stringify(u.visibility)).to.equal(JSON.stringify({ public: {} }));
  });

  it('rejects re-publishing an already public universe', async () => {
    const [pda] = universePda(creator.publicKey, hashA);
    let err: unknown;
    try {
      await program.methods
        .publishUniverse()
        .accounts({ signer: creator.publicKey, universe: pda })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/AlreadyPublic/);
  });

  it('rejects publish from a non-creator signer', async () => {
    const intruder = Keypair.generate();
    // Fund intruder for tx fees.
    const sig = await provider.connection.requestAirdrop(intruder.publicKey, 1e9);
    await provider.connection.confirmTransaction(sig);

    const [pda] = universePda(creator.publicKey, hashB);
    // Create the universe first as the real creator.
    await program.methods
      .initializeUniverse(Array.from(hashB), Array.from(plotA), { private: {} } as never)
      .accounts({
        creator: creator.publicKey,
        universe: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let err: unknown;
    try {
      await program.methods
        .publishUniverse()
        .accounts({ signer: intruder.publicKey, universe: pda })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Unauthorized/);
  });

  it('canonize bumps the canon counter', async () => {
    const [pda] = universePda(creator.publicKey, hashA);
    const before = await program.account.universe.fetch(pda);
    await program.methods
      .canonizeEpisode()
      .accounts({ signer: creator.publicKey, universe: pda })
      .rpc();
    const after = await program.account.universe.fetch(pda);
    expect(after.canonCount.toNumber()).to.equal(before.canonCount.toNumber() + 1);
  });
});
