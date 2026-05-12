/**
 * Initialize the Payment program's singleton config on the active cluster.
 *
 * Reads the Payment IDL from apps/programs/target/idl/payment.json, derives
 * the config / sol_vault / loar_vault PDAs, and calls `initialize`. Then
 * (optionally) wires the deployed $LOAR mint via `setLoarMint`.
 *
 * Idempotent: if config already exists on-chain, prints state and exits.
 *
 * Usage:
 *   pnpm tsx scripts/solana/initialize-payment.ts                          # uses .env addresses
 *   pnpm tsx scripts/solana/initialize-payment.ts --treasury <pubkey> --fee 250 --loar-mint <pubkey>
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

type Cluster = 'devnet' | 'mainnet-beta' | 'testnet';

function rpcForCluster(cluster: Cluster): string {
  const fromEnv =
    cluster === 'mainnet-beta'
      ? process.env.SOLANA_RPC_URL_MAINNET
      : process.env.SOLANA_RPC_URL_DEVNET;
  return (
    arg('rpc') ??
    fromEnv ??
    process.env.SOLANA_RPC_URL ??
    (cluster === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com')
  );
}

async function main(): Promise<void> {
  const cluster = (arg('cluster') ?? process.env.SOLANA_CLUSTER ?? 'devnet') as Cluster;
  const rpcUrl = rpcForCluster(cluster);
  const walletPath = arg('wallet') ?? path.join(os.homedir(), '.config/solana/id.json');

  const payer = loadKeypair(walletPath);
  // Default treasury → deployer in dev; production sets a multisig.
  const treasury = new PublicKey(arg('treasury') ?? payer.publicKey.toBase58());
  const feeBps = Number.parseInt(arg('fee') ?? '250', 10); // 2.5%
  const loarMintArg = arg('loar-mint') ?? process.env.LOAR_MINT_DEVNET;

  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 90_000,
  });

  // Load the IDL.
  const idlPath = path.resolve(process.cwd(), 'apps/programs/target/idl/payment.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(
      `payment.json IDL not found at ${idlPath}. Run \`pnpm -F @loar/programs build\` first.`
    );
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);
  const programId = program.programId;

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
  const [solVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('sol_vault')], programId);
  const [loarVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('loar_vault')], programId);

  console.log(`[init-payment] cluster=${cluster}`);
  console.log(`[init-payment] program=${programId.toBase58()}`);
  console.log(`[init-payment] config=${configPda.toBase58()}`);
  console.log(`[init-payment] sol_vault=${solVaultPda.toBase58()}`);
  console.log(`[init-payment] loar_vault=${loarVaultPda.toBase58()}`);

  // If already initialized, print and exit.
  const existing = await connection.getAccountInfo(configPda);
  if (existing !== null) {
    const config = await (program.account as any).config.fetch(configPda);
    console.log('[init-payment] config already initialized:');
    console.log(`  owner=${config.owner.toBase58()}`);
    console.log(`  treasury=${config.treasury.toBase58()}`);
    console.log(`  default_fee_bps=${config.defaultFeeBps}`);
    console.log(`  loar_mint=${config.loarMint.toBase58()}`);
    console.log(`  loar_locked=${config.loarLocked}`);
    console.log(`  paused=${config.paused}`);
    return;
  }

  // Helper: submit an Anchor instruction without using sendAndConfirm
  // (paid RPCs reject `signatureSubscribe`). Build the tx, sign, broadcast,
  // then poll for inclusion via the shared polling helper.
  const { sendAndConfirmPolling } = await import('./lib/confirm');

  async function submit(buildTx: () => Promise<anchor.web3.Transaction>): Promise<string> {
    const tx = await buildTx();
    return sendAndConfirmPolling(connection, tx, [payer], { commitment: 'confirmed' });
  }

  // Step 1: initialize.
  console.log(
    `[init-payment] initializing config (treasury=${treasury.toBase58()} fee=${feeBps}bps)...`
  );
  const sig = await submit(() =>
    program.methods
      .initialize(treasury, feeBps)
      .accounts({
        owner: payer.publicKey,
        config: configPda,
        solVault: solVaultPda,
        loarVault: loarVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .transaction()
  );
  console.log(`[init-payment] initialize: ${sig}`);

  // Step 2 (optional): wire the $LOAR mint.
  if (loarMintArg) {
    const loarMint = new PublicKey(loarMintArg);
    console.log(`[init-payment] setting loar_mint=${loarMint.toBase58()}...`);
    const sig2 = await submit(() =>
      program.methods
        .setLoarMint(loarMint)
        .accounts({ owner: payer.publicKey, config: configPda })
        .transaction()
    );
    console.log(`[init-payment] set_loar_mint: ${sig2}`);
  } else {
    console.log('[init-payment] LOAR_MINT_DEVNET not set, skipping setLoarMint.');
  }

  console.log('[init-payment] done.');
}

main().catch((err) => {
  console.error('[init-payment] FAILED');
  console.error(err);
  process.exit(1);
});
