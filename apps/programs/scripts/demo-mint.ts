/**
 * Demo end-to-end: create a Universe + mint an Episode cNFT.
 *
 * Idempotent: skips creation if the Universe PDA already exists for the
 * (creator, content_hash) pair. Episode mints with a fresh hash each run.
 *
 * Outputs the Solana Explorer URLs for the universe PDA, episode record,
 * and the Bubblegum cNFT assetId — copy these for the Frontier demo deck.
 *
 * Usage:
 *   pnpm tsx apps/programs/scripts/demo-mint.ts
 *
 * Env:
 *   SOLANA_RPC_URL_DEVNET   websocket-capable RPC (api.devnet.solana.com works)
 *   ANCHOR_WALLET           deployer keypair (also tree delegate + universe creator for demo)
 *   BUBBLEGUM_TREE_DEVNET   merkle tree address
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, Connection, SystemProgram } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mintV1, TokenProgramVersion, TokenStandard } from '@metaplex-foundation/mpl-bubblegum';
import { keypairIdentity, none, publicKey as toUmiPublicKey, some } from '@metaplex-foundation/umi';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

function loadKeypair(path: string): Keypair {
  const expanded = path.startsWith('~') ? path.replace('~', homedir()) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expanded, 'utf-8'))));
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

const EXPLORER = 'https://explorer.solana.com';
function explorerAddr(a: string): string {
  return `${EXPLORER}/address/${a}?cluster=devnet`;
}
function explorerTx(s: string): string {
  return `${EXPLORER}/tx/${s}?cluster=devnet`;
}

async function main() {
  const rpcUrl =
    process.env.SOLANA_RPC_URL_DEVNET ||
    process.env.SOLANA_RPC_URL ||
    'https://api.devnet.solana.com';
  const treeAddr = process.env.BUBBLEGUM_TREE_DEVNET;
  if (!treeAddr) throw new Error('BUBBLEGUM_TREE_DEVNET is required');

  const deployerKp = loadKeypair(process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json');
  const wallet = new anchor.Wallet(deployerKp);
  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  // Anchor programs.
  const universeIdl = JSON.parse(
    readFileSync(resolve(__dirname, '../target/idl/universe.json'), 'utf-8')
  );
  const episodeIdl = JSON.parse(
    readFileSync(resolve(__dirname, '../target/idl/episode.json'), 'utf-8')
  );
  const universeProgram = new anchor.Program(universeIdl, provider);
  const episodeProgram = new anchor.Program(episodeIdl, provider);

  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Creator:           ${deployerKp.publicKey.toBase58()}`);
  console.log(`Universe program: ${universeProgram.programId.toBase58()}`);
  console.log(`Episode program:  ${episodeProgram.programId.toBase58()}`);
  console.log(`Merkle tree:      ${treeAddr}`);
  console.log('');

  // ── Phase B: Universe ─────────────────────────────────────────────────────

  // Deterministic per-deployer-per-name so re-runs of the script land on the
  // same PDA (script is then idempotent on the universe side).
  const universeName = 'LOAR Frontier Demo Universe';
  const universeContentHash = sha256(universeName);
  const universePlotHash = sha256(`${universeName}::plot`);

  const [universePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('universe'), deployerKp.publicKey.toBuffer(), universeContentHash],
    universeProgram.programId
  );
  console.log(`Universe PDA: ${universePda.toBase58()}`);

  const universeAcct = await connection.getAccountInfo(universePda, 'confirmed');
  if (!universeAcct) {
    console.log('• initialize_universe() — creating Universe PDA…');
    const sig = await universeProgram.methods
      .initializeUniverse(
        [...universeContentHash],
        [...universePlotHash],
        { public: {} } // Visibility::Public — public from day one for the demo
      )
      .accounts({
        creator: deployerKp.publicKey,
        universe: universePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ ${explorerTx(sig)}`);
  } else {
    console.log('• initialize_universe() — Universe PDA already exists, skipping');
  }

  // ── Phase C: Episode cNFT ─────────────────────────────────────────────────

  // Fresh content hash each run so we always mint a new episode.
  // Bubblegum's metadata name max is 32 BYTES (not chars) so we use ASCII
  // and a short timestamp suffix. Anchor side allows up to 64 chars; we
  // pass the same trimmed name to both for simplicity.
  const stamp = new Date().toISOString().slice(5, 19).replace('T', ' '); // "05-12 03:50:00"
  const episodeTitle = `Pilot ${stamp}`; // ~21 bytes
  const episodeContentHash = sha256(episodeTitle);
  const metadataUri = 'https://arweave.net/loar-frontier-demo-metadata.json'; // placeholder

  const [episodePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('episode'), universePda.toBuffer(), episodeContentHash],
    episodeProgram.programId
  );
  console.log(`Episode PDA: ${episodePda.toBase58()}`);

  console.log('• mint_episode() — recording episode under universe…');
  const mintEpisodeSig = await episodeProgram.methods
    .mintEpisode([...episodeContentHash], metadataUri, episodeTitle)
    .accounts({
      creator: deployerKp.publicKey,
      universe: universePda,
      episodeRecord: episodePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ✓ ${explorerTx(mintEpisodeSig)}`);

  // Bubblegum cNFT mint — Umi-based, signed with the deployer keypair which
  // is the tree delegate (we created the tree).
  console.log('• bubblegum::mint_v1 — minting compressed NFT into tree…');
  const umi = createUmi(rpcUrl).use(
    keypairIdentity({
      publicKey: toUmiPublicKey(deployerKp.publicKey.toBase58()),
      secretKey: deployerKp.secretKey,
    })
  );

  const result = await mintV1(umi, {
    leafOwner: toUmiPublicKey(deployerKp.publicKey.toBase58()),
    merkleTree: toUmiPublicKey(treeAddr),
    metadata: {
      name: episodeTitle.slice(0, 32),
      symbol: 'LOAR',
      uri: metadataUri,
      sellerFeeBasisPoints: 500,
      collection: none(),
      primarySaleHappened: false,
      isMutable: false,
      editionNonce: none(),
      tokenStandard: some(TokenStandard.NonFungible),
      uses: none(),
      tokenProgramVersion: TokenProgramVersion.Original,
      creators: [
        {
          address: toUmiPublicKey(deployerKp.publicKey.toBase58()),
          share: 100,
          verified: true,
        },
      ],
    },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

  const cnftSig = Buffer.from(result.signature).toString('base64');
  console.log(`  ✓ Bubblegum tx submitted (sig base64): ${cnftSig.slice(0, 24)}…`);

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Frontier demo artifacts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Universe:       ${explorerAddr(universePda.toBase58())}`);
  console.log(`  Episode record: ${explorerAddr(episodePda.toBase58())}`);
  console.log(`  Bubblegum tree: ${explorerAddr(treeAddr)}`);
  console.log(`  Mint tx:        ${explorerTx(mintEpisodeSig)}`);
  console.log(`  Owner wallet:   ${explorerAddr(deployerKp.publicKey.toBase58())}`);
  console.log('');
  console.log('  Look up the cNFT in Phantom with this owner address, or via');
  console.log(
    '  https://www.solana.fm/address/' +
      deployerKp.publicKey.toBase58() +
      '/tokens?cluster=devnet-solana'
  );
}

main().catch((err) => {
  console.error('demo-mint failed:', err);
  process.exit(1);
});
