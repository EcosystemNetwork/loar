/**
 * Create the $LOAR SPL mint on Solana devnet (or mainnet-beta).
 *
 * Uses Token-2022 with three extensions:
 *   - MetadataPointer → points back at the mint itself (self-hosted metadata).
 *   - TokenMetadata    → name / symbol / URI baked into the mint account.
 *   - Pausable         → pause-authority can freeze all transfers globally,
 *                        matching `LoarToken.sol`'s Pausable behavior.
 *
 * Decimals are 9 (Solana standard). The EVM $LOAR is 18 decimals; Wormhole
 * NTT v2 handles the 18↔9 scaling at bridge time, so on-chain Solana balances
 * are denominated in 9-decimal units.
 *
 * Initial supply: 1,000,000,000 $LOAR (1B), matching the EVM `MAX_SUPPLY`.
 * The entire supply is minted to the deployer's ATA. Distribution (treasury,
 * staking, etc.) happens via subsequent transfers / programs.
 *
 * All authorities (mint, freeze, pause, metadata-update) are initially the
 * deployer. Production handoff moves them to an SPL multisig before mainnet.
 *
 * Idempotent: if a mint keypair already exists at
 * `.gitnexus/solana/loar-mint-<cluster>.json` it will be reused, and if the
 * mint account already exists on-chain the script logs and exits.
 *
 * Usage:
 *   pnpm tsx scripts/solana/create-mint.ts                  # uses SOLANA_RPC_URL + SOLANA_CLUSTER from .env
 *   pnpm tsx scripts/solana/create-mint.ts --cluster devnet
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import 'dotenv/config';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { sendAndConfirmPolling } from './lib/confirm';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializePausableConfigInstruction,
  createMintToInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  getMint,
} from '@solana/spl-token';
import {
  createInitializeInstruction as createInitializeMetadataInstruction,
  pack as packTokenMetadata,
  type TokenMetadata,
} from '@solana/spl-token-metadata';

const NAME = 'LOAR';
const SYMBOL = 'LOAR';
const URI = 'https://loar.fun/token/loar.json';
const DECIMALS = 9;
const INITIAL_SUPPLY_WHOLE = 1_000_000_000n; // 1 billion

type Cluster = 'devnet' | 'mainnet-beta' | 'testnet';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadOrCreateMintKeypair(cluster: Cluster): { kp: Keypair; created: boolean } {
  const dir = path.join(process.cwd(), '.gitnexus/solana');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `loar-mint-${cluster}.json`);
  if (fs.existsSync(file)) {
    return { kp: loadKeypair(file), created: false };
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return { kp, created: true };
}

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
  if (!['devnet', 'mainnet-beta', 'testnet'].includes(cluster)) {
    throw new Error(`Unsupported cluster: ${cluster}`);
  }
  const rpcUrl = rpcForCluster(cluster);
  const walletPath = arg('wallet') ?? path.join(os.homedir(), '.config/solana/id.json');

  // Many paid RPCs (Alchemy) don't expose `signatureSubscribe` for Solana.
  // Pass an empty wsEndpoint to force polling-based confirmation, which
  // uses `getSignatureStatuses` and works against any HTTP-only RPC.
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: '',
    confirmTransactionInitialTimeout: 90_000,
  });
  const payer = loadKeypair(walletPath);
  const { kp: mintKp, created } = loadOrCreateMintKeypair(cluster);

  console.log(
    `[create-mint] cluster=${cluster} rpc=${rpcUrl.replace(/api-key=[^&]+/, 'api-key=***')}`
  );
  console.log(`[create-mint] payer=${payer.publicKey.toBase58()}`);
  console.log(
    `[create-mint] mint=${mintKp.publicKey.toBase58()} (${created ? 'new' : 'existing keypair'})`
  );

  // Skip the create step if the mint is already on-chain, but fall through
  // to the supply-mint step when supply is still zero (resumes a partial run).
  const existing = await connection.getAccountInfo(mintKp.publicKey);
  let mintAlreadyInitialized = false;
  if (existing !== null) {
    const m = await getMint(connection, mintKp.publicKey, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log(
      `[create-mint] mint already exists: supply=${m.supply.toString()} decimals=${m.decimals} authority=${m.mintAuthority?.toBase58() ?? 'null'}`
    );
    if (m.supply > 0n) {
      console.log('[create-mint] supply already minted, nothing to do.');
      return;
    }
    mintAlreadyInitialized = true;
    console.log('[create-mint] supply is 0 — resuming with mint-to step.');
  }

  // Compute size: base mint + MetadataPointer + Pausable + TokenMetadata variable.
  const extensions: ExtensionType[] = [ExtensionType.MetadataPointer, ExtensionType.PausableConfig];
  const mintLenFixed = getMintLen(extensions);

  const metadata: TokenMetadata = {
    mint: mintKp.publicKey,
    name: NAME,
    symbol: SYMBOL,
    uri: URI,
    additionalMetadata: [],
  };
  // pack returns the serialized metadata; add 4-byte discriminator + 4-byte length prefix
  // (the on-chain TLV record). Reference: spl-token-metadata::Encoded layout.
  const metadataLen = 4 + 4 + packTokenMetadata(metadata).length;

  const totalLen = mintLenFixed + metadataLen;
  const rentLamports = await connection.getMinimumBalanceForRentExemption(totalLen);
  console.log(`[create-mint] account-size=${totalLen} rent=${rentLamports / 1e9} SOL`);

  if (!mintAlreadyInitialized) {
    const tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: mintLenFixed, // metadata is appended in-place; mint-len excludes it
        lamports: rentLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(
        mintKp.publicKey,
        payer.publicKey, // update authority (can be moved to multisig)
        mintKp.publicKey, // metadata stored on the mint itself
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializePausableConfigInstruction(
        mintKp.publicKey,
        payer.publicKey, // pause authority
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mintKp.publicKey,
        DECIMALS,
        payer.publicKey, // mint authority
        payer.publicKey, // freeze authority
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMetadataInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mintKp.publicKey,
        updateAuthority: payer.publicKey,
        mint: mintKp.publicKey,
        mintAuthority: payer.publicKey,
        name: NAME,
        symbol: SYMBOL,
        uri: URI,
      })
    );

    const sig = await sendAndConfirmPolling(connection, tx, [payer, mintKp], {
      commitment: 'confirmed',
    });
    console.log(`[create-mint] mint created: ${sig}`);
  }

  // Mint initial supply to deployer's ATA.
  const payerAta = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const mintAmount = INITIAL_SUPPLY_WHOLE * 10n ** BigInt(DECIMALS);
  const mintTx = new Transaction();
  mintTx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      payerAta,
      payer.publicKey,
      mintKp.publicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    createMintToInstruction(
      mintKp.publicKey,
      payerAta,
      payer.publicKey,
      mintAmount,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  const mintSig = await sendAndConfirmPolling(connection, mintTx, [payer], {
    commitment: 'confirmed',
  });
  console.log(
    `[create-mint] minted ${INITIAL_SUPPLY_WHOLE.toString()} ${SYMBOL} (${mintAmount.toString()} base units) to ${payerAta.toBase58()}: ${mintSig}`
  );

  console.log('');
  console.log('───────────────────────────────────────────────');
  console.log(' Update packages/abis/src/solana-addresses.ts:');
  console.log(
    `   LoarMint.${cluster === 'mainnet-beta' ? "'mainnet-beta'" : cluster}: '${mintKp.publicKey.toBase58()}',`
  );
  console.log('');
  console.log(' And .env:');
  console.log(
    `   LOAR_MINT_${cluster === 'mainnet-beta' ? 'MAINNET' : 'DEVNET'}=${mintKp.publicKey.toBase58()}`
  );
  console.log('───────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('[create-mint] FAILED');
  console.error(err);
  process.exit(1);
});
