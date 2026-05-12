/**
 * Create the Bubblegum cNFT merkle tree for Episode mints.
 *
 * Tree shape:
 *   depth=20    → 2^20 = 1,048,576 cNFTs in one tree
 *   buffer=64   → 64 concurrent writes (parallelism for episode mints)
 *   canopy=14   → keeps ~16k inner nodes on-chain → proof size <= 6 nodes,
 *                 cheap to mint/transfer
 *
 * Rent: depth=20/buffer=64/canopy=14 → ~10–15 SOL. Reclaimable on close.
 *
 * Authority model:
 *   - `treeCreator` = deployer wallet (controls who can mint into the tree).
 *   - `public = false` → only the tree-delegate or treeCreator may mint.
 *   - The Episode program PDA will be authorized later as a delegate via a
 *     follow-up `setTreeDelegate` ix once the program-side wiring lands.
 *
 * Idempotent: persists the tree keypair under
 * `.gitnexus/solana/bubblegum-tree-<cluster>.json` and skips if the tree
 * account already exists.
 *
 * Usage:
 *   pnpm tsx scripts/solana/create-merkle-tree.ts
 *   pnpm tsx scripts/solana/create-merkle-tree.ts --cluster devnet --depth 20 --buffer 64 --canopy 14
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createTree, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { createSignerFromKeypair, keypairIdentity } from '@metaplex-foundation/umi';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';

type Cluster = 'devnet' | 'mainnet-beta' | 'testnet';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intArg(name: string, fallback: number): number {
  const v = arg(name);
  return v === undefined ? fallback : Number.parseInt(v, 10);
}

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadOrCreateTreeKeypair(cluster: Cluster): { kp: Keypair; created: boolean } {
  const dir = path.join(process.cwd(), '.gitnexus/solana');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bubblegum-tree-${cluster}.json`);
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
  const depth = intArg('depth', 20);
  const buffer = intArg('buffer', 64);
  const canopy = intArg('canopy', 14);
  const rpcUrl = rpcForCluster(cluster);
  const walletPath = arg('wallet') ?? path.join(os.homedir(), '.config/solana/id.json');

  const payerKp = loadKeypair(walletPath);
  const { kp: treeKp, created } = loadOrCreateTreeKeypair(cluster);

  console.log(
    `[create-merkle-tree] cluster=${cluster} rpc=${rpcUrl.replace(/api-key=[^&]+/, 'api-key=***')}`
  );
  console.log(`[create-merkle-tree] payer=${payerKp.publicKey.toBase58()}`);
  console.log(
    `[create-merkle-tree] tree=${treeKp.publicKey.toBase58()} (${created ? 'new' : 'existing keypair'})`
  );
  console.log(
    `[create-merkle-tree] shape: depth=${depth} buffer=${buffer} canopy=${canopy} (capacity=${2 ** depth} cNFTs)`
  );

  // Skip if already on-chain.
  const conn = new Connection(rpcUrl, 'confirmed');
  const existing = await conn.getAccountInfo(treeKp.publicKey);
  if (existing !== null) {
    console.log(
      `[create-merkle-tree] already deployed at ${treeKp.publicKey.toBase58()}, skipping`
    );
    return;
  }

  const umi = createUmi(rpcUrl)
    .use(keypairIdentity(fromWeb3JsKeypair(payerKp)))
    .use(mplBubblegum());

  // Materialize our persisted keypair as a Umi signer so re-runs land on the
  // same merkle tree address.
  const treeUmiKeypair = fromWeb3JsKeypair(treeKp);
  const treeSigner = createSignerFromKeypair(umi, treeUmiKeypair);

  const builder = await createTree(umi, {
    merkleTree: treeSigner,
    maxDepth: depth,
    maxBufferSize: buffer,
    canopyDepth: canopy,
    public: false,
    treeCreator: umi.identity,
  });

  // Send via umi, then verify via web3.js polling — umi's `sendAndConfirm`
  // routes through `signatureSubscribe` which paid RPCs don't expose. We
  // wait for the merkle-tree account to materialize instead.
  let sigBytes: Uint8Array;
  try {
    sigBytes = (await builder.send(umi)).signature;
  } catch (e) {
    console.error('[create-merkle-tree] send failed:', e);
    throw e;
  }
  const sig = Buffer.from(sigBytes).toString('hex');
  console.log(`[create-merkle-tree] tree create tx submitted: ${sig}`);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const acc = await conn.getAccountInfo(treeKp.publicKey, 'confirmed');
    if (acc !== null) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  const final = await conn.getAccountInfo(treeKp.publicKey, 'confirmed');
  if (final === null) {
    throw new Error(
      `Tree account ${treeKp.publicKey.toBase58()} did not materialize within 120s. ` +
        `Check signature ${sig} on the explorer.`
    );
  }
  console.log(`[create-merkle-tree] tree address: ${treeKp.publicKey.toBase58()}`);

  console.log('');
  console.log('───────────────────────────────────────────────');
  console.log(' Update packages/abis/src/solana-addresses.ts:');
  console.log(
    `   BubblegumTree.${cluster === 'mainnet-beta' ? "'mainnet-beta'" : cluster}: '${treeKp.publicKey.toBase58()}',`
  );
  console.log('');
  console.log(' And .env:');
  console.log(
    `   BUBBLEGUM_TREE_${cluster === 'mainnet-beta' ? 'MAINNET' : 'DEVNET'}=${treeKp.publicKey.toBase58()}`
  );
  console.log('───────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('[create-merkle-tree] FAILED');
  console.error(err);
  process.exit(1);
});
