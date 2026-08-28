/**
 * One-time canon_market initialization on devnet/mainnet.
 *
 *   1. initialize_config(treasury, submission_fee, voting_period_secs, quorum_bps)
 *      — creates Config PDA. Submissions are per-(universe, content_hash);
 *      no global state to init beyond the singleton config.
 *
 * Idempotent: re-running prints existing state without mutating.
 *
 * Env:
 *   SOLANA_CLUSTER              'mainnet-beta' | 'devnet' (default: 'devnet')
 *   CANON_TREASURY              treasury pubkey (defaults to deployer)
 *   CANON_SUBMISSION_FEE        in lamports (default: 0.1 SOL = 100_000_000)
 *   CANON_VOTING_PERIOD_SECS    default: 86400 (24h)
 *   CANON_QUORUM_BPS            default: 1000 (10% of curve supply)
 *   ANCHOR_WALLET               deployer keypair path
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

  const idlPath = resolve(__dirname, '../target/idl/canon_market.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const treasury = new PublicKey(process.env.CANON_TREASURY ?? deployerKp.publicKey.toBase58());
  const submissionFee = new anchor.BN(process.env.CANON_SUBMISSION_FEE ?? '100000000');
  const votingPeriodSecs = new anchor.BN(process.env.CANON_VOTING_PERIOD_SECS ?? '86400');
  const quorumBps = Number(process.env.CANON_QUORUM_BPS ?? '1000');

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('canon_config')], programId);

  console.log(`Cluster:           ${cluster}`);
  console.log(`Program:           ${programId.toBase58()}`);
  console.log(`Deployer/admin:    ${deployerKp.publicKey.toBase58()}`);
  console.log(`Treasury:          ${treasury.toBase58()}`);
  console.log(`Submission fee:    ${submissionFee.toString()} lamports`);
  console.log(`Voting period:     ${votingPeriodSecs.toString()} secs`);
  console.log(`Quorum:            ${quorumBps} bps`);
  console.log(`Config PDA:        ${configPda.toBase58()}`);
  console.log('');

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (configAcct) {
    console.log('• initialize_config() — Config PDA already exists, skipping');
  } else {
    console.log('• initialize_config() — creating Config…');
    const sig = await program.methods
      .initializeConfig(treasury, submissionFee, votingPeriodSecs, quorumBps)
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
    treasury: PublicKey;
    submissionFeeLamports: anchor.BN;
    votingPeriodSecs: anchor.BN;
    quorumBps: number;
    nextSubmissionId: anchor.BN;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  admin:                  ${cfg.admin.toBase58()}`);
  console.log(`  treasury:               ${cfg.treasury.toBase58()}`);
  console.log(`  submission_fee:         ${cfg.submissionFeeLamports.toString()}`);
  console.log(`  voting_period_secs:     ${cfg.votingPeriodSecs.toString()}`);
  console.log(`  quorum_bps:             ${cfg.quorumBps}`);
  console.log(`  next_submission_id:     ${cfg.nextSubmissionId.toString()}`);
  console.log(`  paused:                 ${cfg.paused}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
