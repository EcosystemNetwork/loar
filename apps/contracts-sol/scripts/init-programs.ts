/**
 * LOAR Solana Program Initialization Script
 *
 * Initializes all 8 Anchor programs after `anchor deploy`.
 * Safe to re-run — each init is wrapped in try/catch so already-initialized
 * programs are skipped.
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/init-programs.ts
 */

import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
  // ── Provider & wallet ──────────────────────────────────────────────
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const deployer = provider.wallet.publicKey;

  console.log('=== LOAR Solana Program Initialization ===');
  console.log('Deployer:', deployer.toBase58());
  console.log('Cluster: ', provider.connection.rpcEndpoint);
  console.log('');

  const loarMint = process.env.LOAR_MINT ? new PublicKey(process.env.LOAR_MINT) : PublicKey.default;

  const backendSigner = process.env.BACKEND_SIGNER
    ? new PublicKey(process.env.BACKEND_SIGNER)
    : deployer;

  const liquidityPool = process.env.LIQUIDITY_POOL
    ? new PublicKey(process.env.LIQUIDITY_POOL)
    : PublicKey.default;

  let ok = 0;
  let skipped = 0;

  // ── 1. PaymentRouter ───────────────────────────────────────────────
  try {
    const paymentRouter = (anchor.workspace as any).PaymentRouter;
    const [routerConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('router_config')],
      paymentRouter.programId
    );

    await paymentRouter.methods
      .initialize(500) // 5 % platform fee (basis points)
      .accounts({
        authority: deployer,
        treasury: deployer, // change post-launch
        config: routerConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✓ PaymentRouter initialized (fee=500 bps, treasury=deployer)');
    ok++;
  } catch (e: any) {
    console.log('⚠ PaymentRouter — already initialized or error:', e.message);
    skipped++;
  }

  // ── 2. RightsRegistry ──────────────────────────────────────────────
  try {
    const rightsRegistry = (anchor.workspace as any).RightsRegistry;
    const [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('registry_config')],
      rightsRegistry.programId
    );

    await rightsRegistry.methods
      .initialize()
      .accounts({
        authority: deployer,
        config: registryConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✓ RightsRegistry initialized');
    ok++;
  } catch (e: any) {
    console.log('⚠ RightsRegistry — already initialized or error:', e.message);
    skipped++;
  }

  // ── 3. CreditManager ──────────────────────────────────────────────
  try {
    const creditManager = (anchor.workspace as any).CreditManager;
    const [creditConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('credit_config')],
      creditManager.programId
    );

    await creditManager.methods
      .initialize(loarMint, backendSigner)
      .accounts({
        authority: deployer,
        config: creditConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(
      `✓ CreditManager initialized (loarMint=${loarMint.toBase58()}, backendSigner=${backendSigner.toBase58()})`
    );
    ok++;
  } catch (e: any) {
    console.log('⚠ CreditManager — already initialized or error:', e.message);
    skipped++;
  }

  // ── 4. UniverseManager ─────────────────────────────────────────────
  try {
    const universeManager = (anchor.workspace as any).UniverseManager;
    const [globalState] = PublicKey.findProgramAddressSync(
      [Buffer.from('global_state')],
      universeManager.programId
    );

    await universeManager.methods
      .initializeGlobal()
      .accounts({
        authority: deployer,
        treasury: deployer, // change post-launch
        globalState,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✓ UniverseManager initialized (treasury=deployer)');
    ok++;
  } catch (e: any) {
    console.log('⚠ UniverseManager — already initialized or error:', e.message);
    skipped++;
  }

  // ── 5. LoarToken ───────────────────────────────────────────────────
  try {
    const loarToken = (anchor.workspace as any).LoarToken;
    const [loarConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('loar_config')],
      loarToken.programId
    );

    await loarToken.methods
      .initialize(liquidityPool)
      .accounts({
        authority: deployer,
        config: loarConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✓ LoarToken initialized (liquidityPool=${liquidityPool.toBase58()})`);
    ok++;
  } catch (e: any) {
    console.log('⚠ LoarToken — already initialized or error:', e.message);
    skipped++;
  }

  // ── 6–8. Per-universe NFT programs (no global init) ────────────────
  console.log('– NftEpisodes: no global init required (per-universe)');
  console.log('– NftCharacters: no global init required (per-universe)');
  console.log('– NftEntities: no global init required (per-universe)');

  // ── Summary ────────────────────────────────────────────────────────
  console.log('');
  console.log('=== Done ===');
  console.log(`Initialized: ${ok} | Skipped/errored: ${skipped}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Set LOAR_MINT after token mint is created, then re-run for CreditManager');
  console.log('  2. Set LIQUIDITY_POOL after LP is created, then re-run for LoarToken');
  console.log('  3. Transfer treasury to multisig before mainnet');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
