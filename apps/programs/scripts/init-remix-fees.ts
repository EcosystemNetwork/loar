/**
 * One-time remix_fees initialization on devnet/mainnet.
 *
 *   1. initialize_config(treasury, lp, default_fee, min_fee, split_bps × 3)
 *      — creates Config PDA with 70/20/10 default split.
 *
 * Idempotent: re-running prints existing state without mutating.
 *
 * Env:
 *   SOLANA_CLUSTER                'mainnet-beta' | 'devnet' (default: 'devnet')
 *   LOAR_MINT_DEVNET / _MAINNET   $LOAR mint
 *   REMIX_TREASURY                treasury pubkey (defaults to deployer)
 *   REMIX_LIQUIDITY_POOL          LP pubkey (defaults to deployer)
 *   REMIX_DEFAULT_FEE             default fee in LOAR lamports (default: 10 LOAR @ 9 decimals)
 *   REMIX_MIN_FEE                 minimum fee (default: 1 LOAR)
 *   REMIX_CREATOR_BPS / LP_BPS / TREASURY_BPS  default 7000/2000/1000
 *   ANCHOR_WALLET                 deployer keypair path
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

  const idlPath = resolve(__dirname, '../target/idl/remix_fees.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const treasury = new PublicKey(process.env.REMIX_TREASURY ?? deployerKp.publicKey.toBase58());
  const liquidityPool = new PublicKey(
    process.env.REMIX_LIQUIDITY_POOL ?? deployerKp.publicKey.toBase58()
  );
  const defaultFee = new anchor.BN(process.env.REMIX_DEFAULT_FEE ?? '10000000000'); // 10 LOAR (9 decimals)
  const minFee = new anchor.BN(process.env.REMIX_MIN_FEE ?? '1000000000'); // 1 LOAR
  const creatorBps = Number(process.env.REMIX_CREATOR_BPS ?? '7000');
  const lpBps = Number(process.env.REMIX_LP_BPS ?? '2000');
  const treasuryBps = Number(process.env.REMIX_TREASURY_BPS ?? '1000');
  if (creatorBps + lpBps + treasuryBps !== 10000) {
    throw new Error(`Split bps must sum to 10000, got ${creatorBps + lpBps + treasuryBps}`);
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('remix_fees_config')],
    programId
  );

  console.log(`Cluster:        ${cluster}`);
  console.log(`Program:        ${programId.toBase58()}`);
  console.log(`Deployer/admin: ${deployerKp.publicKey.toBase58()}`);
  console.log(`LOAR mint:      ${loarMint.toBase58()}`);
  console.log(`Treasury:       ${treasury.toBase58()}`);
  console.log(`LP:             ${liquidityPool.toBase58()}`);
  console.log(`Default fee:    ${defaultFee.toString()}`);
  console.log(`Min fee:        ${minFee.toString()}`);
  console.log(`Split bps:      ${creatorBps}/${lpBps}/${treasuryBps} (creator/lp/treasury)`);
  console.log(`Config PDA:     ${configPda.toBase58()}`);
  console.log('');

  const configAcct = await connection.getAccountInfo(configPda, 'confirmed');
  if (configAcct) {
    console.log('• initialize_config() — Config PDA already exists, skipping');
  } else {
    console.log('• initialize_config() — creating Config…');
    const sig = await program.methods
      .initializeConfig(treasury, liquidityPool, defaultFee, minFee, creatorBps, lpBps, treasuryBps)
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
    loarMint: PublicKey;
    treasury: PublicKey;
    liquidityPool: PublicKey;
    defaultRemixFee: anchor.BN;
    minRemixFee: anchor.BN;
    creatorShareBps: number;
    lpShareBps: number;
    treasuryShareBps: number;
    paused: boolean;
  };
  console.log('');
  console.log('Final config state:');
  console.log(`  admin:                  ${cfg.admin.toBase58()}`);
  console.log(`  treasury:               ${cfg.treasury.toBase58()}`);
  console.log(`  liquidity_pool:         ${cfg.liquidityPool.toBase58()}`);
  console.log(`  default_remix_fee:      ${cfg.defaultRemixFee.toString()}`);
  console.log(`  min_remix_fee:          ${cfg.minRemixFee.toString()}`);
  console.log(
    `  split (creator/lp/tr):  ${cfg.creatorShareBps}/${cfg.lpShareBps}/${cfg.treasuryShareBps} bps`
  );
  console.log(`  paused:                 ${cfg.paused}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
