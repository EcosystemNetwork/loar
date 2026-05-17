/**
 * One-time fee_locker initialization on devnet/mainnet.
 *
 *   1. initialize_config() — creates Config PDA, admin = deployer.
 *
 * Idempotent: re-running prints existing state without mutating.
 * Depositors are added separately via `add_depositor`.
 *
 * Env:
 *   SOLANA_CLUSTER          'mainnet-beta' | 'devnet' (default: 'devnet')
 *   ANCHOR_WALLET           deployer keypair path
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

  const walletPath = process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json';
  const deployerKp = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(deployerKp);
  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const idlPath = resolve(__dirname, '../target/idl/fee_locker.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_locker_config')],
    programId
  );

  console.log(`Cluster:        ${cluster}`);
  console.log(`Program:        ${programId.toBase58()}`);
  console.log(`Deployer/admin: ${deployerKp.publicKey.toBase58()}`);
  console.log(`Config PDA:     ${configPda.toBase58()}`);
  console.log('');

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (configAcct) {
    console.log('• initialize_config() — Config PDA already exists, skipping');
  } else {
    console.log('• initialize_config() — creating Config…');
    const sig = await program.methods
      .initializeConfig()
      .accountsPartial({
        admin: deployerKp.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ ${sig}`);
  }

  const cfg = (await program.account.config.fetch(configPda)) as {
    admin: PublicKey;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  admin:  ${cfg.admin.toBase58()}`);
  console.log(`  paused: ${cfg.paused}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
