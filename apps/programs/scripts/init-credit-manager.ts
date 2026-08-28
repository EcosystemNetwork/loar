/**
 * One-time credit_manager initialization on devnet/mainnet.
 *
 * Creates:
 *   - Config PDA (admin = deployer, platform = env override or deployer)
 *   - sol_vault PDA (empty SolVault marker account; lamports accrue here)
 *   - loar_vault PDA authority + its $LOAR ATA
 *
 * Idempotent: re-running prints existing state without mutating.
 *
 * Env:
 *   SOLANA_CLUSTER                'mainnet-beta' | 'devnet' (default: 'devnet')
 *   LOAR_MINT_DEVNET / _MAINNET   $LOAR mint
 *   CREDIT_MANAGER_PLATFORM       platform key (defaults to deployer)
 *   CREDIT_DAILY_GRANT_LIMIT      default: 10_000_000 credits
 *   CREDIT_MAX_GRANT_PER_USER     default: 100_000 credits
 *   ANCHOR_WALLET                 deployer keypair path
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

  const idlPath = resolve(__dirname, '../target/idl/credit_manager.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const platform = new PublicKey(
    process.env.CREDIT_MANAGER_PLATFORM ?? deployerKp.publicKey.toBase58()
  );
  const dailyGrantLimit = new anchor.BN(process.env.CREDIT_DAILY_GRANT_LIMIT ?? '10000000');
  const maxGrantPerUser = new anchor.BN(process.env.CREDIT_MAX_GRANT_PER_USER ?? '100000');

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('credit_manager_config')],
    programId
  );
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('credit_sol_vault')],
    programId
  );
  const [loarVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('credit_loar_vault')],
    programId
  );
  const loarVaultAta = getAssociatedTokenAddressSync(
    loarMint,
    loarVaultPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(`Cluster:        ${cluster}`);
  console.log(`Program:        ${programId.toBase58()}`);
  console.log(`Deployer/admin: ${deployerKp.publicKey.toBase58()}`);
  console.log(`Platform key:   ${platform.toBase58()}`);
  console.log(`LOAR mint:      ${loarMint.toBase58()}`);
  console.log(`Daily grant:    ${dailyGrantLimit.toString()}`);
  console.log(`Max per-user:   ${maxGrantPerUser.toString()}`);
  console.log(`Config PDA:     ${configPda.toBase58()}`);
  console.log(`SOL vault PDA:  ${solVaultPda.toBase58()}`);
  console.log(`LOAR vault PDA: ${loarVaultPda.toBase58()}`);
  console.log(`LOAR vault ATA: ${loarVaultAta.toBase58()}`);
  console.log('');

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (configAcct) {
    console.log('• initialize() — Config PDA already exists, skipping');
  } else {
    console.log('• initialize() — creating Config + vaults…');
    const sig = await program.methods
      .initialize(platform, dailyGrantLimit, maxGrantPerUser)
      .accountsPartial({
        admin: deployerKp.publicKey,
        loarMint,
        config: configPda,
        solVault: solVaultPda,
        loarVault: loarVaultPda,
        loarVaultAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ ${sig}`);
  }

  const cfg = (await program.account.config.fetch(configPda)) as {
    admin: PublicKey;
    platform: PublicKey;
    loarMint: PublicKey;
    dailyGrantLimit: anchor.BN;
    maxGrantPerUser: anchor.BN;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  admin:               ${cfg.admin.toBase58()}`);
  console.log(`  platform:            ${cfg.platform.toBase58()}`);
  console.log(`  loar_mint:           ${cfg.loarMint.toBase58()}`);
  console.log(`  daily_grant_limit:   ${cfg.dailyGrantLimit.toString()}`);
  console.log(`  max_grant_per_user:  ${cfg.maxGrantPerUser.toString()}`);
  console.log(`  paused:              ${cfg.paused}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
