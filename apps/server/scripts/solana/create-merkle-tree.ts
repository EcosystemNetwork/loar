/**
 * One-time setup: create a Bubblegum merkle tree on the active cluster.
 *
 * Defaults differ by cluster:
 *   devnet       depth=14, buffer=64, canopy=0   (16K slots, ~0.2 SOL)
 *   mainnet-beta depth=17, buffer=64, canopy=8   (131K slots, ~5 SOL)
 *
 * Override with BUBBLEGUM_MAX_DEPTH / BUBBLEGUM_MAX_BUFFER / BUBBLEGUM_CANOPY_DEPTH.
 *
 * Usage:
 *   pnpm tsx apps/server/scripts/solana/create-merkle-tree.ts
 *
 * Reads:
 *   SOLANA_RPC_URL, SOLANA_CLUSTER
 *   TREE_CREATOR_KEYPAIR     — local path to a JSON keypair file (NOT Circle DCW)
 *                              The creator keypair pays for tree creation and
 *                              becomes the tree's delegate. After creation, copy
 *                              the printed tree address into:
 *                                  BUBBLEGUM_TREE_DEVNET / BUBBLEGUM_TREE_MAINNET
 *                                  packages/abis/src/solana-addresses.ts
 *                              AND hand off tree delegate authority to the Circle
 *                              DCW wallet that will be the runtime fee payer:
 *                                  `node scripts/solana/set-tree-delegate.ts <tree> <circle-pubkey>`
 *   BUBBLEGUM_MAX_DEPTH      — optional override (must be supported by SPL account compression)
 *   BUBBLEGUM_MAX_BUFFER     — optional override
 *   BUBBLEGUM_CANOPY_DEPTH   — optional override
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

  const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
  const isMainnet = cluster === 'mainnet-beta';

  // Cluster-aware defaults. Mainnet starts at depth=17 (~5 SOL, 131K slots);
  // depth=20 (~240 SOL, 1M slots) requires explicit BUBBLEGUM_MAX_DEPTH=20.
  const defaults = isMainnet
    ? { maxDepth: 17, maxBufferSize: 64, canopyDepth: 8 }
    : { maxDepth: 14, maxBufferSize: 64, canopyDepth: 0 };

  const maxDepth = process.env.BUBBLEGUM_MAX_DEPTH
    ? Number(process.env.BUBBLEGUM_MAX_DEPTH)
    : defaults.maxDepth;
  const maxBufferSize = process.env.BUBBLEGUM_MAX_BUFFER
    ? Number(process.env.BUBBLEGUM_MAX_BUFFER)
    : defaults.maxBufferSize;
  const canopyDepth = process.env.BUBBLEGUM_CANOPY_DEPTH
    ? Number(process.env.BUBBLEGUM_CANOPY_DEPTH)
    : defaults.canopyDepth;

  if (isMainnet && maxDepth >= 20 && canopyDepth < 12) {
    throw new Error(
      `depth=${maxDepth} requires canopyDepth>=12 to fit mint tx under 1232 bytes (got ${canopyDepth})`
    );
  }

  const umi: Umi = createUmi(rpcUrl);
  const secret = Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf-8')));
  const creator = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(creator));

  console.log(`Cluster:   ${cluster}`);
  console.log(`Creator:   ${creator.publicKey}`);

  const merkleTree = generateSigner(umi);
  console.log(`New tree:  ${merkleTree.publicKey}`);
  console.log(
    `Creating tree (depth=${maxDepth}, buffer=${maxBufferSize}, canopy=${canopyDepth}) …`
  );

  const builder = await createTree(umi, {
    merkleTree,
    maxDepth,
    maxBufferSize,
    canopyDepth,
    public: false, // only the tree delegate can mint
  });

  const result = await builder.sendAndConfirm(umi, {
    confirm: { commitment: 'confirmed' },
  });

  const txSig = Buffer.from(result.signature).toString('base64');
  const envVar = isMainnet ? 'BUBBLEGUM_TREE_MAINNET' : 'BUBBLEGUM_TREE_DEVNET';
  const addressKey = isMainnet ? "BubblegumTree['mainnet-beta']" : 'BubblegumTree.devnet';
  console.log(`✓ Tree created.`);
  console.log(`  signature: ${txSig}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Add to .env:`);
  console.log(`       ${envVar}=${merkleTree.publicKey}`);
  console.log(`  2. Update packages/abis/src/solana-addresses.ts ${addressKey}`);
  console.log(`  3. Hand off delegate to the Circle DCW wallet that will sign mints.`);
}

main().catch((err) => {
  console.error('Tree creation failed:', err);
  process.exit(1);
});
