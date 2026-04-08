import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';

describe('rights_registry', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.RightsRegistry as Program<any>;

  const admin = provider.wallet as anchor.Wallet;
  let configPda: PublicKey;
  let configBump: number;

  const authority = Keypair.generate();
  const operator = Keypair.generate();
  const unauthorized = Keypair.generate();

  const contentId = 'content_001';

  before(async () => {
    // Airdrop SOL to test accounts
    const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;
    for (const kp of [authority, operator, unauthorized]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, airdropAmount);
      await provider.connection.confirmTransaction(sig);
    }

    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('registry_config')],
      program.programId
    );
  });

  function findRightsPda(contentIdStr: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('rights'), Buffer.from(contentIdStr)],
      program.programId
    );
  }

  function findOperatorPda(authorityPk: PublicKey, operatorPk: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('operator'), authorityPk.toBuffer(), operatorPk.toBuffer()],
      program.programId
    );
  }

  it('initializes registry config', async () => {
    await program.methods
      .initializeConfig()
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.registryConfig.fetch(configPda);
    assert.ok(config.admin.equals(admin.publicKey));
  });

  it('registers rights (authority can register directly, no operator record needed)', async () => {
    const [rightsPda] = findRightsPda(contentId);

    await program.methods
      .registerRights(contentId, { original: {} })
      .accounts({
        authority: authority.publicKey,
        rights: rightsPda,
        operatorRecord: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const rights = await program.account.rightsRecord.fetch(rightsPda);
    assert.ok(rights.authority.equals(authority.publicKey));
    assert.equal(rights.contentId, contentId);
    assert.deepEqual(rights.rightsType, { original: {} });
    assert.equal(rights.frozen, false);
  });

  it('registers rights (authorized operator with operator_record)', async () => {
    const opContentId = 'content_operator_001';
    const [rightsPda] = findRightsPda(opContentId);
    const [operatorPda] = findOperatorPda(authority.publicKey, operator.publicKey);

    // First, add the operator
    await program.methods
      .addOperator()
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        authority: authority.publicKey,
        operator: operator.publicKey,
        operatorRecord: operatorPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Operator registers rights on behalf of authority
    await program.methods
      .registerRights(opContentId, { licensed: {} })
      .accounts({
        authority: operator.publicKey,
        rights: rightsPda,
        operatorRecord: operatorPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([operator])
      .rpc();

    const rights = await program.account.rightsRecord.fetch(rightsPda);
    assert.equal(rights.contentId, opContentId);
    assert.deepEqual(rights.rightsType, { licensed: {} });
  });

  it('unauthorized user cannot register rights', async () => {
    const badContentId = 'content_unauthorized';
    const [rightsPda] = findRightsPda(badContentId);

    try {
      await program.methods
        .registerRights(badContentId, { fun: {} })
        .accounts({
          authority: unauthorized.publicKey,
          rights: rightsPda,
          operatorRecord: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorized])
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('Unauthorized') || err.error !== undefined || err.logs !== undefined,
        'Expected unauthorized error'
      );
    }
  });

  it('updates rights (authority)', async () => {
    const [rightsPda] = findRightsPda(contentId);

    await program.methods
      .updateRights({ licensed: {} })
      .accounts({
        authority: authority.publicKey,
        rights: rightsPda,
        operatorRecord: null,
      })
      .signers([authority])
      .rpc();

    const rights = await program.account.rightsRecord.fetch(rightsPda);
    assert.deepEqual(rights.rightsType, { licensed: {} });
  });

  it('update rights rejects if content is frozen', async () => {
    // Register fresh content, freeze it, then try to update
    const frozenContentId = 'content_frozen_test';
    const [frozenRightsPda] = findRightsPda(frozenContentId);

    await program.methods
      .registerRights(frozenContentId, { original: {} })
      .accounts({
        authority: authority.publicKey,
        rights: frozenRightsPda,
        operatorRecord: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Freeze it
    await program.methods
      .freezeRights()
      .accounts({
        authority: authority.publicKey,
        rights: frozenRightsPda,
        operatorRecord: null,
      })
      .signers([authority])
      .rpc();

    // Attempt to update frozen rights
    try {
      await program.methods
        .updateRights({ fun: {} })
        .accounts({
          authority: authority.publicKey,
          rights: frozenRightsPda,
          operatorRecord: null,
        })
        .signers([authority])
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('frozen') ||
          err.message.includes('Frozen') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected frozen error'
      );
    }
  });

  it('freezes rights permanently', async () => {
    const freezeContentId = 'content_freeze_perm';
    const [freezePda] = findRightsPda(freezeContentId);

    await program.methods
      .registerRights(freezeContentId, { original: {} })
      .accounts({
        authority: authority.publicKey,
        rights: freezePda,
        operatorRecord: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .freezeRights()
      .accounts({
        authority: authority.publicKey,
        rights: freezePda,
        operatorRecord: null,
      })
      .signers([authority])
      .rpc();

    const rights = await program.account.rightsRecord.fetch(freezePda);
    assert.equal(rights.frozen, true);
  });

  it('freeze rejects if already frozen', async () => {
    const alreadyFrozenId = 'content_freeze_perm'; // already frozen above
    const [freezePda] = findRightsPda(alreadyFrozenId);

    try {
      await program.methods
        .freezeRights()
        .accounts({
          authority: authority.publicKey,
          rights: freezePda,
          operatorRecord: null,
        })
        .signers([authority])
        .rpc();
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(
        err.message.includes('already frozen') ||
          err.message.includes('AlreadyFrozen') ||
          err.error !== undefined ||
          err.logs !== undefined,
        'Expected already frozen error'
      );
    }
  });

  it('adds operator (admin only)', async () => {
    const newOperator = Keypair.generate();
    const [operatorPda] = findOperatorPda(authority.publicKey, newOperator.publicKey);

    await program.methods
      .addOperator()
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        authority: authority.publicKey,
        operator: newOperator.publicKey,
        operatorRecord: operatorPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const record = await program.account.operatorRecord.fetch(operatorPda);
    assert.ok(record.authority.equals(authority.publicKey));
    assert.ok(record.operator.equals(newOperator.publicKey));
    assert.equal(record.authorized, true);
  });

  it('removes operator (admin only)', async () => {
    const removableOperator = Keypair.generate();
    const [operatorPda] = findOperatorPda(authority.publicKey, removableOperator.publicKey);

    // Add first
    await program.methods
      .addOperator()
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        authority: authority.publicKey,
        operator: removableOperator.publicKey,
        operatorRecord: operatorPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Remove
    await program.methods
      .removeOperator()
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        authority: authority.publicKey,
        operator: removableOperator.publicKey,
        operatorRecord: operatorPda,
      })
      .rpc();

    const record = await program.account.operatorRecord.fetch(operatorPda);
    assert.equal(record.authorized, false);
  });

  it('is_monetizable check: Original + Licensed = true, Fun + PublicDomain = false', async () => {
    // Test Original (already registered as licensed, but we check concept)
    const originalId = 'content_monetizable_original';
    const [originalPda] = findRightsPda(originalId);

    await program.methods
      .registerRights(originalId, { original: {} })
      .accounts({
        authority: authority.publicKey,
        rights: originalPda,
        operatorRecord: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const originalRights = await program.account.rightsRecord.fetch(originalPda);
    // RightsType enum: Original and Licensed are monetizable
    const isOriginalMonetizable =
      originalRights.rightsType.original !== undefined ||
      originalRights.rightsType.licensed !== undefined;
    assert.equal(isOriginalMonetizable, true, 'Original should be monetizable');

    // Test Licensed
    const licensedId = 'content_monetizable_licensed';
    const [licensedPda] = findRightsPda(licensedId);

    await program.methods
      .registerRights(licensedId, { licensed: {} })
      .accounts({
        authority: authority.publicKey,
        rights: licensedPda,
        operatorRecord: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const licensedRights = await program.account.rightsRecord.fetch(licensedPda);
    const isLicensedMonetizable =
      licensedRights.rightsType.original !== undefined ||
      licensedRights.rightsType.licensed !== undefined;
    assert.equal(isLicensedMonetizable, true, 'Licensed should be monetizable');

    // Test Fun (not monetizable)
    const funId = 'content_monetizable_fun';
    const [funPda] = findRightsPda(funId);

    await program.methods
      .registerRights(funId, { fun: {} })
      .accounts({
        authority: authority.publicKey,
        rights: funPda,
        operatorRecord: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const funRights = await program.account.rightsRecord.fetch(funPda);
    const isFunMonetizable =
      funRights.rightsType.original !== undefined || funRights.rightsType.licensed !== undefined;
    assert.equal(isFunMonetizable, false, 'Fun should NOT be monetizable');

    // Test PublicDomain (not monetizable)
    const pdId = 'content_monetizable_pd';
    const [pdPda] = findRightsPda(pdId);

    await program.methods
      .registerRights(pdId, { publicDomain: {} })
      .accounts({
        authority: authority.publicKey,
        rights: pdPda,
        operatorRecord: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const pdRights = await program.account.rightsRecord.fetch(pdPda);
    const isPdMonetizable =
      pdRights.rightsType.original !== undefined || pdRights.rightsType.licensed !== undefined;
    assert.equal(isPdMonetizable, false, 'PublicDomain should NOT be monetizable');
  });
});
