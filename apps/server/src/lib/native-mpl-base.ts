/**
 * Shared helpers for the 4 Metaplex Core NFT adapters
 * (character / entity / identity / structural).
 *
 * All 4 mint Metaplex Core Assets under a per-universe Collection with
 * Royalty + Attributes plugins.
 *
 * Bridging Umi (Metaplex's tx-builder framework) to Circle DCW:
 *   1. Build a TransactionBuilder via `mpl-core`'s `create()` / `transfer()`.
 *   2. Use `noopSigner` for the Umi identity so the builder doesn't try
 *      to sign — Circle DCW does that downstream.
 *   3. `.getInstructions()` → convert each Umi `Instruction` to web3.js via
 *      `toWeb3JsInstruction`.
 *   4. Forward to `executeSolanaTransaction` for KMS signing + broadcast.
 *
 * Required env: METAPLEX_CORE_PROGRAM_ID — optional override.
 */
import { Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { resolveUserSolanaWallet, sendNativeTx } from './native-base';
import { activeCluster, getSolanaConnection, isCircleSolanaConfigured } from './circle-solana';

export function isMplCoreConfigured(): boolean {
  return isCircleSolanaConfigured();
}

// ── Attribute helpers ──────────────────────────────────────────────────────

export type Attribute = { key: string; value: string };

export function makeAttributes(rec: Record<string, string | number | boolean>): Attribute[] {
  return Object.entries(rec).map(([key, v]) => ({
    key,
    value: typeof v === 'string' ? v : String(v),
  }));
}

// ── Royalty config ─────────────────────────────────────────────────────────

export interface RoyaltyConfig {
  /** Basis points to the creator on every secondary sale. Default 500 = 5%. */
  basisPoints?: number;
  /** Beneficiary of the royalty. Default = mint creator. */
  recipient?: PublicKey;
}

// ── SDK loaders ─────────────────────────────────────────────────────────────

interface UmiSdk {
  createNoopSigner(pk: unknown): unknown;
  publicKey(s: string): unknown;
  generateSigner(umi: unknown): { publicKey: unknown; secretKey: Uint8Array };
}

interface UmiBundleSdk {
  createUmi(rpcUrl: string): UmiContext;
}

interface UmiContext {
  identity: { publicKey: unknown };
  use(plugin: unknown): UmiContext;
  rpc: { getEndpoint(): string };
}

interface MplCoreSdk {
  create(context: UmiContext, args: Record<string, unknown>): TransactionBuilder;
  transfer(context: UmiContext, args: Record<string, unknown>): TransactionBuilder;
  createCollection(context: UmiContext, args: Record<string, unknown>): TransactionBuilder;
  fetchAssetV1(context: UmiContext, asset: unknown): Promise<RawAsset | null>;
}

interface TransactionBuilder {
  getInstructions(): Array<{ instruction: unknown; signers: unknown[] }>;
}

interface RawAsset {
  publicKey: unknown;
  owner: unknown;
  name: string;
  uri: string;
  updateAuthority: { type: string; address?: unknown };
  plugins?: {
    attributes?: { attributeList: Attribute[] };
    royalties?: { basisPoints: number; creators: Array<{ address: unknown }> };
  };
  freezeDelegate?: { frozen: boolean };
}

interface UmiAdaptersSdk {
  toWeb3JsInstruction(ix: unknown): TransactionInstruction;
  toWeb3JsPublicKey(pk: unknown): PublicKey;
  fromWeb3JsPublicKey(pk: PublicKey): unknown;
}

let _umi: UmiSdk | null = null;
let _umiBundle: UmiBundleSdk | null = null;
let _mpl: MplCoreSdk | null = null;
let _adapters: UmiAdaptersSdk | null = null;

async function loadSdks(): Promise<{
  umi: UmiSdk;
  bundle: UmiBundleSdk;
  mpl: MplCoreSdk;
  adapters: UmiAdaptersSdk;
}> {
  if (_umi && _umiBundle && _mpl && _adapters) {
    return { umi: _umi, bundle: _umiBundle, mpl: _mpl, adapters: _adapters };
  }
  try {
    _umi = (await import('@metaplex-foundation/umi' as never)) as unknown as UmiSdk;
    _umiBundle = (await import(
      '@metaplex-foundation/umi-bundle-defaults' as never
    )) as unknown as UmiBundleSdk;
    _mpl = (await import('@metaplex-foundation/mpl-core' as never)) as unknown as MplCoreSdk;
    _adapters = (await import(
      '@metaplex-foundation/umi-web3js-adapters' as never
    )) as unknown as UmiAdaptersSdk;
    return { umi: _umi, bundle: _umiBundle, mpl: _mpl, adapters: _adapters };
  } catch (e) {
    throw new Error(
      `Metaplex Core / Umi SDKs not available. Ensure @metaplex-foundation/{mpl-core,umi,umi-bundle-defaults,umi-web3js-adapters} are installed in apps/server. (${
        e instanceof Error ? e.message : String(e)
      })`
    );
  }
}

function makeUmiContext(
  creatorPubkey: PublicKey,
  bundle: UmiBundleSdk,
  umi: UmiSdk,
  adapters: UmiAdaptersSdk
): UmiContext {
  const conn = getSolanaConnection();
  const ctx = bundle.createUmi(conn.rpcEndpoint);
  // Set a noop signer as the identity — Umi won't try to actually sign;
  // Circle DCW signs once we extract instructions and forward them.
  const umiPubkey = adapters.fromWeb3JsPublicKey(creatorPubkey);
  const noopSigner = umi.createNoopSigner(umiPubkey);
  // The standard Umi pattern: `.use(signerIdentity(signer))`. Some Umi
  // versions accept the signer directly via `.use(noopSigner)` when wrapped;
  // the adapter shape includes both ergonomics.
  return ctx.use(noopSigner) as UmiContext;
}

function umiInstructionsToWeb3(
  builder: TransactionBuilder,
  adapters: UmiAdaptersSdk
): TransactionInstruction[] {
  return builder
    .getInstructions()
    .map((wrapped) => adapters.toWeb3JsInstruction(wrapped.instruction));
}

// ── Mint Asset ──────────────────────────────────────────────────────────────

export interface MintMplAssetArgs {
  creatorUserId: string;
  universe: PublicKey;
  /** The collection address this universe's NFTs hang off. Caller resolves. */
  collection: PublicKey;
  /** Human-readable name (max 32 chars per Metaplex convention). */
  name: string;
  /** Off-chain metadata URI (JSON pointing at image + traits). */
  uri: string;
  /** Optional traits to set via Attributes plugin. */
  attributes?: Attribute[];
  /** Optional royalty config. Default 5% to creator. */
  royalty?: RoyaltyConfig;
  /** Soulbound flag — sets FreezeDelegate so the asset can't transfer.
   * Used by Identity NFTs. */
  soulbound?: boolean;
}

export interface MintMplAssetResult {
  txId: string;
  signature?: string;
  asset: string;
  state: string;
}

export async function mintMplAsset(args: MintMplAssetArgs): Promise<MintMplAssetResult> {
  if (!isMplCoreConfigured()) throw new Error('mpl-core not configured');
  const wallet = await resolveUserSolanaWallet(args.creatorUserId);
  const { umi, bundle, mpl, adapters } = await loadSdks();
  const ctx = makeUmiContext(wallet.pubkey, bundle, umi, adapters);

  // Generate a fresh asset keypair. Umi expects this as the asset signer;
  // we'll include its secretKey in additionalSigners so Circle DCW co-signs.
  const assetSigner = umi.generateSigner(ctx);
  const assetWeb3Pubkey = adapters.toWeb3JsPublicKey(assetSigner.publicKey);

  const plugins: Array<Record<string, unknown>> = [];
  if (args.attributes && args.attributes.length > 0) {
    plugins.push({ type: 'Attributes', attributeList: args.attributes });
  }
  const royaltyRecipient = args.royalty?.recipient ?? wallet.pubkey;
  const royaltyBps = args.royalty?.basisPoints ?? 500;
  if (royaltyBps > 0) {
    plugins.push({
      type: 'Royalties',
      basisPoints: royaltyBps,
      creators: [{ address: adapters.fromWeb3JsPublicKey(royaltyRecipient), percentage: 100 }],
      ruleSet: { type: 'None' },
    });
  }
  if (args.soulbound) {
    plugins.push({ type: 'FreezeDelegate', frozen: true });
  }

  const builder = mpl.create(ctx, {
    asset: assetSigner,
    collection: adapters.fromWeb3JsPublicKey(args.collection),
    name: args.name.slice(0, 32),
    uri: args.uri,
    plugins,
    owner: adapters.fromWeb3JsPublicKey(wallet.pubkey),
  });

  const instructions = umiInstructionsToWeb3(builder, adapters);

  // The asset keypair must co-sign the create tx. Reconstruct a web3.js
  // Keypair from Umi's secretKey so executeSolanaTransaction can co-sign.
  const assetKeypair = Keypair.fromSecretKey(assetSigner.secretKey);

  const { executeSolanaTransaction } = await import('./circle-solana');
  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions,
    additionalSigners: [assetKeypair],
    computeUnitLimit: 400_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    asset: assetWeb3Pubkey.toBase58(),
    state: result.state,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface DecodedMplAsset {
  address: string;
  collection: string | null;
  owner: string;
  name: string;
  uri: string;
  attributes: Attribute[];
  royaltyBasisPoints: number;
  royaltyRecipient: string;
  soulbound: boolean;
}

export async function readMplAsset(asset: PublicKey): Promise<DecodedMplAsset | null> {
  const { umi, bundle, mpl, adapters } = await loadSdks();
  const ctx = makeUmiContext(asset, bundle, umi, adapters); // identity is throwaway for reads
  const umiAsset = adapters.fromWeb3JsPublicKey(asset);
  const raw = await mpl.fetchAssetV1(ctx, umiAsset);
  if (!raw) return null;

  const royalties = raw.plugins?.royalties;
  const royaltyRecipient = royalties?.creators?.[0]?.address
    ? adapters.toWeb3JsPublicKey(royalties.creators[0].address).toBase58()
    : '';
  const collection =
    raw.updateAuthority.type === 'Collection' && raw.updateAuthority.address
      ? adapters.toWeb3JsPublicKey(raw.updateAuthority.address).toBase58()
      : null;

  return {
    address: adapters.toWeb3JsPublicKey(raw.publicKey).toBase58(),
    collection,
    owner: adapters.toWeb3JsPublicKey(raw.owner).toBase58(),
    name: raw.name,
    uri: raw.uri,
    attributes: raw.plugins?.attributes?.attributeList ?? [],
    royaltyBasisPoints: royalties?.basisPoints ?? 0,
    royaltyRecipient,
    soulbound: raw.freezeDelegate?.frozen ?? false,
  };
}

// ── Transfer ────────────────────────────────────────────────────────────────

export async function transferMplAsset(args: {
  ownerUserId: string;
  asset: PublicKey;
  newOwner: PublicKey;
}): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isMplCoreConfigured()) throw new Error('mpl-core not configured');
  const wallet = await resolveUserSolanaWallet(args.ownerUserId);
  const { umi, bundle, mpl, adapters } = await loadSdks();
  const ctx = makeUmiContext(wallet.pubkey, bundle, umi, adapters);

  const builder = mpl.transfer(ctx, {
    asset: adapters.fromWeb3JsPublicKey(args.asset),
    newOwner: adapters.fromWeb3JsPublicKey(args.newOwner),
  });

  return sendNativeTx({
    userId: args.ownerUserId,
    instructions: umiInstructionsToWeb3(builder, adapters),
    computeUnitLimit: 200_000,
  });
}

