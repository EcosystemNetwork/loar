import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from 'chai';

describe('universe_manager', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.UniverseManager as Program<any>;
  const PROGRAM_ID = new PublicKey('UniMgrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

  const admin = provider.wallet;
  const treasury = Keypair.generate();
  const creator = Keypair.generate();
  const nonCreator = Keypair.generate();
  const nonAdmin = Keypair.generate();
  const newTreasury = Keypair.generate();

  let globalStatePda: PublicKey;
  let universePda: PublicKey;
  let nodePda: PublicKey;

  before(async () => {
    [globalStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('global_state')],
      program.programId
    );

    // Fund test accounts
    const airdrops = [creator, nonCreator, nonAdmin].map(async (kp) => {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      return provider.connection.confirmTransaction(sig);
    });
    await Promise.all(airdrops);
  });

  describe('initialize', () => {
    it('initializes global state with treasury', async () => {
      const tx = await program.methods
        .initialize()
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const state = await program.account.globalState.fetch(globalStatePda);
      assert.ok(state.admin.equals(admin.publicKey));
      assert.ok(state.treasury.equals(treasury.publicKey));
      assert.equal(state.universeCount.toNumber(), 0);
    });
  });

  describe('create_universe', () => {
    it('creates a universe and auto-increments count', async () => {
      const stateBefore = await program.account.globalState.fetch(globalStatePda);
      const universeIndex = stateBefore.universeCount.toNumber();

      [universePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('universe'), new anchor.BN(universeIndex).toArrayLike(Buffer, 'le', 8)],
        program.programId
      );

      const tx = await program.methods
        .createUniverse('Test Universe', 'A test universe description')
        .accounts({
          creator: creator.publicKey,
          globalState: globalStatePda,
          universe: universePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const universe = await program.account.universe.fetch(universePda);
      assert.ok(universe.creator.equals(creator.publicKey));
      assert.equal(universe.name, 'Test Universe');
      assert.equal(universe.nodeCount.toNumber(), 0);

      const stateAfter = await program.account.globalState.fetch(globalStatePda);
      assert.equal(
        stateAfter.universeCount.toNumber(),
        universeIndex + 1,
        'Universe count should auto-increment'
      );
    });

    it('collects creation fee when set', async () => {
      const creationFee = new anchor.BN(100_000); // 0.0001 SOL

      // Admin sets creation fee first
      await program.methods
        .setCreationFee(creationFee)
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePda,
        })
        .rpc();

      const stateBefore = await program.account.globalState.fetch(globalStatePda);
      const universeIndex = stateBefore.universeCount.toNumber();

      const [newUniversePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('universe'), new anchor.BN(universeIndex).toArrayLike(Buffer, 'le', 8)],
        program.programId
      );

      const treasuryBalanceBefore = await provider.connection.getBalance(treasury.publicKey);

      await program.methods
        .createUniverse('Fee Universe', 'Paid creation')
        .accounts({
          creator: creator.publicKey,
          globalState: globalStatePda,
          universe: newUniversePda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const treasuryBalanceAfter = await provider.connection.getBalance(treasury.publicKey);
      assert.ok(
        treasuryBalanceAfter > treasuryBalanceBefore,
        'Treasury should receive creation fee'
      );

      // Reset fee to 0 for subsequent tests
      await program.methods
        .setCreationFee(new anchor.BN(0))
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePda,
        })
        .rpc();
    });
  });

  describe('deploy_universe_token', () => {
    it('creator can deploy universe token', async () => {
      const [tokenMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('universe_token'), universePda.toBuffer()],
        program.programId
      );

      const tx = await program.methods
        .deployUniverseToken()
        .accounts({
          creator: creator.publicKey,
          universe: universePda,
          tokenMint: tokenMintPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([creator])
        .rpc();

      const universe = await program.account.universe.fetch(universePda);
      assert.ok(universe.tokenMint !== null, 'Token mint should be set');
      assert.ok(universe.tokenDeployed, 'Token deployed flag should be true');
    });

    it('cannot deploy token if already deployed', async () => {
      const [tokenMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('universe_token'), universePda.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .deployUniverseToken()
          .accounts({
            creator: creator.publicKey,
            universe: universePda,
            tokenMint: tokenMintPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([creator])
          .rpc();
        assert.fail('Expected error: token already deployed');
      } catch (err: any) {
        assert.include(err.toString(), 'TokenAlreadyDeployed');
      }
    });
  });

  describe('create_narrative_node', () => {
    it('creates a narrative node in universe', async () => {
      const nodeIndex = 0;
      [nodePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('node'),
          universePda.toBuffer(),
          new anchor.BN(nodeIndex).toArrayLike(Buffer, 'le', 8),
        ],
        program.programId
      );

      const contentHash = Array.from(Buffer.alloc(32, 1)); // dummy 32-byte hash

      const tx = await program.methods
        .createNarrativeNode(contentHash, null, null)
        .accounts({
          creator: creator.publicKey,
          universe: universePda,
          node: nodePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const node = await program.account.narrativeNode.fetch(nodePda);
      assert.ok(node.creator.equals(creator.publicKey));
      assert.ok(node.universe.equals(universePda));
      assert.equal(node.isCanon, false, 'Node should not be canon by default');
    });
  });

  describe('set_canon', () => {
    it('creator can set canon for a node in their universe', async () => {
      const tx = await program.methods
        .setCanon(true)
        .accounts({
          creator: creator.publicKey,
          universe: universePda,
          node: nodePda,
        })
        .signers([creator])
        .rpc();

      const node = await program.account.narrativeNode.fetch(nodePda);
      assert.equal(node.isCanon, true, 'Node should now be canon');
    });

    it('non-creator cannot set canon', async () => {
      try {
        await program.methods
          .setCanon(false)
          .accounts({
            creator: nonCreator.publicKey,
            universe: universePda,
            node: nodePda,
          })
          .signers([nonCreator])
          .rpc();
        assert.fail('Expected error: unauthorized');
      } catch (err: any) {
        assert.include(err.toString(), 'Unauthorized');
      }
    });
  });

  describe('admin settings', () => {
    it('admin can set creation fee', async () => {
      const fee = new anchor.BN(500_000);

      await program.methods
        .setCreationFee(fee)
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePda,
        })
        .rpc();

      const state = await program.account.globalState.fetch(globalStatePda);
      assert.equal(state.creationFee.toNumber(), 500_000);
    });

    it('non-admin cannot set fee', async () => {
      try {
        await program.methods
          .setCreationFee(new anchor.BN(999))
          .accounts({
            admin: nonAdmin.publicKey,
            globalState: globalStatePda,
          })
          .signers([nonAdmin])
          .rpc();
        assert.fail('Expected error: unauthorized');
      } catch (err: any) {
        assert.include(err.toString(), 'Unauthorized');
      }
    });

    it('admin can set treasury', async () => {
      await program.methods
        .setTreasury(newTreasury.publicKey)
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePda,
        })
        .rpc();

      const state = await program.account.globalState.fetch(globalStatePda);
      assert.ok(state.treasury.equals(newTreasury.publicKey));
    });

    it('rejects zero address for treasury', async () => {
      try {
        await program.methods
          .setTreasury(PublicKey.default)
          .accounts({
            admin: admin.publicKey,
            globalState: globalStatePda,
          })
          .rpc();
        assert.fail('Expected error: zero address');
      } catch (err: any) {
        assert.include(err.toString(), 'ZeroAddress');
      }
    });
  });

  describe('creator settings', () => {
    it('creator can set creation mode', async () => {
      // 0 = open, 1 = approval, 2 = closed
      await program.methods
        .setCreationMode(1)
        .accounts({
          creator: creator.publicKey,
          universe: universePda,
        })
        .signers([creator])
        .rpc();

      const universe = await program.account.universe.fetch(universePda);
      assert.equal(universe.creationMode, 1, 'Creation mode should be approval');
    });

    it('creator can set visibility mode', async () => {
      // 0 = public, 1 = private
      await program.methods
        .setVisibilityMode(1)
        .accounts({
          creator: creator.publicKey,
          universe: universePda,
        })
        .signers([creator])
        .rpc();

      const universe = await program.account.universe.fetch(universePda);
      assert.equal(universe.visibilityMode, 1, 'Visibility mode should be private');
    });
  });
});
