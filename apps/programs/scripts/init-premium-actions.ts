/**
 * One-time premium_actions initialization on devnet/mainnet.
 * (Crate was renamed from `loar_burner` on 2026-05-16 as part of BURN-01;
 * program ID and PDA seeds unchanged. `BURNER_*` env-var names retained for
 * deploy-config continuity — the legacy name is what existing setups use.)
 *
 *   1. initialize_config(treasury, lp, platform, lp_ratio_bps) — Config PDA.
 *
 * Idempotent: re-running prints existing state without mutating.
 *
 * Env:
 *   SOLANA_CLUSTER               'mainnet-beta' | 'devnet' (default: 'devnet')
 *   LOAR_MINT_DEVNET / _MAINNET  $LOAR mint
 *   BURNER_TREASURY              treasury pubkey (defaults to deployer)
 *   BURNER_LIQUIDITY_POOL        LP pubkey (defaults to deployer)
 *   BURNER_PLATFORM              platform key (defaults to deployer)
 *   BURNER_LP_RATIO_BPS          default: 5000 (50%)
 *   ANCHOR_WALLET                deployer keypair path
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
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL_* is required');

  const loarMintStr = isMainnet ? process.env.LOAR_MINT_MAINNET : process.env.LOAR_MINT_DEVNET;
  if (!loarMintStr) throw new Error(`LOAR_MINT_${isMainnet ? 'MAINNET' : 'DEVNET'} is required`);
  const loarMint = new PublicKey(loarMintStr);

  const walletPath = process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json';
  const deployerKp = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(deployerKp);
  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const idlPath = resolve(__dirname, '../target/idl/premium_actions.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const treasury = new PublicKey(process.env.BURNER_TREASURY ?? deployerKp.publicKey.toBase58());
  const lp = new PublicKey(process.env.BURNER_LIQUIDITY_POOL ?? deployerKp.publicKey.toBase58());
  const platform = new PublicKey(process.env.BURNER_PLATFORM ?? deployerKp.publicKey.toBase58());
  const lpRatioBps = Number(process.env.BURNER_LP_RATIO_BPS ?? '5000');

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('burner_config')], programId);

  console.log(`Cluster:        ${cluster}`);
  console.log(`Program:        ${programId.toBase58()}`);
  console.log(`Deployer/admin: ${deployerKp.publicKey.toBase58()}`);
  console.log(`LOAR mint:      ${loarMint.toBase58()}`);
  console.log(`Treasury:       ${treasury.toBase58()}`);
  console.log(`LP:             ${lp.toBase58()}`);
  console.log(`Platform:       ${platform.toBase58()}`);
  console.log(`LP ratio:       ${lpRatioBps} bps`);
  console.log(`Config PDA:     ${configPda.toBase58()}`);
  console.log('');

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (configAcct) {
    console.log('• initialize_config() — Config PDA already exists, skipping');
  } else {
    console.log('• initialize_config() — creating Config…');
    const sig = await program.methods
      .initializeConfig(treasury, lp, platform, lpRatioBps)
      .accountsPartial({
        admin: deployerKp.publicKey,
        loarMint,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ ${sig}`);
  }

  const cfg = (await program.account.config.fetch(configPda)) as {
    admin: PublicKey;
    treasury: PublicKey;
    liquidityPool: PublicKey;
    platform: PublicKey;
    lpRatioBps: number;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  admin:           ${cfg.admin.toBase58()}`);
  console.log(`  treasury:        ${cfg.treasury.toBase58()}`);
  console.log(`  liquidity_pool:  ${cfg.liquidityPool.toBase58()}`);
  console.log(`  platform:        ${cfg.platform.toBase58()}`);
  console.log(`  lp_ratio_bps:    ${cfg.lpRatioBps}`);
  console.log(`  paused:          ${cfg.paused}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
