import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { Episode } from '../target/types/episode';
import { Universe } from '../target/types/universe';

describe('episode', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const episode = anchor.workspace.Episode as Program<Episode>;
  const universe = anchor.workspace.Universe as Program<Universe>;
  const creator = provider.wallet as anchor.Wallet;

  const universeHash = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 50));
  const plotHash = Uint8Array.from(Array.from({ length: 32 }, () => 7));
  const episodeHashA = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 200));

  let universePda: PublicKey;

  before(async () => {
    [universePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creator.publicKey.toBuffer(), Buffer.from(universeHash)],
      universe.programId
    );
    await universe.methods
      .initializeUniverse(Array.from(universeHash), Array.from(plotHash), { public: {} } as never)
      .accounts({
        creator: creator.publicKey,
        universe: universePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  function episodeRecordPda(contentHash: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('episode'), universePda.toBuffer(), Buffer.from(contentHash)],
      episode.programId
    );
  }

  it('mints an episode record under a universe', async () => {
    const [pda] = episodeRecordPda(episodeHashA);
    await episode.methods
      .mintEpisode(Array.from(episodeHashA), 'ipfs://bafy...', 'Pilot')
      .accounts({
        creator: creator.publicKey,
        universe: universePda,
        episodeRecord: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const rec = await episode.account.episodeRecord.fetch(pda);
    expect(rec.universe.toBase58()).to.equal(universePda.toBase58());
    expect(rec.isCanon).to.equal(false);
  });

  it('rejects too-long metadata URI', async () => {
    const longUri = 'ipfs://' + 'a'.repeat(220);
    const bogusHash = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 240));
    const [pda] = episodeRecordPda(bogusHash);
    let err: unknown;
    try {
      await episode.methods
        .mintEpisode(Array.from(bogusHash), longUri, 'X')
        .accounts({
          creator: creator.publicKey,
          universe: universePda,
          episodeRecord: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/UriTooLong/);
  });

  it('rejects mint by non-universe-creator', async () => {
    const intruder = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(intruder.publicKey, 2e9);
    await provider.connection.confirmTransaction(sig);
    const otherHash = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 220));
    const [pda] = episodeRecordPda(otherHash);
    let err: unknown;
    try {
      await episode.methods
        .mintEpisode(Array.from(otherHash), 'ipfs://x', 'Y')
        .accounts({
          creator: intruder.publicKey,
          universe: universePda,
          episodeRecord: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Unauthorized/);
  });

  it('canonizes an episode and rejects double-canon', async () => {
    const [pda] = episodeRecordPda(episodeHashA);
    await episode.methods
      .canonize()
      .accounts({ signer: creator.publicKey, episodeRecord: pda })
      .rpc();
    const rec = await episode.account.episodeRecord.fetch(pda);
    expect(rec.isCanon).to.equal(true);

    let err: unknown;
    try {
      await episode.methods
        .canonize()
        .accounts({ signer: creator.publicKey, episodeRecord: pda })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/AlreadyCanon/);
  });
});
