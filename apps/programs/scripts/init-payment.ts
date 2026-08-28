/**
 * One-time payment program initialization on devnet/mainnet.
 *
 * Calls in order:
 *   1. initialize(treasury, default_fee_bps)  — creates Config + SolVault + LoarVault PDAs
 *   2. set_loar_mint(LOAR_MINT)               — points Config.loar_mint at the $LOAR mint
 *   3. lock_loar_mint()                       — one-way switch, prevents future mint changes
 *
 * Idempotent: skips steps whose on-chain state is already correct.
 *
 * Usage:
 *   pnpm tsx apps/programs/scripts/init-payment.ts [--no-lock]
 *
 * Env:
 *   SOLANA_CLUSTER               'mainnet-beta' | 'devnet' (default: 'devnet')
 *   SOLANA_RPC_URL_DEVNET        devnet RPC (used when SOLANA_CLUSTER=devnet)
 *   SOLANA_RPC_URL_MAINNET       mainnet RPC (used when SOLANA_CLUSTER=mainnet-beta)
 *   SOLANA_RPC_URL               fallback for either cluster
 *   LOAR_MINT_DEVNET             $LOAR mint (used when SOLANA_CLUSTER=devnet)
 *   LOAR_MINT_MAINNET            $LOAR mint (used when SOLANA_CLUSTER=mainnet-beta)
 *   PAYMENT_TREASURY             treasury wallet (defaults to deployer keypair)
 *   DEFAULT_FEE_BPS              optional, defaults to 500 (5%)
 *   ANCHOR_WALLET                path to deployer keypair JSON
 *                                (defaults to ~/.config/solana/id.json)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, Connection, SystemProgram } from '@solana/web3.js';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const NO_LOCK = process.argv.includes('--no-lock');

function loadKeypair(path: string): Keypair {
  const expanded = path.startsWith('~') ? path.replace('~', homedir()) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expanded, 'utf-8'))));
}

async function main() {
  const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
  const isMainnet = cluster === 'mainnet-beta';

  const rpcUrl = isMainnet
    ? process.env.SOLANA_RPC_URL_MAINNET || process.env.SOLANA_RPC_URL
    : process.env.SOLANA_RPC_URL_DEVNET || process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      isMainnet
        ? 'SOLANA_RPC_URL_MAINNET or SOLANA_RPC_URL is required'
        : 'SOLANA_RPC_URL_DEVNET or SOLANA_RPC_URL is required'
    );
  }

  const loarMint = isMainnet ? process.env.LOAR_MINT_MAINNET : process.env.LOAR_MINT_DEVNET;
  if (!loarMint) {
    throw new Error(
      isMainnet
        ? 'LOAR_MINT_MAINNET is required when SOLANA_CLUSTER=mainnet-beta'
        : 'LOAR_MINT_DEVNET is required'
    );
  }

  const walletPath = process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json';
  const deployerKp = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(deployerKp);
  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  // Load the IDL emitted by anchor build.
  const idlPath = resolve(__dirname, '../target/idl/payment.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const treasury = new PublicKey(process.env.PAYMENT_TREASURY ?? deployerKp.publicKey.toBase58());
  const defaultFeeBps = Number(process.env.DEFAULT_FEE_BPS ?? '500');
  if (defaultFeeBps < 0 || defaultFeeBps > 1000) {
    throw new Error('DEFAULT_FEE_BPS must be in [0, 1000] (MAX_FEE_BPS=10%)');
  }

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
  const [solVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('sol_vault')], programId);
  const [loarVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('loar_vault')], programId);

  console.log(`Cluster:    ${cluster}`);
  console.log(`RPC:        ${rpcUrl}`);
  console.log(`Program:    ${programId.toBase58()}`);
  console.log(`Deployer:   ${deployerKp.publicKey.toBase58()}`);
  console.log(`Treasury:   ${treasury.toBase58()}`);
  console.log(`LOAR mint:  ${loarMint}`);
  console.log(`Config PDA: ${configPda.toBase58()}`);
  console.log('');

  // ── Step 1: initialize ────────────────────────────────────────────────────

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (!configAcct) {
    console.log('• initialize() — creating Config + SolVault + LoarVault…');
    const sig = await program.methods
      .initialize(treasury, defaultFeeBps)
      .accounts({
        owner: deployerKp.publicKey,
        config: configPda,
        solVault: solVaultPda,
        loarVault: loarVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ ${sig}`);
  } else {
    console.log('• initialize() — Config PDA already exists, skipping');
  }

  // ── Step 2: set_loar_mint ─────────────────────────────────────────────────

  // Re-read so we have post-init state.
  const config = (await program.account.config.fetch(configPda)) as {
    loarMint: PublicKey;
    loarLocked: boolean;
    owner: PublicKey;
    treasury: PublicKey;
    defaultFeeBps: number;
  };

  const desiredMint = new PublicKey(loarMint);
  if (config.loarMint.equals(desiredMint)) {
    console.log('• set_loar_mint() — already set correctly, skipping');
  } else if (config.loarLocked) {
    throw new Error(
      `loar_mint is locked to ${config.loarMint.toBase58()} but we want ${desiredMint.toBase58()} — cannot change`
    );
  } else {
    console.log(`• set_loar_mint(${desiredMint.toBase58()})…`);
    const sig = await program.methods
      .setLoarMint(desiredMint)
      .accounts({ owner: deployerKp.publicKey, config: configPda })
      .rpc();
    console.log(`  ✓ ${sig}`);
  }

  // ── Step 3: lock_loar_mint (one-way) ──────────────────────────────────────

  if (NO_LOCK) {
    console.log('• lock_loar_mint() — skipped (--no-lock)');
  } else {
    const reread = (await program.account.config.fetch(configPda)) as { loarLocked: boolean };
    if (reread.loarLocked) {
      console.log('• lock_loar_mint() — already locked, skipping');
    } else {
      console.log('• lock_loar_mint() — sealing $LOAR mint permanently…');
      const sig = await program.methods
        .lockLoarMint()
        .accounts({ owner: deployerKp.publicKey, config: configPda })
        .rpc();
      console.log(`  ✓ ${sig}`);
    }
  }

  // ── Final state dump ──────────────────────────────────────────────────────

  const final = (await program.account.config.fetch(configPda)) as {
    owner: PublicKey;
    treasury: PublicKey;
    loarMint: PublicKey;
    defaultFeeBps: number;
    loarLocked: boolean;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  owner:          ${final.owner.toBase58()}`);
  console.log(`  treasury:       ${final.treasury.toBase58()}`);
  console.log(`  loar_mint:      ${final.loarMint.toBase58()}`);
  console.log(`  default_fee_bps:${final.defaultFeeBps}`);
  console.log(`  loar_locked:    ${final.loarLocked}`);
  console.log(`  paused:         ${final.paused}`);
}

main().catch((err) => {
  console.error('init-payment failed:', err);
  process.exit(1);
});
