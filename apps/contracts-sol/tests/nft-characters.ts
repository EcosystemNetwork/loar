import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from 'chai';

describe('nft_characters', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NftCharacters as Program<any>;

  const authority = provider.wallet as anchor.Wallet;
  const owner = Keypair.generate();
  const newOwner = Keypair.generate();
  const nonAuthority = Keypair.generate();
  const treasury = Keypair.generate();

  const universeId = new anchor.BN(1);
  let collectionPda: PublicKey;
  let collectionBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;

  before(async () => {
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    for (const kp of [owner, newOwner, nonAuthority, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, airdropAmount);
      await provider.connection.confirmTransaction(sig);
    }

    [collectionPda, collectionBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('char_collection'), universeId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('char_vault'), universeId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
  });

  function findCharacterPda(characterId: anchor.BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('character'),
        collectionPda.toBuffer(),
        characterId.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId
    );
  }

  it('initializes collection with vault PDA', async () => {
    const mintPrice = new anchor.BN(0.5 * LAMPORTS_PER_SOL);

    await program.methods
      .initializeCollection(universeId, mintPrice)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
        vault: vaultPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const collection = await program.account.characterCollection.fetch(collectionPda);
    assert.ok(collection.authority.equals(authority.publicKey));
    assert.ok(collection.universeId.eq(universeId));
    assert.ok(collection.vault.equals(vaultPda));
    assert.equal(collection.vaultBump, vaultBump);
    assert.ok(collection.treasury.equals(treasury.publicKey));
    assert.ok(collection.mintPrice.eq(mintPrice));
  });

  it('mints character (pays to treasury)', async () => {
    const characterId = new anchor.BN(1);
    const [characterPda] = findCharacterPda(characterId);

    const name = 'Hero Alpha';
    const metadataUri = 'https://arweave.net/char1-metadata';
    const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);

    await program.methods
      .mintCharacter(characterId, name, metadataUri)
      .accounts({
        minter: owner.publicKey,
        collection: collectionPda,
        character: characterPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const character = await program.account.character.fetch(characterPda);
    assert.equal(character.name, name);
    assert.equal(character.metadataUri, metadataUri);
    assert.ok(character.owner.equals(owner.publicKey));
    assert.ok(character.claimableRoyalties.eq(new anchor.BN(0)));

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    const mintPrice = 0.5 * LAMPORTS_PER_SOL;
    assert.approximately(
      treasuryAfter - treasuryBefore,
      mintPrice,
      1000,
      'Treasury should receive mint price'
    );
  });

  it('records appearance (authority deposits to vault PDA)', async () => {
    const characterId = new anchor.BN(1);
    const [characterPda] = findCharacterPda(characterId);

    const depositAmount = new anchor.BN(0.2 * LAMPORTS_PER_SOL);
    const vaultBefore = await provider.connection.getBalance(vaultPda);

    await program.methods
      .recordAppearance(characterId, depositAmount)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
        character: characterPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const character = await program.account.character.fetch(characterPda);
    assert.ok(
      character.claimableRoyalties.eq(depositAmount),
      'Character should have claimable royalties'
    );

    const vaultAfter = await provider.connection.getBalance(vaultPda);
    assert.approximately(
      vaultAfter - vaultBefore,
      depositAmount.toNumber(),
      1000,
      'Vault should receive deposit'
    );
  });

  it('claims royalties (owner withdraws from vault)', async () => {
    const characterId = new anchor.BN(1);
    const [characterPda] = findCharacterPda(characterId);

    const characterBefore = await program.account.character.fetch(characterPda);
    const claimable = characterBefore.claimableRoyalties;
    assert.ok(claimable.gt(new anchor.BN(0)), 'Should have royalties to claim');

    const ownerBefore = await provider.connection.getBalance(owner.publicKey);

    await program.methods
      .claimRoyalties(characterId)
      .accounts({
        owner: owner.publicKey,
        collection: collectionPda,
        character: characterPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const characterAfter = await program.account.character.fetch(characterPda);
    assert.ok(
      characterAfter.claimableRoyalties.eq(new anchor.BN(0)),
      'Claimable royalties should be zero after claim'
    );

    const ownerAfter = await provider.connection.getBalance(owner.publicKey);
    // Owner balance should increase by roughly the claimable amount minus tx fee
    const balanceChange = ownerAfter - ownerBefore;
    assert.ok(
      balanceChange > claimable.toNumber() - 10000, // tx fee tolerance
      'Owner should receive royalties minus tx fee'
    );
  });

  it('claim rejects if nothing to claim', async () => {
    const characterId = new anchor.BN(1);
    const [characterPda] = findCharacterPda(characterId);

    // Already claimed above, claimable should be 0
    try {
      await program.methods
        .claimRoyalties(characterId)
        .accounts({
          owner: owner.publicKey,
          collection: collectionPda,
          character: characterPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('NothingToClaim') ||
          err.message.includes('nothing to claim') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected nothing to claim error'
      );
    }
  });

  it('transfers character and updates owner', async () => {
    const characterId = new anchor.BN(1);
    const [characterPda] = findCharacterPda(characterId);

    await program.methods
      .transferCharacter(characterId)
      .accounts({
        owner: owner.publicKey,
        newOwner: newOwner.publicKey,
        collection: collectionPda,
        character: characterPda,
      })
      .signers([owner])
      .rpc();

    const character = await program.account.character.fetch(characterPda);
    assert.ok(character.owner.equals(newOwner.publicKey), 'Owner should be updated to new owner');
  });

  it('non-authority cannot record appearance', async () => {
    const characterId = new anchor.BN(1);
    const [characterPda] = findCharacterPda(characterId);
    const depositAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    try {
      await program.methods
        .recordAppearance(characterId, depositAmount)
        .accounts({
          authority: nonAuthority.publicKey,
          collection: collectionPda,
          character: characterPda,
          vault: vaultPda,
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

  it('non-owner cannot claim royalties', async () => {
    // First, deposit some royalties so there's something to claim
    const characterId = new anchor.BN(1);
    const [characterPda] = findCharacterPda(characterId);
    const depositAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    await program.methods
      .recordAppearance(characterId, depositAmount)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
        character: characterPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Non-owner tries to claim
    try {
      await program.methods
        .claimRoyalties(characterId)
        .accounts({
          owner: nonAuthority.publicKey,
          collection: collectionPda,
          character: characterPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonAuthority])
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('Unauthorized') ||
          err.message.includes('ConstraintHasOne') ||
          err.message.includes('owner') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected unauthorized / not owner error'
      );
    }
  });
});
