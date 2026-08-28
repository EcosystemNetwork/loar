/**
 * Create the $LOAR Token-2022 mint on the active cluster.
 *
 * Reproducible mint creation for mainnet (and re-creation on devnet if needed).
 * Mints initial supply to the deployer, sets metadata via the Token-2022
 * MetadataPointer + TokenMetadata extensions, and emits a SPL metadata URL
 * for downstream wallets to render the token nicely.
 *
 * After creation, finish the setup with:
 *   1. spl-token authorize <MINT> freeze --disable           # null the freeze authority
 *   2. apps/server/scripts/solana/check-loar-mint.ts <MINT>  # verify
 *   3. spl-token authorize <MINT> mint <squads-vault>        # hand mint authority to Squads (mainnet)
 *   4. Update LOAR_MINT_MAINNET / LOAR_MINT_DEVNET env + packages/abis/src/solana-addresses.ts
 *
 * Usage:
 *   pnpm tsx apps/server/scripts/solana/create-loar-mint.ts
 *
 * Env:
 *   SOLANA_RPC_URL           Helius/Alchemy/etc cluster RPC
 *   TOKEN_AUTHORITY_KEYPAIR  local JSON keypair — becomes mint + freeze authority
 *                             AND receives the initial supply
 *   LOAR_INITIAL_SUPPLY      decimal whole-LOAR (default: 1_000_000_000)
 *   LOAR_DECIMALS            (default: 9) — keep at 9 for parity with SPL convention
 *   LOAR_METADATA_URI        (optional) JSON metadata at https://loar.fun/token/loar.json
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import { createInitializeInstruction, pack, type TokenMetadata } from '@solana/spl-token-metadata';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

function loadKeypair(path: string): Keypair {
  const expanded = path.startsWith('~') ? path.replace('~', homedir()) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expanded, 'utf-8'))));
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC_URL_DEVNET;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required');

  const authKpPath = process.env.TOKEN_AUTHORITY_KEYPAIR ?? '~/.config/solana/id.json';
  const authority = loadKeypair(authKpPath);

  const decimals = Number(process.env.LOAR_DECIMALS ?? '9');
  const supplyWhole = BigInt(process.env.LOAR_INITIAL_SUPPLY ?? '1000000000');
  const supplyBase = supplyWhole * BigInt(10) ** BigInt(decimals);
  const metadataUri = process.env.LOAR_METADATA_URI ?? 'https://loar.fun/token/loar.json';

  const connection = new Connection(rpcUrl, 'confirmed');

  // Mint is a fresh keypair — its pubkey IS the mint address.
  const mintKp = Keypair.generate();
  const metadata: TokenMetadata = {
    mint: mintKp.publicKey,
    name: 'LOAR',
    symbol: 'LOAR',
    uri: metadataUri,
    additionalMetadata: [],
  };

  // Token-2022 with MetadataPointer extension pointing back to the mint itself
  // (self-referential — the metadata lives inside the mint account).
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = pack(metadata).length + 4; // 4-byte length prefix
  const rent = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  console.log(`RPC:                ${rpcUrl}`);
  console.log(`Authority:          ${authority.publicKey.toBase58()}`);
  console.log(`Mint (will create): ${mintKp.publicKey.toBase58()}`);
  console.log(`Decimals:           ${decimals}`);
  console.log(`Initial supply:     ${supplyWhole} ($LOAR)`);
  console.log(`Metadata URI:       ${metadataUri}`);
  console.log(`Rent reservation:   ${rent / 1e9} SOL`);
  console.log('');

  const tx = new Transaction().add(
    // Allocate the mint account
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mintKp.publicKey,
      lamports: rent,
      space: mintLen,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // MetadataPointer extension → self
    createInitializeMetadataPointerInstruction(
      mintKp.publicKey,
      authority.publicKey,
      mintKp.publicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    // Mint init (authority + decimals)
    createInitializeMintInstruction(
      mintKp.publicKey,
      decimals,
      authority.publicKey,
      authority.publicKey, // freeze authority — null this AFTER bootstrap
      TOKEN_2022_PROGRAM_ID
    ),
    // Embed TokenMetadata inside the mint
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mintKp.publicKey,
      metadata: mintKp.publicKey,
      mintAuthority: authority.publicKey,
      updateAuthority: authority.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    })
  );

  // Authority's ATA for initial supply.
  const ata = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    authority.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      authority.publicKey,
      ata,
      authority.publicKey,
      mintKp.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ),
    createMintToCheckedInstruction(
      mintKp.publicKey,
      ata,
      authority.publicKey,
      supplyBase,
      decimals,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [authority, mintKp], {
    commitment: 'confirmed',
  });

  console.log(`✓ Mint created`);
  console.log(`  Address:       ${mintKp.publicKey.toBase58()}`);
  console.log(`  Authority ATA: ${ata.toBase58()}`);
  console.log(`  Signature:     ${sig}`);
  console.log('');
  console.log('Next steps:');
  console.log(
    `  spl-token --program-id ${TOKEN_2022_PROGRAM_ID.toBase58()} authorize ${mintKp.publicKey.toBase58()} freeze --disable`
  );
  console.log(
    `  pnpm tsx apps/server/scripts/solana/check-loar-mint.ts ${mintKp.publicKey.toBase58()}`
  );
  console.log('  # On mainnet, transfer mint authority to a Squads vault:');
  console.log(
    `  spl-token --program-id ${TOKEN_2022_PROGRAM_ID.toBase58()} authorize ${mintKp.publicKey.toBase58()} mint <SQUADS_VAULT_PDA>`
  );
}

main().catch((err) => {
  console.error('create-loar-mint failed:', err);
  process.exit(1);
});
