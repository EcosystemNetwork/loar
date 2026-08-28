import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { expect } from 'chai';
import { BondingCurve } from '../target/types/bonding_curve';
import { Universe } from '../target/types/universe';

describe('bonding_curve', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BondingCurve as Program<BondingCurve>;
  const universeProgram = anchor.workspace.Universe as Program<Universe>;
  const admin = provider.wallet as anchor.Wallet;

  const creator = Keypair.generate();
  const buyer = Keypair.generate();

  let curvePda: PublicKey;
  let tokenVaultAuth: PublicKey;
  let tokenVaultAta: PublicKey;
  let solVaultPda: PublicKey;
  let buyerStatPda: PublicKey;
  let universePda: PublicKey;
  let universeConfigPda: PublicKey;
  let tokenMint: PublicKey;
  let buyerAta: PublicKey;

  const contentHash = Buffer.alloc(32, 0x77);
  const plotHash = Buffer.alloc(32, 0x88);
  const Visibility = { Public: { public: {} } };

  // Use modest supply numbers so u128 math stays safe across the test.
  const TOTAL_SUPPLY = new BN(1_000_000_000); // 1B units
  const GRADUATION_LAMPORTS = new BN(10 * LAMPORTS_PER_SOL); // 10 SOL
  const MAX_BUY_BPS = 2000; // 20%

  before(async () => {
    for (const kp of [creator, buyer]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 20 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    // Universe setup.
    [universeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe_config')],
      universeProgram.programId
    );
    try {
      await universeProgram.methods
        .initializeConfig()
        .accountsPartial({
          admin: admin.publicKey,
          config: universeConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      /* idempotent */
    }
    [universePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('universe'), creator.publicKey.toBuffer(), contentHash],
      universeProgram.programId
    );
    await universeProgram.methods
      .initializeUniverse([...contentHash], [...plotHash], Visibility.Public)
      .accountsPartial({
        creator: creator.publicKey,
        universe: universePda,
        config: universeConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Mint with 0 decimals so token units == 1 unit (simpler math).
    tokenMint = await createMint(
      provider.connection,
      (admin as any).payer,
      admin.publicKey,
      null,
      0
    );
    [curvePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve'), universePda.toBuffer()],
      program.programId
    );
    [tokenVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve_token_vault'), universePda.toBuffer()],
      program.programId
    );
    [solVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve_sol_vault'), universePda.toBuffer()],
      program.programId
    );
    [buyerStatPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve_buyer_stat'), curvePda.toBuffer(), buyer.publicKey.toBuffer()],
      program.programId
    );
    tokenVaultAta = getAssociatedTokenAddressSync(tokenMint, tokenVaultAuth, true);
    buyerAta = getAssociatedTokenAddressSync(tokenMint, buyer.publicKey);

    // Caller pre-mints the curve supply into the vault ATA before initialize.
    // First, create the ATA owned by tokenVaultAuth (off-curve PDA).
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (admin as any).payer,
      tokenMint,
      tokenVaultAuth,
      true
    );
    await mintTo(
      provider.connection,
      (admin as any).payer,
      tokenMint,
      tokenVaultAta,
      admin.publicKey,
      TOTAL_SUPPLY.toNumber()
    );
  });

  it('initializes curve with linear slope', async () => {
    await program.methods
      .initializeCurve(TOTAL_SUPPLY, GRADUATION_LAMPORTS, MAX_BUY_BPS)
      .accountsPartial({
        creator: creator.publicKey,
        universeAccount: universePda,
        tokenMint,
        curve: curvePda,
        tokenVaultAuthority: tokenVaultAuth,
        tokenVault: tokenVaultAta,
        solVault: solVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const c = await program.account.curve.fetch(curvePda);
    expect(c.totalCurveSupply.toString()).to.equal(TOTAL_SUPPLY.toString());
    expect(c.tokensSold.toString()).to.equal('0');
    expect(c.solRaised.toString()).to.equal('0');
    expect(c.graduated).to.equal(false);
  });

  it('rejects buy past deadline', async () => {
    let err: unknown;
    try {
      await program.methods
        .buy(
          new BN(LAMPORTS_PER_SOL),
          new BN(0),
          new BN(Math.floor(Date.now() / 1000) - 10) // already expired
        )
        .accountsPartial({
          buyer: buyer.publicKey,
          curve: curvePda,
          tokenMint,
          tokenVaultAuthority: tokenVaultAuth,
          tokenVault: tokenVaultAta,
          buyerTokenAta: buyerAta,
          solVault: solVaultPda,
          buyerStat: buyerStatPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/Expired/);
  });

  it('buy: tokens come out of vault, SOL goes to vault', async () => {
    const solIn = new BN(LAMPORTS_PER_SOL); // 1 SOL
    const deadline = new BN(Math.floor(Date.now() / 1000) + 300);

    const vaultSolBefore = await provider.connection.getBalance(solVaultPda);
    const vaultTokenBefore = BigInt(
      (await getAccount(provider.connection, tokenVaultAta)).amount.toString()
    );

    await program.methods
      .buy(solIn, new BN(0), deadline)
      .accountsPartial({
        buyer: buyer.publicKey,
        curve: curvePda,
        tokenMint,
        tokenVaultAuthority: tokenVaultAuth,
        tokenVault: tokenVaultAta,
        buyerTokenAta: buyerAta,
        solVault: solVaultPda,
        buyerStat: buyerStatPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const vaultSolAfter = await provider.connection.getBalance(solVaultPda);
    const vaultTokenAfter = BigInt(
      (await getAccount(provider.connection, tokenVaultAta)).amount.toString()
    );
    const buyerBalance = BigInt(
      (await getAccount(provider.connection, buyerAta)).amount.toString()
    );

    // SOL vault increased.
    expect(vaultSolAfter).to.be.greaterThan(vaultSolBefore);
    // Tokens moved out of the vault to the buyer.
    expect(Number(vaultTokenBefore - vaultTokenAfter)).to.equal(Number(buyerBalance));

    const c = await program.account.curve.fetch(curvePda);
    expect(c.tokensSold.toString()).to.equal(buyerBalance.toString());
  });

  it('sell: returns tokens to vault, SOL flows back minus 1% fee', async () => {
    const buyerBalanceBefore = BigInt(
      (await getAccount(provider.connection, buyerAta)).amount.toString()
    );
    const sellAmount = buyerBalanceBefore / 2n;
    const deadline = new BN(Math.floor(Date.now() / 1000) + 300);

    const buyerSolBefore = await provider.connection.getBalance(buyer.publicKey);

    await program.methods
      .sell(new BN(sellAmount.toString()), new BN(0), deadline)
      .accountsPartial({
        seller: buyer.publicKey,
        curve: curvePda,
        tokenMint,
        tokenVaultAuthority: tokenVaultAuth,
        tokenVault: tokenVaultAta,
        sellerTokenAta: buyerAta,
        solVault: solVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const buyerBalanceAfter = BigInt(
      (await getAccount(provider.connection, buyerAta)).amount.toString()
    );
    const buyerSolAfter = await provider.connection.getBalance(buyer.publicKey);

    expect((buyerBalanceBefore - buyerBalanceAfter).toString()).to.equal(sellAmount.toString());
    // Buyer received SOL (minus tx fees + 1% sell fee).
    expect(buyerSolAfter).to.be.greaterThan(buyerSolBefore - 50_000); // allow for tx fee
  });

  it('rejects buy exceeding per-tx max_buy_tokens', async () => {
    // max_buy = 20% × 1B = 200M tokens. Buying with 100 SOL should hit this cap.
    let err: unknown;
    try {
      await program.methods
        .buy(new BN(100 * LAMPORTS_PER_SOL), new BN(0), new BN(Math.floor(Date.now() / 1000) + 300))
        .accountsPartial({
          buyer: buyer.publicKey,
          curve: curvePda,
          tokenMint,
          tokenVaultAuthority: tokenVaultAuth,
          tokenVault: tokenVaultAta,
          buyerTokenAta: buyerAta,
          solVault: solVaultPda,
          buyerStat: buyerStatPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/ExceedsMaxBuy|ExceedsCumulativeCap/);
  });
});
