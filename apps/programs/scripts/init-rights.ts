/**
 * One-time rights program initialization on devnet/mainnet.
 *
 * Calls in order:
 *   1. initialize_config(rights_operator) — creates Config PDA, sets admin
 *      (deployer) + rights_operator (the wallet allowed to push attestations).
 *
 * Idempotent: re-running prints the existing state without mutating.
 *
 * Usage:
 *   pnpm tsx apps/programs/scripts/init-rights.ts
 *
 * Env:
 *   SOLANA_CLUSTER          'mainnet-beta' | 'devnet' (default: 'devnet')
 *   SOLANA_RPC_URL_DEVNET   devnet RPC
 *   SOLANA_RPC_URL_MAINNET  mainnet RPC
 *   SOLANA_RPC_URL          fallback for either cluster
 *   RIGHTS_OPERATOR         pubkey of the rights operator (defaults to deployer)
 *   ANCHOR_WALLET           path to deployer keypair (defaults ~/.config/solana/id.json)
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
  if (!rpcUrl) {
    throw new Error(
      isMainnet
        ? 'SOLANA_RPC_URL_MAINNET or SOLANA_RPC_URL is required'
        : 'SOLANA_RPC_URL_DEVNET or SOLANA_RPC_URL is required'
    );
  }

  const walletPath = process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json';
  const deployerKp = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(deployerKp);
  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const idlPath = resolve(__dirname, '../target/idl/rights.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const rightsOperator = new PublicKey(
    process.env.RIGHTS_OPERATOR ?? deployerKp.publicKey.toBase58()
  );
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('rights_config')], programId);

  console.log(`Cluster:        ${cluster}`);
  console.log(`RPC:            ${rpcUrl}`);
  console.log(`Program:        ${programId.toBase58()}`);
  console.log(`Deployer/admin: ${deployerKp.publicKey.toBase58()}`);
  console.log(`Rights op:      ${rightsOperator.toBase58()}`);
  console.log(`Config PDA:     ${configPda.toBase58()}`);
  console.log('');

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (configAcct) {
    console.log('• initialize_config() — Config PDA already exists, skipping');
  } else {
    console.log('• initialize_config() — creating Config…');
    const sig = await program.methods
      .initializeConfig(rightsOperator)
      .accounts({
        admin: deployerKp.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ ${sig}`);
  }

  const cfg = (await program.account.config.fetch(configPda)) as {
    admin: PublicKey;
    pendingAdmin: PublicKey;
    rightsOperator: PublicKey;
    pendingRightsOperator: PublicKey;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  admin:                   ${cfg.admin.toBase58()}`);
  console.log(`  pending_admin:           ${cfg.pendingAdmin.toBase58()}`);
  console.log(`  rights_operator:         ${cfg.rightsOperator.toBase58()}`);
  console.log(`  pending_rights_operator: ${cfg.pendingRightsOperator.toBase58()}`);
  console.log(`  paused:                  ${cfg.paused}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
