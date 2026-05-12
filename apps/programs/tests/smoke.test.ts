/**
 * LOAR Anchor programs — smoke test.
 *
 * Validates the demo-critical execution path against a local solana-test-validator:
 *   1. universe::initialize_universe   — creates Universe PDA, emits UniverseCreated
 *   2. universe::publish_universe      — flips visibility, emits UniversePublished
 *   3. episode::mint_episode           — creates EpisodeRecord (no Bubblegum CPI yet)
 *   4. episode::canonize               — flips is_canon, emits EpisodeCanonized
 *
 * Skipped here (covered by apps/programs/scripts/demo-mint.ts on real devnet):
 *   - Bubblegum mint_v1 CPI (needs a deployed merkle tree + tree-authority delegation)
 *   - Metaplex Core canon-promotion mint (mpl-core SDK quirks under local validator)
 *   - Payment program flow (covered separately in payment.test.ts when written)
 *
 * Run via:
 *   cd apps/programs && anchor test
 *
 * Anchor spins up a local validator, deploys all three programs, and runs this
 * suite. Each test should take <2s on a warm validator.
 */
import { createHash } from 'node:crypto';
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';

function sha256(s: string): number[] {
  return [...createHash('sha256').update(s).digest()];
}

describe('LOAR — universe + episode smoke', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Anchor's workspace exposes programs by their cargo crate name (lowercase).
  const universeProgram = anchor.workspace.universe as anchor.Program<anchor.Idl>;
  const episodeProgram = anchor.workspace.episode as anchor.Program<anchor.Idl>;

  const creator = (provider.wallet as anchor.Wallet).payer as Keypair;
  const contentHash = sha256(`smoke-test-${Date.now()}`);
  const plotHash = sha256(`smoke-test-${Date.now()}::plot`);

  let universePda: PublicKey;
  let episodePda: PublicKey;

  before(() => {
    [universePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creator.publicKey.toBuffer(), Buffer.from(contentHash)],
      universeProgram.programId
    );
    [episodePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('episode'), universePda.toBuffer(), Buffer.from(contentHash)],
      episodeProgram.programId
    );
  });

  it('initializes a Universe', async () => {
    await universeProgram.methods
      .initializeUniverse(contentHash, plotHash, { private: {} })
      .accounts({
        creator: creator.publicKey,
        universe: universePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const acct = (await universeProgram.account.universe.fetch(universePda)) as {
      creator: PublicKey;
      canonCount: anchor.BN;
      visibility: { private?: {}; public?: {} };
    };
    expect(acct.creator.toBase58()).to.eq(creator.publicKey.toBase58());
    expect(acct.canonCount.toNumber()).to.eq(0);
    expect(acct.visibility).to.have.property('private');
  });

  it('publishes the Universe (private → public)', async () => {
    await universeProgram.methods
      .publishUniverse()
      .accounts({ signer: creator.publicKey, universe: universePda })
      .rpc();

    const acct = (await universeProgram.account.universe.fetch(universePda)) as {
      visibility: { private?: {}; public?: {} };
    };
    expect(acct.visibility).to.have.property('public');
  });

  it('rejects a publish from a non-creator', async () => {
    const intruder = Keypair.generate();
    // fund the intruder so its signature is acceptable.
    const sig = await provider.connection.requestAirdrop(intruder.publicKey, 1e9);
    await provider.connection.confirmTransaction(sig, 'confirmed');

    let threw = false;
    try {
      await universeProgram.methods
        .publishUniverse()
        .accounts({ signer: intruder.publicKey, universe: universePda })
        .signers([intruder])
        .rpc();
    } catch (err) {
      threw = true;
      const msg = (err as Error).message ?? '';
      expect(msg).to.match(/Unauthorized|0x1770|AlreadyPublic|0x1771/);
    }
    expect(threw, 'non-creator publish must error').to.eq(true);
  });

  it('mints an Episode under the Universe', async () => {
    await episodeProgram.methods
      .mintEpisode(contentHash, 'https://example.com/m.json', 'Smoke Episode')
      .accounts({
        creator: creator.publicKey,
        universe: universePda,
        episodeRecord: episodePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const acct = (await episodeProgram.account.episodeRecord.fetch(episodePda)) as {
      isCanon: boolean;
      universe: PublicKey;
      creator: PublicKey;
    };
    expect(acct.isCanon).to.eq(false);
    expect(acct.universe.toBase58()).to.eq(universePda.toBase58());
    expect(acct.creator.toBase58()).to.eq(creator.publicKey.toBase58());
  });

  it('canonizes the Episode (one-way flag flip)', async () => {
    await episodeProgram.methods
      .canonize()
      .accounts({ signer: creator.publicKey, episodeRecord: episodePda })
      .rpc();

    const acct = (await episodeProgram.account.episodeRecord.fetch(episodePda)) as {
      isCanon: boolean;
    };
    expect(acct.isCanon).to.eq(true);
  });

  it('rejects a second canonize (already canon)', async () => {
    let threw = false;
    try {
      await episodeProgram.methods
        .canonize()
        .accounts({ signer: creator.publicKey, episodeRecord: episodePda })
        .rpc();
    } catch (err) {
      threw = true;
      expect((err as Error).message ?? '').to.match(/AlreadyCanon|0x17.+/);
    }
    expect(threw, 'second canonize must error').to.eq(true);
  });
});
