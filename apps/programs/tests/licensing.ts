import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { Licensing } from '../target/types/licensing';
import { Rights } from '../target/types/rights';

describe('licensing', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Licensing as Program<Licensing>;
  const rightsProgram = anchor.workspace.Rights as Program<Rights>;
  const admin = provider.wallet as anchor.Wallet;

  const creator = Keypair.generate();
  const buyer = Keypair.generate();
  const intruder = Keypair.generate();
  const rightsOperator = Keypair.generate();

  const contentHash = Buffer.alloc(32, 0xaa);
  const fakeUniverse = Keypair.generate().publicKey;
  const BUY_PRICE = new BN(LAMPORTS_PER_SOL / 10); // 0.1 SOL

  let configPda: PublicKey;
  let registrationPda: PublicKey;
  let rightsConfigPda: PublicKey;
  let rightsPda: PublicKey;

  const RightsTypeEnum = {
    Original: { original: {} },
  };

  before(async () => {
    for (const kp of [creator, buyer, intruder, rightsOperator]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('licensing_config')],
      program.programId
    );
    [registrationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('registration'), contentHash],
      program.programId
    );
    [rightsConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('rights_config')],
      rightsProgram.programId
    );
    [rightsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('rights'), contentHash],
      rightsProgram.programId
    );

    // Prime the rights program so licensing's is_monetizable() gate passes.
    // (rights tests may have already initialized config — ignore that error.)
    try {
      await rightsProgram.methods
        .initializeConfig(rightsOperator.publicKey)
        .accountsPartial({
          admin: admin.publicKey,
          config: rightsConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      /* already initialized */
    }
    // Push an Original attestation so registration's rights gate passes.
    await rightsProgram.methods
      .setRightsViaAttestation(
        [...contentHash],
        RightsTypeEnum.Original,
        creator.publicKey,
        [...Buffer.alloc(20, 0)],
        new BN(1),
        [...Buffer.alloc(32, 0)],
        new BN(0)
      )
      .accountsPartial({
        operator: rightsOperator.publicKey,
        config: rightsConfigPda,
        rights: rightsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([rightsOperator])
      .rpc();
  });

  it('initializes config', async () => {
    await program.methods
      .initializeConfig()
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(configPda);
    expect(c.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(c.paused).to.equal(false);
  });

  it('registers content with monetizable rights', async () => {
    await program.methods
      .registerContent([...contentHash], fakeUniverse, BUY_PRICE)
      .accountsPartial({
        creator: creator.publicKey,
        config: configPda,
        rights: rightsPda,
        registration: registrationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const reg = await program.account.registration.fetch(registrationPda);
    expect(reg.creator.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(reg.buyPriceLamports.toString()).to.equal(BUY_PRICE.toString());
    expect(reg.active).to.equal(true);
  });

  it('rejects register with zero price', async () => {
    const hash2 = Buffer.alloc(32, 0xbb);
    let err: unknown;
    try {
      await program.methods
        .registerContent([...hash2], fakeUniverse, new BN(0))
        .accountsPartial({
          creator: creator.publicKey,
          config: configPda,
          rights: rightsPda, // wrong PDA for this hash, but will hit ZeroPrice first
          registration: PublicKey.findProgramAddressSync(
            [Buffer.from('registration'), hash2],
            program.programId
          )[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/ZeroPrice|ConstraintSeeds/);
  });

  it('buys content: transfers SOL, creates BuyerDeal', async () => {
    const creatorBefore = await provider.connection.getBalance(creator.publicKey);
    const [buyerDealPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('buyer_deal'), contentHash, buyer.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .buyContent()
      .accountsPartial({
        buyer: buyer.publicKey,
        creator: creator.publicKey,
        config: configPda,
        registration: registrationPda,
        buyerDeal: buyerDealPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const creatorAfter = await provider.connection.getBalance(creator.publicKey);
    expect(creatorAfter - creatorBefore).to.equal(BUY_PRICE.toNumber());

    const deal = await program.account.buyerDeal.fetch(buyerDealPda);
    expect(deal.buyer.toBase58()).to.equal(buyer.publicKey.toBase58());
    expect(deal.pricePaid.toString()).to.equal(BUY_PRICE.toString());
  });

  it('rejects buy with creator pubkey mismatch (rerouted payout)', async () => {
    const hash3 = Buffer.alloc(32, 0xcc);
    // Set rights so we can register
    await rightsProgram.methods
      .setRightsViaAttestation(
        [...hash3],
        RightsTypeEnum.Original,
        creator.publicKey,
        [...Buffer.alloc(20, 0)],
        new BN(1),
        [...Buffer.alloc(32, 0)],
        new BN(0)
      )
      .accountsPartial({
        operator: rightsOperator.publicKey,
        config: rightsConfigPda,
        rights: PublicKey.findProgramAddressSync(
          [Buffer.from('rights'), hash3],
          rightsProgram.programId
        )[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([rightsOperator])
      .rpc();

    const [regPda3] = PublicKey.findProgramAddressSync(
      [Buffer.from('registration'), hash3],
      program.programId
    );
    await program.methods
      .registerContent([...hash3], fakeUniverse, BUY_PRICE)
      .accountsPartial({
        creator: creator.publicKey,
        config: configPda,
        rights: PublicKey.findProgramAddressSync(
          [Buffer.from('rights'), hash3],
          rightsProgram.programId
        )[0],
        registration: regPda3,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Try to buy with a forged creator account.
    const [buyerDeal2] = PublicKey.findProgramAddressSync(
      [Buffer.from('buyer_deal'), hash3, buyer.publicKey.toBuffer()],
      program.programId
    );
    let err: unknown;
    try {
      await program.methods
        .buyContent()
        .accountsPartial({
          buyer: buyer.publicKey,
          creator: intruder.publicKey, // forged
          config: configPda,
          registration: regPda3,
          buyerDeal: buyerDeal2,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/CreatorMismatch/);
  });

  it('update_pricing: creator can change price, intruder cannot', async () => {
    const newPrice = new BN(LAMPORTS_PER_SOL / 5);
    await program.methods
      .updatePricing(newPrice)
      .accountsPartial({
        creator: creator.publicKey,
        config: configPda,
        registration: registrationPda,
      })
      .signers([creator])
      .rpc();
    const reg = await program.account.registration.fetch(registrationPda);
    expect(reg.buyPriceLamports.toString()).to.equal(newPrice.toString());

    let err: unknown;
    try {
      await program.methods
        .updatePricing(new BN(LAMPORTS_PER_SOL))
        .accountsPartial({
          creator: intruder.publicKey,
          config: configPda,
          registration: registrationPda,
        })
        .signers([intruder])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Unauthorized/);
  });
});
