/**
 * One-time staking program initialization on devnet/mainnet.
 *
 * Creates:
 *   - Config PDA (admin = deployer, lock period + penalty bps from env)
 *   - global_vault PDA authority + its $LOAR ATA
 *
 * Idempotent: re-running prints existing state without mutating.
 *
 * Env:
 *   SOLANA_CLUSTER                 'mainnet-beta' | 'devnet' (default: 'devnet')
 *   SOLANA_RPC_URL_DEVNET          devnet RPC
 *   SOLANA_RPC_URL_MAINNET         mainnet RPC
 *   LOAR_MINT_DEVNET               $LOAR mint (devnet)
 *   LOAR_MINT_MAINNET              $LOAR mint (mainnet)
 *   STAKING_TREASURY               treasury pubkey (defaults to deployer)
 *   STAKING_LIQUIDITY_POOL         penalty destination (defaults to deployer)
 *   STAKING_MIN_LOCK_SECS          lock period in seconds (default: 604800 = 7d)
 *   STAKING_EARLY_UNSTAKE_BPS      penalty bps (default: 500 = 5%)
 *   ANCHOR_WALLET                  deployer keypair path
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, Connection, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
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

  const idlPath = resolve(__dirname, '../target/idl/staking.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const treasury = new PublicKey(process.env.STAKING_TREASURY ?? deployerKp.publicKey.toBase58());
  const liquidityPool = new PublicKey(
    process.env.STAKING_LIQUIDITY_POOL ?? deployerKp.publicKey.toBase58()
  );
  const minLockSecs = Number(process.env.STAKING_MIN_LOCK_SECS ?? '604800');
  const earlyUnstakeBps = Number(process.env.STAKING_EARLY_UNSTAKE_BPS ?? '500');

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('staking_config')], programId);
  const [globalVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_vault')],
    programId
  );
  const globalVaultAta = getAssociatedTokenAddressSync(
    loarMint,
    globalVaultPda,
    true, // allow off-curve PDA owner
    TOKEN_2022_PROGRAM_ID
  );

  console.log(`Cluster:           ${cluster}`);
  console.log(`Program:           ${programId.toBase58()}`);
  console.log(`Deployer/admin:    ${deployerKp.publicKey.toBase58()}`);
  console.log(`LOAR mint:         ${loarMint.toBase58()}`);
  console.log(`Treasury:          ${treasury.toBase58()}`);
  console.log(`Liquidity pool:    ${liquidityPool.toBase58()}`);
  console.log(`Min lock secs:     ${minLockSecs}`);
  console.log(`Early unstake bps: ${earlyUnstakeBps}`);
  console.log(`Config PDA:        ${configPda.toBase58()}`);
  console.log(`Global vault PDA:  ${globalVaultPda.toBase58()}`);
  console.log(`Global vault ATA:  ${globalVaultAta.toBase58()}`);
  console.log('');

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (configAcct) {
    console.log('• initialize() — Config PDA already exists, skipping');
  } else {
    console.log('• initialize() — creating Config + global vault ATA…');
    const sig = await program.methods
      .initialize(treasury, liquidityPool, new anchor.BN(minLockSecs), earlyUnstakeBps)
      .accountsPartial({
        admin: deployerKp.publicKey,
        loarMint,
        config: configPda,
        globalVault: globalVaultPda,
        globalVaultAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ ${sig}`);
  }

  const cfg = (await program.account.config.fetch(configPda)) as {
    admin: PublicKey;
    treasury: PublicKey;
    liquidityPool: PublicKey;
    minLockPeriodSecs: anchor.BN;
    earlyUnstakePenaltyBps: number;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  admin:                    ${cfg.admin.toBase58()}`);
  console.log(`  treasury:                 ${cfg.treasury.toBase58()}`);
  console.log(`  liquidity_pool:           ${cfg.liquidityPool.toBase58()}`);
  console.log(`  min_lock_period_secs:     ${cfg.minLockPeriodSecs.toString()}`);
  console.log(`  early_unstake_penalty:    ${cfg.earlyUnstakePenaltyBps} bps`);
  console.log(`  paused:                   ${cfg.paused}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
