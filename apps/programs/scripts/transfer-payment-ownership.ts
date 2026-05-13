/**
 * Two-step payment program ownership transfer.
 *
 * The payment program uses propose/accept ownership to prevent typo'd or
 * dead addresses from locking the program. This script handles the operator
 * side (step 1: propose) and prints the cypher the accepter must run
 * (step 2: accept — done by the multisig holding NEW_OWNER's keys).
 *
 * Usage:
 *   # Step 1 (current owner): propose a new owner
 *   pnpm tsx apps/programs/scripts/transfer-payment-ownership.ts <NEW_OWNER>
 *
 *   # Step 2 (the proposed new owner): accept
 *   pnpm tsx apps/programs/scripts/transfer-payment-ownership.ts --accept
 *
 *   # Verify
 *   pnpm tsx apps/programs/scripts/transfer-payment-ownership.ts --verify
 *
 * For a Squads multisig destination, step 2 is a propose-vote-execute flow
 * inside Squads, not this script — but the script prints the ix data the
 * Squads proposer needs.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

function loadKeypair(path: string): Keypair {
  const expanded = path.startsWith('~') ? path.replace('~', homedir()) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expanded, 'utf-8'))));
}

const VERIFY = process.argv.includes('--verify');
const ACCEPT = process.argv.includes('--accept');
const newOwnerArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));

async function main() {
  const rpcUrl =
    process.env.SOLANA_RPC_URL_DEVNET ||
    process.env.SOLANA_RPC_URL ||
    'https://api.devnet.solana.com';
  const walletPath = process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json';
  const signerKp = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(signerKp);
  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync(resolve(__dirname, '../target/idl/payment.json'), 'utf-8'));
  const program = new anchor.Program(idl, provider);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);

  // Read current state.
  const cfg = (await program.account.config.fetch(configPda)) as {
    owner: PublicKey;
    pendingOwner: PublicKey;
  };
  console.log(`Payment program: ${program.programId.toBase58()}`);
  console.log(`Config PDA:      ${configPda.toBase58()}`);
  console.log(`Current owner:   ${cfg.owner.toBase58()}`);
  console.log(
    `Pending owner:   ${cfg.pendingOwner.equals(PublicKey.default) ? '(none)' : cfg.pendingOwner.toBase58()}`
  );
  console.log(`Signer:          ${signerKp.publicKey.toBase58()}`);
  console.log('');

  if (VERIFY) {
    if (!newOwnerArg) {
      console.error('Usage: --verify <EXPECTED_OWNER>');
      process.exit(1);
    }
    const ok = cfg.owner.toBase58() === newOwnerArg;
    console.log(
      ok
        ? '✓ owner matches expected'
        : `✗ owner is ${cfg.owner.toBase58()}, expected ${newOwnerArg}`
    );
    process.exit(ok ? 0 : 2);
  }

  if (ACCEPT) {
    if (cfg.pendingOwner.equals(PublicKey.default)) {
      console.error('No pending owner to accept');
      process.exit(1);
    }
    if (!cfg.pendingOwner.equals(signerKp.publicKey)) {
      console.error(
        `Signer ${signerKp.publicKey.toBase58()} is not the pending owner ${cfg.pendingOwner.toBase58()}`
      );
      console.error(
        'Re-run from the proposed new owner key, OR — for a Squads multisig destination,'
      );
      console.error('propose this ix through Squads:');
      console.error(`  program: ${program.programId.toBase58()}`);
      console.error(`  ix:      acceptOwnership`);
      console.error(`  accounts: { newOwner: <squads vault>, config: ${configPda.toBase58()} }`);
      process.exit(1);
    }
    const sig = await program.methods
      .acceptOwnership()
      .accounts({ newOwner: signerKp.publicKey, config: configPda })
      .rpc();
    console.log(`✓ ownership accepted (tx ${sig})`);
    return;
  }

  // Propose
  if (!newOwnerArg) {
    console.error('Usage: transfer-payment-ownership.ts <NEW_OWNER>');
    process.exit(1);
  }
  if (!cfg.owner.equals(signerKp.publicKey)) {
    console.error(
      `Signer ${signerKp.publicKey.toBase58()} is not the current owner ${cfg.owner.toBase58()}`
    );
    process.exit(1);
  }
  let newOwnerPk: PublicKey;
  try {
    newOwnerPk = new PublicKey(newOwnerArg);
  } catch {
    console.error(`Invalid pubkey: ${newOwnerArg}`);
    process.exit(1);
  }

  const sig = await program.methods
    .transferOwnership(newOwnerPk)
    .accounts({ owner: signerKp.publicKey, config: configPda })
    .rpc();
  console.log(`✓ proposed ${newOwnerPk.toBase58()} as new owner (tx ${sig})`);
  console.log('');
  console.log('Next step: have the new owner run');
  console.log(`  pnpm tsx apps/programs/scripts/transfer-payment-ownership.ts --accept`);
  console.log('OR for a Squads vault destination, propose acceptOwnership through Squads.');
}

main().catch((err) => {
  console.error('transfer failed:', err);
  process.exit(1);
});
