/**
 * One-time config bootstrap for universe + episode programs.
 *
 * After each program is (re)deployed, the singleton Config PDA must be
 * initialized exactly once. The Config holds `admin` + `paused` state and
 * is referenced by every mutating instruction. Idempotent — skips programs
 * whose Config already exists.
 *
 * Usage:
 *   pnpm tsx apps/programs/scripts/init-configs.ts
 *
 * Env:
 *   SOLANA_RPC_URL_DEVNET   Helius/Alchemy devnet RPC
 *   ANCHOR_WALLET           path to deployer keypair JSON (becomes admin)
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

async function initConfig(opts: {
  provider: anchor.AnchorProvider;
  idlPath: string;
  configSeed: string;
  programLabel: string;
  admin: Keypair;
}) {
  const idl = JSON.parse(readFileSync(opts.idlPath, 'utf-8'));
  const program = new anchor.Program(idl, opts.provider);
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(opts.configSeed)],
    program.programId
  );

  const existing = await opts.provider.connection.getAccountInfo(configPda, 'confirmed');
  if (existing) {
    console.log(`${opts.programLabel.padEnd(10)} config already exists: ${configPda.toBase58()}`);
    return;
  }

  console.log(`${opts.programLabel.padEnd(10)} initializing config…`);
  const sig = await program.methods
    .initializeConfig()
    .accounts({
      admin: opts.admin.publicKey,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(
    `${opts.programLabel.padEnd(10)} initialized → ${configPda.toBase58()} (tx ${sig.slice(0, 16)}…)`
  );
}

async function main() {
  const rpcUrl =
    process.env.SOLANA_RPC_URL_DEVNET ||
    process.env.SOLANA_RPC_URL ||
    'https://api.devnet.solana.com';

  const walletPath = process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json';
  const deployerKp = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(deployerKp);
  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  console.log(`RPC:    ${rpcUrl}`);
  console.log(`Admin:  ${deployerKp.publicKey.toBase58()}`);
  console.log('');

  await initConfig({
    provider,
    idlPath: resolve(__dirname, '../target/idl/universe.json'),
    configSeed: 'universe_config',
    programLabel: 'universe',
    admin: deployerKp,
  });
  await initConfig({
    provider,
    idlPath: resolve(__dirname, '../target/idl/episode.json'),
    configSeed: 'episode_config',
    programLabel: 'episode',
    admin: deployerKp,
  });
}

main().catch((err) => {
  console.error('init-configs failed:', err);
  process.exit(1);
});