// ── Collection setup (per-universe, one-time) ──────────────────────────────

export async function createCollectionForUniverse(args: {
  creatorUserId: string;
  name: string;
  uri: string;
}): Promise<{ txId: string; signature?: string; collection: string; state: string }> {
  if (!isMplCoreConfigured()) throw new Error('mpl-core not configured');
  const wallet = await resolveUserSolanaWallet(args.creatorUserId);
  const { umi, bundle, mpl, adapters } = await loadSdks();
  const ctx = makeUmiContext(wallet.pubkey, bundle, umi, adapters);

  const collectionSigner = umi.generateSigner(ctx);
  const collectionPubkey = adapters.toWeb3JsPublicKey(collectionSigner.publicKey);

  const builder = mpl.createCollection(ctx, {
    collection: collectionSigner,
    name: args.name.slice(0, 32),
    uri: args.uri,
    updateAuthority: adapters.fromWeb3JsPublicKey(wallet.pubkey),
  });

  const collectionKeypair = Keypair.fromSecretKey(collectionSigner.secretKey);

  const { executeSolanaTransaction } = await import('./circle-solana');
  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: umiInstructionsToWeb3(builder, adapters),
    additionalSigners: [collectionKeypair],
    computeUnitLimit: 400_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    collection: collectionPubkey.toBase58(),
    state: result.state,
  };
}
