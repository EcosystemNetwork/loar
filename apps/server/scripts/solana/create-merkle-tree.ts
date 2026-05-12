/**
 * One-time setup: create a Bubblegum merkle tree on the active cluster.
 *
 * A merkle tree with (depth=14, buffer=64) holds up to 16,384 cNFTs in a
 * single tree at ~$0.2 in rent + creation cost. For mainnet scale we'd use
 * depth=20 (1M slots, ~$240 rent) — devnet stays small to save SOL.
 *
 * Usage:
 *   pnpm tsx apps/server/scripts/solana/create-merkle-tree.ts
 *
 * Reads:
 *   SOLANA_RPC_URL, SOLANA_CLUSTER
 *   TREE_CREATOR_KEYPAIR  — local path to a JSON keypair file (NOT Circle DCW)
 *                          The creator keypair pays for tree creation and
 *                          becomes the tree's delegate. After creation, copy
 *                          the printed tree address into:
 *                              BUBBLEGUM_TREE_DEVNET / BUBBLEGUM_TREE_MAINNET
 *                              packages/abis/src/solana-addresses.ts
 *                          AND hand off tree delegate authority to the Circle
 *                          DCW wallet that will be the runtime fee payer:
 *                              `node scripts/solana/set-tree-delegate.ts <tree> <circle-pubkey>`
 *
 * Tree size sizing (depth, buffer, canopy):
 *   depth   slots         canopy  rent (SOL est)
 *   14      16,384        0       ~0.2
 *   17      131,072       8       ~5
 *   20      1,048,576     12      ~240
 *
 * Canopy reduces proof-path size in mint txs — at depth 20 a deeper canopy
 * is required for the mint tx to fit under the size limit. depth=14 needs no
 * canopy and is plenty for hackathon demos.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createTree } from '@metaplex-foundation/mpl-bubblegum';
import { generateSigner, keypairIdentity, type Umi } from '@metaplex-foundation/umi';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error('SOLANA_RPC_URL is required (Helius/Triton RPC for the active cluster)');
  }

  const keypairPath = process.env.TREE_CREATOR_KEYPAIR;
  if (!keypairPath) {
    throw new Error(
      'TREE_CREATOR_KEYPAIR is required — path to a JSON keypair file with SOL for fees'
    );
  }

  const umi: Umi = createUmi(rpcUrl);
  const secret = Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf-8')));
  const creator = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(creator));

  console.log(`Cluster:   ${process.env.SOLANA_CLUSTER ?? 'devnet'}`);
  console.log(`Creator:   ${creator.publicKey}`);

  const merkleTree = generateSigner(umi);
  console.log(`New tree:  ${merkleTree.publicKey}`);
  console.log('Creating tree (depth=14, buffer=64, canopy=0) …');

  const builder = await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
    // canopyDepth: 0   // default
    public: false, // only the tree delegate can mint
  });

  const result = await builder.sendAndConfirm(umi, {
    confirm: { commitment: 'confirmed' },
  });

  const txSig = Buffer.from(result.signature).toString('base64');
  console.log(`✓ Tree created.`);
  console.log(`  signature: ${txSig}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Add to .env:`);
  console.log(`       BUBBLEGUM_TREE_DEVNET=${merkleTree.publicKey}`);
  console.log(`  2. Update packages/abis/src/solana-addresses.ts BubblegumTree.devnet`);
  console.log(`  3. Hand off delegate to the Circle DCW wallet that will sign mints.`);
}

main().catch((err) => {
  console.error('Tree creation failed:', err);
  process.exit(1);
});
