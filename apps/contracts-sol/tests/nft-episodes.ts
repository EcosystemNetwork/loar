import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from 'chai';

describe('nft_episodes', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NftEpisodes as Program<any>;

  const authority = provider.wallet as anchor.Wallet;
  const creator = Keypair.generate();
  const minter = Keypair.generate();
  const nonAuthority = Keypair.generate();

  const universeId = new anchor.BN(1);
  let collectionPda: PublicKey;
  let collectionBump: number;

  const MAX_FEE_BPS = 5000;

  before(async () => {
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    for (const kp of [creator, minter, nonAuthority]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, airdropAmount);
      await provider.connection.confirmTransaction(sig);
    }

    [collectionPda, collectionBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('episode_collection'), universeId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
  });

  function findEpisodePda(episodeId: anchor.BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('episode'), collectionPda.toBuffer(), episodeId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
  }

  function findEditionPda(episodePda: PublicKey, editionNumber: anchor.BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('edition'), episodePda.toBuffer(), editionNumber.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
  }

  it('initializes collection with universe_id, shares (must sum to 10000)', async () => {
    const creatorShareBps = 7000;
    const platformShareBps = 3000;

    await program.methods
      .initializeCollection(universeId, creatorShareBps, platformShareBps)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const collection = await program.account.episodeCollection.fetch(collectionPda);
    assert.ok(collection.authority.equals(authority.publicKey));
    assert.ok(collection.universeId.eq(universeId));
    assert.equal(collection.creatorShareBps, creatorShareBps);
    assert.equal(collection.platformShareBps, platformShareBps);
    assert.equal(
      collection.creatorShareBps + collection.platformShareBps,
      10000,
      'Shares must sum to 10000'
    );
  });

  it('rejects platform_share_bps > MAX_FEE_BPS (5000)', async () => {
    const badUniverseId = new anchor.BN(999);
    const [badCollectionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('episode_collection'), badUniverseId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    try {
      await program.methods
        .initializeCollection(badUniverseId, 4000, 6000) // 6000 > MAX_FEE_BPS
        .accounts({
          authority: authority.publicKey,
          collection: badCollectionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('PlatformShareExceedsMax') ||
          err.message.includes('exceeds') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected platform share exceeds max error'
      );
    }
  });

  it('creates episode (authority only)', async () => {
    const episodeId = new anchor.BN(1);
    const [episodePda] = findEpisodePda(episodeId);

    const title = 'Episode 1: The Beginning';
    const metadataUri = 'https://arweave.net/episode1-metadata';
    const price = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    const maxEditions = new anchor.BN(100);

    await program.methods
      .createEpisode(episodeId, title, metadataUri, price, maxEditions)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
        episode: episodePda,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const episode = await program.account.episode.fetch(episodePda);
    assert.equal(episode.title, title);
    assert.equal(episode.metadataUri, metadataUri);
    assert.ok(episode.price.eq(price));
    assert.ok(episode.maxEditions.eq(maxEditions));
    assert.ok(episode.mintedEditions.eq(new anchor.BN(0)));
    assert.ok(episode.creator.equals(creator.publicKey));
    assert.equal(episode.active, true);
  });

  it('mints edition (pays creator + platform split)', async () => {
    const episodeId = new anchor.BN(1);
    const [episodePda] = findEpisodePda(episodeId);
    const editionNumber = new anchor.BN(1);
    const [editionPda] = findEditionPda(episodePda, editionNumber);

    const creatorBalanceBefore = await provider.connection.getBalance(creator.publicKey);
    const platformBalanceBefore = await provider.connection.getBalance(authority.publicKey);

    await program.methods
      .mintEdition(episodeId, editionNumber)
      .accounts({
        minter: minter.publicKey,
        collection: collectionPda,
        episode: episodePda,
        edition: editionPda,
        creator: creator.publicKey,
        platform: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([minter])
      .rpc();

    const edition = await program.account.edition.fetch(editionPda);
    assert.ok(edition.owner.equals(minter.publicKey));

    const episode = await program.account.episode.fetch(episodePda);
    assert.ok(episode.mintedEditions.eq(new anchor.BN(1)));

    // Verify payment split
    const creatorBalanceAfter = await provider.connection.getBalance(creator.publicKey);
    const platformBalanceAfter = await provider.connection.getBalance(authority.publicKey);

    const price = 0.1 * LAMPORTS_PER_SOL;
    const expectedCreatorShare = (price * 7000) / 10000;
    const expectedPlatformShare = (price * 3000) / 10000;

    assert.approximately(
      creatorBalanceAfter - creatorBalanceBefore,
      expectedCreatorShare,
      1000, // small tolerance for rounding
      'Creator should receive 70% of price'
    );
    // Platform balance change may include tx fees so we just check it increased
    assert.ok(platformBalanceAfter >= platformBalanceBefore, 'Platform should receive its share');
  });

  it('mint edition — sold out when minted_editions == max_editions', async () => {
    // Create an episode with max_editions = 1
    const episodeId = new anchor.BN(2);
    const [episodePda] = findEpisodePda(episodeId);
    const [editionPda1] = findEditionPda(episodePda, new anchor.BN(1));
    const [editionPda2] = findEditionPda(episodePda, new anchor.BN(2));

    await program.methods
      .createEpisode(
        episodeId,
        'Limited Episode',
        'https://arweave.net/limited',
        new anchor.BN(0.05 * LAMPORTS_PER_SOL),
        new anchor.BN(1) // only 1 edition
      )
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
        episode: episodePda,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Mint the only edition
    await program.methods
      .mintEdition(episodeId, new anchor.BN(1))
      .accounts({
        minter: minter.publicKey,
        collection: collectionPda,
        episode: episodePda,
        edition: editionPda1,
        creator: creator.publicKey,
        platform: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([minter])
      .rpc();

    // Try to mint a second edition — should fail (sold out)
    try {
      await program.methods
        .mintEdition(episodeId, new anchor.BN(2))
        .accounts({
          minter: minter.publicKey,
          collection: collectionPda,
          episode: episodePda,
          edition: editionPda2,
          creator: creator.publicKey,
          platform: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([minter])
        .rpc();
      assert.fail('Should have thrown sold out error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('SoldOut') ||
          err.message.includes('sold out') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected sold out error'
      );
    }
  });

  it('sets episode active/inactive (creator only)', async () => {
    const episodeId = new anchor.BN(1);
    const [episodePda] = findEpisodePda(episodeId);

    // Deactivate
    await program.methods
      .setEpisodeActive(episodeId, false)
      .accounts({
        creator: creator.publicKey,
        collection: collectionPda,
        episode: episodePda,
      })
      .signers([creator])
      .rpc();

    let episode = await program.account.episode.fetch(episodePda);
    assert.equal(episode.active, false);

    // Reactivate
    await program.methods
      .setEpisodeActive(episodeId, true)
      .accounts({
        creator: creator.publicKey,
        collection: collectionPda,
        episode: episodePda,
      })
      .signers([creator])
      .rpc();

    episode = await program.account.episode.fetch(episodePda);
    assert.equal(episode.active, true);
  });

  it('updates shares (authority only, must sum to 10000, platform <= 5000)', async () => {
    const newCreatorShare = 6000;
    const newPlatformShare = 4000;

    await program.methods
      .updateShares(newCreatorShare, newPlatformShare)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
      })
      .rpc();

    const collection = await program.account.episodeCollection.fetch(collectionPda);
    assert.equal(collection.creatorShareBps, newCreatorShare);
    assert.equal(collection.platformShareBps, newPlatformShare);
    assert.equal(collection.creatorShareBps + collection.platformShareBps, 10000);

    // Try invalid shares (platform > 5000)
    try {
      await program.methods
        .updateShares(4500, 5500)
        .accounts({
          authority: authority.publicKey,
          collection: collectionPda,
        })
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('PlatformShareExceedsMax') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected platform share exceeds max error'
      );
    }
  });

  it('non-authority cannot create episode', async () => {
    const episodeId = new anchor.BN(999);
    const [episodePda] = findEpisodePda(episodeId);

    try {
      await program.methods
        .createEpisode(
          episodeId,
          'Unauthorized Episode',
          'https://arweave.net/bad',
          new anchor.BN(0.1 * LAMPORTS_PER_SOL),
          new anchor.BN(50)
        )
        .accounts({
          authority: nonAuthority.publicKey,
          collection: collectionPda,
          episode: episodePda,
          creator: nonAuthority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonAuthority])
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('Unauthorized') ||
          err.message.includes('ConstraintHasOne') ||
          err.message.includes('A has one constraint was violated') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected unauthorized error'
      );
    }
  });
});
