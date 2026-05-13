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
  const episodeHashPaused = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 60));

  let universePda: PublicKey;
  const [universeConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('universe_config')],
    new PublicKey('6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD')
  );
  const [episodeConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('episode_config')],
    new PublicKey('voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs')
  );

  before(async () => {
    // Idempotent config bootstrap.
    const uCfg = await provider.connection.getAccountInfo(universeConfigPda);
    if (!uCfg) {
      await universe.methods
        .initializeConfig()
        .accounts({
          admin: creator.publicKey,
          config: universeConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    const eCfg = await provider.connection.getAccountInfo(episodeConfigPda);
    if (!eCfg) {
      await episode.methods
        .initializeConfig()
        .accounts({
          admin: creator.publicKey,
          config: episodeConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    [universePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creator.publicKey.toBuffer(), Buffer.from(universeHash)],
      universe.programId
    );
    await universe.methods
      .initializeUniverse(Array.from(universeHash), Array.from(plotHash), { public: {} } as never)
      .accounts({
        creator: creator.publicKey,
        universe: universePda,
        config: universeConfigPda,
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
        config: episodeConfigPda,
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
          config: episodeConfigPda,
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
          config: episodeConfigPda,
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
      .accounts({ signer: creator.publicKey, episodeRecord: pda, config: episodeConfigPda })
      .rpc();
    const rec = await episode.account.episodeRecord.fetch(pda);
    expect(rec.isCanon).to.equal(true);

    let err: unknown;
    try {
      await episode.methods
        .canonize()
        .accounts({ signer: creator.publicKey, episodeRecord: pda, config: episodeConfigPda })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/AlreadyCanon/);
  });

  it('blocks mint_episode while paused, then resumes after unpause', async () => {
    await episode.methods
      .pause()
      .accounts({ admin: creator.publicKey, config: episodeConfigPda })
      .rpc();

    const [pda] = episodeRecordPda(episodeHashPaused);
    let err: unknown;
    try {
      await episode.methods
        .mintEpisode(Array.from(episodeHashPaused), 'ipfs://x', 'Z')
        .accounts({
          creator: creator.publicKey,
          universe: universePda,
          episodeRecord: pda,
          config: episodeConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Paused/);

    await episode.methods
      .unpause()
      .accounts({ admin: creator.publicKey, config: episodeConfigPda })
      .rpc();

    await episode.methods
      .mintEpisode(Array.from(episodeHashPaused), 'ipfs://x', 'Z')
      .accounts({
        creator: creator.publicKey,
        universe: universePda,
        episodeRecord: pda,
        config: episodeConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const rec = await episode.account.episodeRecord.fetch(pda);
    expect(rec.isCanon).to.equal(false);
  });

  it('rejects pause from a non-admin', async () => {
    const intruder = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(intruder.publicKey, 1e9);
    await provider.connection.confirmTransaction(sig);
    let err: unknown;
    try {
      await episode.methods
        .pause()
        .accounts({ admin: intruder.publicKey, config: episodeConfigPda })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Unauthorized|AnchorError/);
  });
});
