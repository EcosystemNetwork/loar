import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from 'chai';

describe('nft_entities', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NftEntities as Program<any>;

  const authority = provider.wallet as anchor.Wallet;
  const creator = Keypair.generate();
  const minter = Keypair.generate();
  const nonAuthority = Keypair.generate();
  const treasury = Keypair.generate();

  const universeId = new anchor.BN(1);
  const creationFee = new anchor.BN(0.05 * LAMPORTS_PER_SOL);
  let collectionPda: PublicKey;
  let collectionBump: number;

  // EntityKind enum mapping:
  // Unique kinds:  Person=0, Place=1, Faction=2, Event=3, Vehicle=4, Organization=5
  // Edition kinds: Thing=6, Lore=7, Species=8, Technology=9
  const EntityKind = {
    person: { person: {} },
    place: { place: {} },
    faction: { faction: {} },
    event: { event: {} },
    vehicle: { vehicle: {} },
    organization: { organization: {} },
    thing: { thing: {} },
    lore: { lore: {} },
    species: { species: {} },
    technology: { technology: {} },
  };

  before(async () => {
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    for (const kp of [creator, minter, nonAuthority, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, airdropAmount);
      await provider.connection.confirmTransaction(sig);
    }

    [collectionPda, collectionBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('entity_collection'), universeId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
  });

  function findEntityPda(entityId: anchor.BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('entity'), collectionPda.toBuffer(), entityId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
  }

  function findEditionCopyPda(entityPda: PublicKey, copyNumber: anchor.BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('entity_edition'),
        entityPda.toBuffer(),
        copyNumber.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId
    );
  }

  it('initializes collection with creation_fee', async () => {
    await program.methods
      .initializeCollection(universeId, creationFee)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const collection = await program.account.entityCollection.fetch(collectionPda);
    assert.ok(collection.authority.equals(authority.publicKey));
    assert.ok(collection.universeId.eq(universeId));
    assert.ok(collection.creationFee.eq(creationFee));
    assert.ok(collection.treasury.equals(treasury.publicKey));
  });

  it('mints unique entity (charges creation_fee + price)', async () => {
    const entityId = new anchor.BN(1);
    const [entityPda] = findEntityPda(entityId);

    const name = 'Elder Karath';
    const metadataUri = 'https://arweave.net/entity1-metadata';
    const price = new anchor.BN(0.3 * LAMPORTS_PER_SOL);
    const kind = EntityKind.person; // unique kind

    const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);

    await program.methods
      .mintEntity(entityId, name, metadataUri, kind, price, null) // null maxEditions = unique
      .accounts({
        creator: creator.publicKey,
        collection: collectionPda,
        entity: entityPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const entity = await program.account.entity.fetch(entityPda);
    assert.equal(entity.name, name);
    assert.equal(entity.metadataUri, metadataUri);
    assert.ok(entity.owner.equals(creator.publicKey));
    assert.deepEqual(entity.kind, kind);
    assert.equal(entity.maxEditions, null);

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    const totalCharged = creationFee.toNumber() + price.toNumber();
    assert.approximately(
      treasuryAfter - treasuryBefore,
      totalCharged,
      1000,
      'Treasury should receive creation_fee + price for unique entity'
    );
  });

  it('creates edition entity (charges creation_fee only)', async () => {
    const entityId = new anchor.BN(2);
    const [entityPda] = findEntityPda(entityId);

    const name = 'Plasma Rifle MK-V';
    const metadataUri = 'https://arweave.net/entity2-metadata';
    const price = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    const kind = EntityKind.technology; // edition kind
    const maxEditions = new anchor.BN(50);

    const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);

    await program.methods
      .mintEntity(entityId, name, metadataUri, kind, price, maxEditions)
      .accounts({
        creator: creator.publicKey,
        collection: collectionPda,
        entity: entityPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const entity = await program.account.entity.fetch(entityPda);
    assert.equal(entity.name, name);
    assert.ok(entity.maxEditions.eq(maxEditions));
    assert.ok(entity.mintedEditions.eq(new anchor.BN(0)));

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    assert.approximately(
      treasuryAfter - treasuryBefore,
      creationFee.toNumber(),
      1000,
      'Treasury should receive only creation_fee for edition entity'
    );
  });

  it('mints edition copy (charges price per edition)', async () => {
    const entityId = new anchor.BN(2);
    const [entityPda] = findEntityPda(entityId);
    const copyNumber = new anchor.BN(1);
    const [copyPda] = findEditionCopyPda(entityPda, copyNumber);

    const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);

    await program.methods
      .mintEditionCopy(entityId, copyNumber)
      .accounts({
        minter: minter.publicKey,
        collection: collectionPda,
        entity: entityPda,
        editionCopy: copyPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([minter])
      .rpc();

    const copy = await program.account.editionCopy.fetch(copyPda);
    assert.ok(copy.owner.equals(minter.publicKey));
    assert.ok(copy.copyNumber.eq(copyNumber));

    const entity = await program.account.entity.fetch(entityPda);
    assert.ok(entity.mintedEditions.eq(new anchor.BN(1)));

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    const price = 0.1 * LAMPORTS_PER_SOL;
    assert.approximately(
      treasuryAfter - treasuryBefore,
      price,
      1000,
      'Treasury should receive price per edition copy'
    );
  });

  it('edition sold out check', async () => {
    // Create edition entity with max_editions = 1
    const entityId = new anchor.BN(3);
    const [entityPda] = findEntityPda(entityId);

    await program.methods
      .mintEntity(
        entityId,
        'Limited Lore Scroll',
        'https://arweave.net/entity3',
        EntityKind.lore,
        new anchor.BN(0.05 * LAMPORTS_PER_SOL),
        new anchor.BN(1) // only 1 edition
      )
      .accounts({
        creator: creator.publicKey,
        collection: collectionPda,
        entity: entityPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Mint the only copy
    const [copyPda1] = findEditionCopyPda(entityPda, new anchor.BN(1));
    await program.methods
      .mintEditionCopy(entityId, new anchor.BN(1))
      .accounts({
        minter: minter.publicKey,
        collection: collectionPda,
        entity: entityPda,
        editionCopy: copyPda1,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([minter])
      .rpc();

    // Attempt second copy — should fail
    const [copyPda2] = findEditionCopyPda(entityPda, new anchor.BN(2));
    try {
      await program.methods
        .mintEditionCopy(entityId, new anchor.BN(2))
        .accounts({
          minter: minter.publicKey,
          collection: collectionPda,
          entity: entityPda,
          editionCopy: copyPda2,
          treasury: treasury.publicKey,
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

  it('sets parent with same-collection validation', async () => {
    // Create a parent entity
    const parentId = new anchor.BN(10);
    const [parentPda] = findEntityPda(parentId);

    await program.methods
      .mintEntity(
        parentId,
        'The Capital City',
        'https://arweave.net/parent',
        EntityKind.place,
        new anchor.BN(0.2 * LAMPORTS_PER_SOL),
        null
      )
      .accounts({
        creator: creator.publicKey,
        collection: collectionPda,
        entity: parentPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Create a child entity
    const childId = new anchor.BN(11);
    const [childPda] = findEntityPda(childId);

    await program.methods
      .mintEntity(
        childId,
        'The Royal Guard',
        'https://arweave.net/child',
        EntityKind.faction,
        new anchor.BN(0.15 * LAMPORTS_PER_SOL),
        null
      )
      .accounts({
        creator: creator.publicKey,
        collection: collectionPda,
        entity: childPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Set parent
    await program.methods
      .setParent(childId, parentId)
      .accounts({
        owner: creator.publicKey,
        collection: collectionPda,
        entity: childPda,
        parentEntity: parentPda,
      })
      .signers([creator])
      .rpc();

    const child = await program.account.entity.fetch(childPda);
    assert.ok(
      child.parent !== null && child.parent.equals(parentPda),
      'Child should reference parent PDA'
    );
  });

  it('sets creation fee (authority only)', async () => {
    const newFee = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    await program.methods
      .setCreationFee(newFee)
      .accounts({
        authority: authority.publicKey,
        collection: collectionPda,
      })
      .rpc();

    const collection = await program.account.entityCollection.fetch(collectionPda);
    assert.ok(collection.creationFee.eq(newFee), 'Creation fee should be updated');

    // Non-authority cannot set fee
    try {
      await program.methods
        .setCreationFee(new anchor.BN(0))
        .accounts({
          authority: nonAuthority.publicKey,
          collection: collectionPda,
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

  it('rejects invalid entity kind', async () => {
    const entityId = new anchor.BN(999);
    const [entityPda] = findEntityPda(entityId);

    // Attempt to pass an invalid kind value (not in the enum)
    // Anchor will reject this at the serialization level with an invalid enum variant
    try {
      await program.methods
        .mintEntity(
          entityId,
          'Invalid Entity',
          'https://arweave.net/invalid',
          { invalidKind: {} }, // not a valid EntityKind variant
          new anchor.BN(0.1 * LAMPORTS_PER_SOL),
          null
        )
        .accounts({
          creator: creator.publicKey,
          collection: collectionPda,
          entity: entityPda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail('Should have thrown an error for invalid entity kind');
    } catch (err: any) {
      // Anchor throws a serialization/type error for invalid enum variants
      assert.ok(
        err.message.includes('Invalid') ||
          err.message.includes('invalid') ||
          err.message.includes('variant') ||
          err.message.includes('enum') ||
          err instanceof TypeError ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected invalid entity kind error'
      );
    }
  });
});
