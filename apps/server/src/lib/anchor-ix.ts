/**
 * Anchor instruction helpers — discriminator + minimal borsh encoding.
 *
 * Until `anchor build` emits IDLs into apps/programs/target/idl/, we can't
 * use @coral-xyz/anchor's BorshCoder. This module hand-builds the small
 * subset of instructions LOAR's server needs:
 *
 *   - universe::initialize_universe
 *   - universe::publish_universe
 *   - episode::mint_episode
 *   - episode::canonize
 *
 * Anchor instruction layout:
 *   [discriminator (8 bytes)] [borsh-encoded args ...]
 *
 * Discriminator = first 8 bytes of sha256("global:<snake_case_name>").
 *
 * After IDLs land, migrate to BorshCoder + Program<MyIdl> for type safety.
 */
import { createHash } from 'node:crypto';
import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';

// ── Discriminator ───────────────────────────────────────────────────────────

export function anchorDiscriminator(ixName: string): Buffer {
  return createHash('sha256').update(`global:${ixName}`).digest().subarray(0, 8);
}

export function anchorAccountDiscriminator(accountName: string): Buffer {
  return createHash('sha256').update(`account:${accountName}`).digest().subarray(0, 8);
}

export const UNIVERSE_DISCRIMINATOR: Buffer = anchorAccountDiscriminator('Universe');

// ── Borsh primitives (just what we need) ────────────────────────────────────

function encodeFixedBytes(buf: Buffer, length: number): Buffer {
  if (buf.length !== length) {
    throw new Error(`expected ${length}-byte value, got ${buf.length}`);
  }
  return buf;
}

function encodeString(s: string): Buffer {
  const data = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length, 0);
  return Buffer.concat([len, data]);
}

function encodeEnumUnit(variant: number): Buffer {
  return Buffer.from([variant]);
}

// ── Universe program ────────────────────────────────────────────────────────

export type Visibility = 'Private' | 'Public';

/** Derive the Universe PDA from creator + content_hash. */
export function deriveUniversePda(
  programId: PublicKey,
  creator: PublicKey,
  contentHash: Buffer
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('universe'), creator.toBuffer(), encodeFixedBytes(contentHash, 32)],
    programId
  );
}

/** Derive the Universe singleton Config PDA. */
export function deriveUniverseConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('universe_config')], programId);
}

// Universe account body (after 8-byte Anchor discriminator):
//   creator       Pubkey (32)
//   content_hash  [u8; 32]
//   plot_hash     [u8; 32]
//   visibility    enum (1)
//   canon_count   u64 (8)
//   bump          u8 (1)
// = 106 bytes (matches programs/universe/src/lib.rs `pub struct Universe`).
export interface DecodedUniverse {
  creator: PublicKey;
  contentHash: Buffer;
  plotHash: Buffer;
  visibility: Visibility;
  canonCount: bigint;
}

/**
 * Decode a Universe account body. Accepts either the raw account data
 * (with the 8-byte Anchor discriminator prefix — preferred) or just the
 * body. When the discriminator is present it MUST match
 * UNIVERSE_DISCRIMINATOR; mismatch returns null to signal "not a Universe".
 *
 * Used by routes that need the on-chain creator pubkey for CPI destination
 * accounts (e.g. subscription, remix fee).
 */
export function decodeUniverseAccount(data: Buffer): DecodedUniverse | null {
  let body = data;
  if (data.length >= 8) {
    const head = data.subarray(0, 8);
    if (head.equals(UNIVERSE_DISCRIMINATOR)) {
      body = data.subarray(8);
    } else if (data.length === 32 + 32 + 32 + 1 + 8) {
      // Exact body-only length — caller already stripped the discriminator.
      body = data;
    } else if (data.length === 32 + 32 + 32 + 1 + 8 + 8) {
      // Discriminator-prefixed but mismatched — refuse rather than guessing.
      return null;
    }
  }
  if (body.length < 32 + 32 + 32 + 1 + 8) return null;
  let off = 0;
  const creator = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const contentHash = Buffer.from(body.subarray(off, off + 32));
  off += 32;
  const plotHash = Buffer.from(body.subarray(off, off + 32));
  off += 32;
  const visibilityVariant = body.readUInt8(off);
  off += 1;
  const canonCount = body.readBigUInt64LE(off);
  return {
    creator,
    contentHash,
    plotHash,
    visibility: visibilityVariant === 0 ? 'Private' : 'Public',
    canonCount,
  };
}

export interface InitializeUniverseArgs {
  programId: PublicKey;
  creator: PublicKey;
  contentHash: Buffer; // 32 bytes
  plotHash: Buffer; // 32 bytes
  visibility: Visibility;
}

export function buildInitializeUniverseIx(args: InitializeUniverseArgs): TransactionInstruction {
  const [universePda] = deriveUniversePda(args.programId, args.creator, args.contentHash);
  const [configPda] = deriveUniverseConfigPda(args.programId);

  const data = Buffer.concat([
    anchorDiscriminator('initialize_universe'),
    encodeFixedBytes(args.contentHash, 32),
    encodeFixedBytes(args.plotHash, 32),
    encodeEnumUnit(args.visibility === 'Private' ? 0 : 1),
  ]);

  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.creator, isSigner: true, isWritable: true },
      { pubkey: universePda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface InitializeUniverseConfigArgs {
  programId: PublicKey;
  admin: PublicKey;
}

export function buildInitializeUniverseConfigIx(
  args: InitializeUniverseConfigArgs
): TransactionInstruction {
  const [configPda] = deriveUniverseConfigPda(args.programId);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('initialize_config'),
  });
}

// ── Episode program ─────────────────────────────────────────────────────────

/** Derive the EpisodeRecord PDA from universe + content_hash. */
export function deriveEpisodeRecordPda(
  programId: PublicKey,
  universe: PublicKey,
  contentHash: Buffer
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('episode'), universe.toBuffer(), encodeFixedBytes(contentHash, 32)],
    programId
  );
}

/** Derive the Episode singleton Config PDA. */
export function deriveEpisodeConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('episode_config')], programId);
}

export interface CanonizeEpisodeArgs {
  programId: PublicKey;
  signer: PublicKey;
  episodeRecord: PublicKey;
}

export function buildCanonizeEpisodeIx(args: CanonizeEpisodeArgs): TransactionInstruction {
  // `canonize` takes no args — just the discriminator.
  const data = anchorDiscriminator('canonize');
  const [configPda] = deriveEpisodeConfigPda(args.programId);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.signer, isSigner: true, isWritable: false },
      { pubkey: args.episodeRecord, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface MintEpisodeArgs {
  programId: PublicKey;
  creator: PublicKey;
  universe: PublicKey;
  contentHash: Buffer; // 32 bytes
  metadataUri: string;
  title: string;
}

export function buildMintEpisodeIx(args: MintEpisodeArgs): TransactionInstruction {
  if (args.metadataUri.length > 200) {
    throw new Error('metadataUri exceeds 200 chars (matches program-side require)');
  }
  if (args.title.length > 64) {
    throw new Error('title exceeds 64 chars (matches program-side require)');
  }

  const [episodeRecordPda] = deriveEpisodeRecordPda(
    args.programId,
    args.universe,
    args.contentHash
  );
  const [configPda] = deriveEpisodeConfigPda(args.programId);

  const data = Buffer.concat([
    anchorDiscriminator('mint_episode'),
    encodeFixedBytes(args.contentHash, 32),
    encodeString(args.metadataUri),
    encodeString(args.title),
  ]);

  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.creator, isSigner: true, isWritable: true },
      { pubkey: args.universe, isSigner: false, isWritable: false },
      { pubkey: episodeRecordPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface InitializeEpisodeConfigArgs {
  programId: PublicKey;
  admin: PublicKey;
}

export function buildInitializeEpisodeConfigIx(
  args: InitializeEpisodeConfigArgs
): TransactionInstruction {
  const [configPda] = deriveEpisodeConfigPda(args.programId);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('initialize_config'),
  });
}

// ── Rights program ──────────────────────────────────────────────────────────
//
// Attestation-driven cache. EVM RightsRegistry stays canonical; this program
// mirrors classifications signed by the platform's rights_operator wallet so
// downstream Solana programs can gate `is_monetizable()` without cross-chain
// RPC. Source: apps/programs/programs/rights/src/lib.rs.

/** Solana-side rights classification — matches the Rust enum's discriminant order. */
export type SolanaRightsType =
  | 'Unset'
  | 'Fun'
  | 'Original'
  | 'Licensed'
  | 'PublicDomain'
  | 'Frozen';

const RIGHTS_TYPE_VARIANT: Record<SolanaRightsType, number> = {
  Unset: 0,
  Fun: 1,
  Original: 2,
  Licensed: 3,
  PublicDomain: 4,
  Frozen: 5,
};

export function deriveRightsConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('rights_config')], programId);
}

export function deriveRightsPda(programId: PublicKey, contentHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rights'), encodeFixedBytes(contentHash, 32)],
    programId
  );
}

export interface SetRightsViaAttestationArgs {
  programId: PublicKey;
  /** rights_operator wallet — must match Config.rights_operator on-chain. */
  operator: PublicKey;
  contentHash: Buffer; // 32 bytes
  rightsType: SolanaRightsType;
  /** Solana creator pubkey, or PublicKey.default for EVM-only content. */
  creator: PublicKey;
  evmCreator: Buffer; // 20 bytes — EVM address
  /** Strictly monotonic per content_hash. Server picks the scheme (e.g. blockNumber * MAX_LOG_INDEX + logIndex). */
  version: bigint;
  evmTxHash: Buffer; // 32 bytes
  evmBlockNumber: bigint;
}

function encodeU64Le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

export function buildSetRightsViaAttestationIx(
  args: SetRightsViaAttestationArgs
): TransactionInstruction {
  const [configPda] = deriveRightsConfigPda(args.programId);
  const [rightsPda] = deriveRightsPda(args.programId, args.contentHash);

  const data = Buffer.concat([
    anchorDiscriminator('set_rights_via_attestation'),
    encodeFixedBytes(args.contentHash, 32),
    encodeEnumUnit(RIGHTS_TYPE_VARIANT[args.rightsType]),
    args.creator.toBuffer(),
    encodeFixedBytes(args.evmCreator, 20),
    encodeU64Le(args.version),
    encodeFixedBytes(args.evmTxHash, 32),
    encodeU64Le(args.evmBlockNumber),
  ]);

  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.operator, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: rightsPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface InitializeRightsConfigArgs {
  programId: PublicKey;
  admin: PublicKey;
  rightsOperator: PublicKey;
}

export function buildInitializeRightsConfigIx(
  args: InitializeRightsConfigArgs
): TransactionInstruction {
  const [configPda] = deriveRightsConfigPda(args.programId);
  const data = Buffer.concat([
    anchorDiscriminator('initialize_config'),
    args.rightsOperator.toBuffer(),
  ]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── Rights account decode ───────────────────────────────────────────────────
//
// Layout matches `apps/programs/programs/rights/src/lib.rs::Rights`:
//   [8-byte anchor account discriminator]
//   content_hash [u8; 32]
//   rights_type u8 (enum)
//   creator Pubkey (32)
//   evm_creator [u8; 20]
//   version u64
//   evm_tx_hash [u8; 32]
//   evm_block_number u64
//   last_attested_slot u64
//   bump u8
// = 8 + 32 + 1 + 32 + 20 + 8 + 32 + 8 + 8 + 1 = 150 bytes

const RIGHTS_TYPE_BY_VARIANT: SolanaRightsType[] = [
  'Unset',
  'Fun',
  'Original',
  'Licensed',
  'PublicDomain',
  'Frozen',
];

export interface DecodedRights {
  contentHashHex: string;
  rightsType: SolanaRightsType;
  creator: PublicKey;
  evmCreator: string; // 0x… hex
  version: bigint;
  evmTxHash: string; // 0x… hex
  evmBlockNumber: bigint;
  lastAttestedSlot: bigint;
  bump: number;
}

/**
 * Decode the borsh-serialized Rights account body (i.e. data starting AFTER
 * the 8-byte discriminator). Returns null if the buffer is too short or the
 * rights_type variant byte is unknown.
 */
export function decodeRightsAccount(body: Buffer): DecodedRights | null {
  if (body.length < 142) return null; // 150 total - 8 discriminator
  let off = 0;
  const contentHash = body.subarray(off, off + 32);
  off += 32;
  const rightsTypeVariant = body.readUInt8(off);
  off += 1;
  const rightsType = RIGHTS_TYPE_BY_VARIANT[rightsTypeVariant];
  if (!rightsType) return null;
  const creator = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const evmCreator = body.subarray(off, off + 20);
  off += 20;
  const version = body.readBigUInt64LE(off);
  off += 8;
  const evmTxHash = body.subarray(off, off + 32);
  off += 32;
  const evmBlockNumber = body.readBigUInt64LE(off);
  off += 8;
  const lastAttestedSlot = body.readBigUInt64LE(off);
  off += 8;
  const bump = body.readUInt8(off);

  return {
    contentHashHex: '0x' + contentHash.toString('hex'),
    rightsType,
    creator,
    evmCreator: '0x' + evmCreator.toString('hex'),
    version,
    evmTxHash: '0x' + evmTxHash.toString('hex'),
    evmBlockNumber,
    lastAttestedSlot,
    bump,
  };
}

/** Default-deny monetizability check. Mirrors EVM `RightsRegistry.isMonetizable`. */
export function isMonetizableRightsType(t: SolanaRightsType): boolean {
  return t === 'Original' || t === 'Licensed' || t === 'PublicDomain';
}

// ── Licensing program ──────────────────────────────────────────────────────
//
// BUY-only content licensing (v1). Source: apps/programs/programs/licensing/.

export function deriveLicensingConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('licensing_config')], programId);
}

export function deriveRegistrationPda(
  programId: PublicKey,
  contentHash: Buffer
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('registration'), encodeFixedBytes(contentHash, 32)],
    programId
  );
}

export function deriveBuyerDealPda(
  programId: PublicKey,
  contentHash: Buffer,
  buyer: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('buyer_deal'), encodeFixedBytes(contentHash, 32), buyer.toBuffer()],
    programId
  );
}

export interface BuyContentArgs {
  programId: PublicKey;
  buyer: PublicKey;
  /** Creator wallet from `Registration.creator`. */
  creator: PublicKey;
  contentHash: Buffer; // 32 bytes
}

export function buildBuyContentIx(args: BuyContentArgs): TransactionInstruction {
  const [configPda] = deriveLicensingConfigPda(args.programId);
  const [registrationPda] = deriveRegistrationPda(args.programId, args.contentHash);
  const [buyerDealPda] = deriveBuyerDealPda(args.programId, args.contentHash, args.buyer);
  const data = anchorDiscriminator('buy_content'); // no args — registration carries price
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.buyer, isSigner: true, isWritable: true },
      { pubkey: args.creator, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: registrationPda, isSigner: false, isWritable: false },
      { pubkey: buyerDealPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// Registration account body (after 8-byte discriminator):
//   content_hash [u8; 32]
//   creator      Pubkey (32)
//   universe     Pubkey (32)
//   buy_price_lamports u64 (8)
//   active       bool (1)
//   bump         u8 (1)
// = 106 bytes total payload
export interface DecodedRegistration {
  contentHashHex: string;
  creator: PublicKey;
  universe: PublicKey;
  buyPriceLamports: bigint;
  active: boolean;
}

export function decodeRegistrationAccount(body: Buffer): DecodedRegistration | null {
  if (body.length < 106) return null;
  let off = 0;
  const contentHash = body.subarray(off, off + 32);
  off += 32;
  const creator = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const universe = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const buyPriceLamports = body.readBigUInt64LE(off);
  off += 8;
  const active = body.readUInt8(off) !== 0;
  return {
    contentHashHex: '0x' + contentHash.toString('hex'),
    creator,
    universe,
    buyPriceLamports,
    active,
  };
}

// ── Subscription program ───────────────────────────────────────────────────

export function deriveSubscriptionConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('subscription_config')], programId);
}

export function deriveTierPda(
  programId: PublicKey,
  universe: PublicKey,
  tierId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('tier'), universe.toBuffer(), Buffer.from([tierId])],
    programId
  );
}

export function deriveSubscriptionPda(
  programId: PublicKey,
  subscriber: PublicKey,
  universe: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('subscription'), subscriber.toBuffer(), universe.toBuffer()],
    programId
  );
}

export interface SubscribeArgs {
  programId: PublicKey;
  subscriber: PublicKey;
  universeAccount: PublicKey; // Universe PDA
  universe: PublicKey; // same as universeAccount — passed as arg AND in seeds
  creator: PublicKey; // from Universe.creator
  platformTreasury: PublicKey; // from Config.platform
  tierId: number;
  months: number;
}

export function buildSubscribeIx(args: SubscribeArgs): TransactionInstruction {
  // H-4: hard cap months at the ix-builder boundary so a future route-validator
  // relaxation can't let the program-side u8 wrap past 255. 60 = 5 years, ample
  // for any legitimate prepay window.
  if (args.months <= 0 || args.months > 60) {
    throw new Error(`subscribe: months out of range (got ${args.months}, expected 1..60)`);
  }
  if (args.tierId > 3) throw new Error('tier_id must be < 4');

  const [configPda] = deriveSubscriptionConfigPda(args.programId);
  const [tierPda] = deriveTierPda(args.programId, args.universe, args.tierId);
  const [subscriptionPda] = deriveSubscriptionPda(args.programId, args.subscriber, args.universe);

  // ix args: (universe: Pubkey, tier_id: u8, months: u8)
  const data = Buffer.concat([
    anchorDiscriminator('subscribe'),
    args.universe.toBuffer(),
    Buffer.from([args.tierId]),
    Buffer.from([args.months]),
  ]);

  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.subscriber, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: args.universeAccount, isSigner: false, isWritable: false },
      { pubkey: tierPda, isSigner: false, isWritable: false },
      { pubkey: subscriptionPda, isSigner: false, isWritable: true },
      { pubkey: args.creator, isSigner: false, isWritable: true },
      { pubkey: args.platformTreasury, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// Subscription account body (after 8-byte discriminator):
//   user        Pubkey (32)
//   universe    Pubkey (32)
//   tier_id     u8 (1)
//   started_at  i64 (8)
//   expires_at  i64 (8)
//   bump        u8 (1)
// = 82 bytes
export interface DecodedSubscription {
  user: PublicKey;
  universe: PublicKey;
  tierId: number;
  startedAt: bigint;
  expiresAt: bigint;
}

export function decodeSubscriptionAccount(body: Buffer): DecodedSubscription | null {
  if (body.length < 82) return null;
  let off = 0;
  const user = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const universe = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const tierId = body.readUInt8(off);
  off += 1;
  const startedAt = body.readBigInt64LE(off);
  off += 8;
  const expiresAt = body.readBigInt64LE(off);
  return { user, universe, tierId, startedAt, expiresAt };
}

// ── Bonding curve program ──────────────────────────────────────────────────

export function deriveCurvePda(programId: PublicKey, universe: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('curve'), universe.toBuffer()], programId);
}

export function deriveCurveTokenVaultPda(
  programId: PublicKey,
  universe: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('curve_token_vault'), universe.toBuffer()],
    programId
  );
}

export function deriveCurveSolVaultPda(
  programId: PublicKey,
  universe: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('curve_sol_vault'), universe.toBuffer()],
    programId
  );
}

export function deriveCurveBuyerStatPda(
  programId: PublicKey,
  curve: PublicKey,
  buyer: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('curve_buyer_stat'), curve.toBuffer(), buyer.toBuffer()],
    programId
  );
}

export interface CurveBuyArgs {
  programId: PublicKey;
  buyer: PublicKey;
  universe: PublicKey;
  tokenMint: PublicKey;
  /** Token-2022 program ID (or classic SPL if used). */
  tokenProgramId: PublicKey;
  /** ATA program ID. */
  associatedTokenProgramId: PublicKey;
  buyerTokenAta: PublicKey;
  tokenVaultAta: PublicKey;
  solInMax: bigint;
  minTokensOut: bigint;
  deadline: bigint; // unix secs
}

export function buildCurveBuyIx(args: CurveBuyArgs): TransactionInstruction {
  const [curvePda] = deriveCurvePda(args.programId, args.universe);
  const [tokenVaultAuth] = deriveCurveTokenVaultPda(args.programId, args.universe);
  const [solVaultPda] = deriveCurveSolVaultPda(args.programId, args.universe);
  const [buyerStatPda] = deriveCurveBuyerStatPda(args.programId, curvePda, args.buyer);

  const data = Buffer.concat([
    anchorDiscriminator('buy'),
    encodeU64Le(args.solInMax),
    encodeU64Le(args.minTokensOut),
    encodeI64Le(args.deadline),
  ]);

  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.buyer, isSigner: true, isWritable: true },
      { pubkey: curvePda, isSigner: false, isWritable: true },
      { pubkey: args.tokenMint, isSigner: false, isWritable: false },
      { pubkey: tokenVaultAuth, isSigner: false, isWritable: false },
      { pubkey: args.tokenVaultAta, isSigner: false, isWritable: true },
      { pubkey: args.buyerTokenAta, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: buyerStatPda, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: args.associatedTokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface CurveSellArgs {
  programId: PublicKey;
  seller: PublicKey;
  universe: PublicKey;
  tokenMint: PublicKey;
  tokenProgramId: PublicKey;
  sellerTokenAta: PublicKey;
  tokenVaultAta: PublicKey;
  tokenAmount: bigint;
  minSolOut: bigint;
  deadline: bigint;
}

export function buildCurveSellIx(args: CurveSellArgs): TransactionInstruction {
  const [curvePda] = deriveCurvePda(args.programId, args.universe);
  const [tokenVaultAuth] = deriveCurveTokenVaultPda(args.programId, args.universe);
  const [solVaultPda] = deriveCurveSolVaultPda(args.programId, args.universe);

  const data = Buffer.concat([
    anchorDiscriminator('sell'),
    encodeU64Le(args.tokenAmount),
    encodeU64Le(args.minSolOut),
    encodeI64Le(args.deadline),
  ]);

  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.seller, isSigner: true, isWritable: true },
      { pubkey: curvePda, isSigner: false, isWritable: true },
      { pubkey: args.tokenMint, isSigner: false, isWritable: false },
      { pubkey: tokenVaultAuth, isSigner: false, isWritable: false },
      { pubkey: args.tokenVaultAta, isSigner: false, isWritable: true },
      { pubkey: args.sellerTokenAta, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// Curve account body (after 8-byte discriminator):
//   universe         Pubkey (32)
//   token_mint       Pubkey (32)
//   creator          Pubkey (32)
//   total_curve_supply  u64 (8)
//   graduation_lamports u64 (8)
//   slope_scaled     u128 (16)
//   max_buy_tokens   u64 (8)
//   max_cumulative_buy u64 (8)
//   tokens_sold      u64 (8)
//   sol_raised       u64 (8)
//   graduated        bool (1)
//   trading_halted   bool (1)
//   bump             u8 (1)
//   token_vault_bump u8 (1)
//   sol_vault_bump   u8 (1)
// = 169 bytes
export interface DecodedCurve {
  universe: PublicKey;
  tokenMint: PublicKey;
  creator: PublicKey;
  totalCurveSupply: bigint;
  graduationLamports: bigint;
  slopeScaled: bigint;
  maxBuyTokens: bigint;
  maxCumulativeBuy: bigint;
  tokensSold: bigint;
  solRaised: bigint;
  graduated: boolean;
  tradingHalted: boolean;
}

export function decodeCurveAccount(body: Buffer): DecodedCurve | null {
  if (body.length < 169) return null;
  let off = 0;
  const universe = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const tokenMint = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const creator = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const totalCurveSupply = body.readBigUInt64LE(off);
  off += 8;
  const graduationLamports = body.readBigUInt64LE(off);
  off += 8;
  // u128 little-endian: lower 8 bytes + upper 8 bytes
  const slopeLo = body.readBigUInt64LE(off);
  const slopeHi = body.readBigUInt64LE(off + 8);
  const slopeScaled = (slopeHi << 64n) | slopeLo;
  off += 16;
  const maxBuyTokens = body.readBigUInt64LE(off);
  off += 8;
  const maxCumulativeBuy = body.readBigUInt64LE(off);
  off += 8;
  const tokensSold = body.readBigUInt64LE(off);
  off += 8;
  const solRaised = body.readBigUInt64LE(off);
  off += 8;
  const graduated = body.readUInt8(off) !== 0;
  off += 1;
  const tradingHalted = body.readUInt8(off) !== 0;
  return {
    universe,
    tokenMint,
    creator,
    totalCurveSupply,
    graduationLamports,
    slopeScaled,
    maxBuyTokens,
    maxCumulativeBuy,
    tokensSold,
    solRaised,
    graduated,
    tradingHalted,
  };
}

// ── Borsh primitive: signed i64 (used by curve deadlines) ──────────────────
// `encodeU64Le` already defined in the rights section above; reused here.

function encodeI64Le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value, 0);
  return buf;
}

// ── Staking program ────────────────────────────────────────────────────────
//
// LaunchpadStaking v1 (global + per-universe). No reward distribution yet.

export function deriveStakingConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('staking_config')], programId);
}

export function deriveStakingGlobalVaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('global_vault')], programId);
}

export function deriveStakeInfoPda(programId: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('stake_info'), user.toBuffer()], programId);
}

export function deriveUniversePoolPda(
  programId: PublicKey,
  universe: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('universe_pool'), universe.toBuffer()],
    programId
  );
}

export function deriveUniverseVaultPda(
  programId: PublicKey,
  universe: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('universe_vault'), universe.toBuffer()],
    programId
  );
}

export function deriveUniverseStakePda(
  programId: PublicKey,
  user: PublicKey,
  universe: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('universe_stake'), user.toBuffer(), universe.toBuffer()],
    programId
  );
}

export interface StakeArgs {
  programId: PublicKey;
  user: PublicKey;
  loarMint: PublicKey;
  tokenProgramId: PublicKey;
  userLoarAta: PublicKey;
  globalVaultAta: PublicKey;
  amount: bigint;
}

export function buildStakeIx(args: StakeArgs): TransactionInstruction {
  const [configPda] = deriveStakingConfigPda(args.programId);
  const [stakeInfoPda] = deriveStakeInfoPda(args.programId, args.user);
  const [globalVault] = deriveStakingGlobalVaultPda(args.programId);
  const data = Buffer.concat([anchorDiscriminator('stake'), encodeU64Le(args.amount)]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.user, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: args.loarMint, isSigner: false, isWritable: false },
      { pubkey: stakeInfoPda, isSigner: false, isWritable: true },
      { pubkey: globalVault, isSigner: false, isWritable: false },
      { pubkey: args.globalVaultAta, isSigner: false, isWritable: true },
      { pubkey: args.userLoarAta, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface UnstakeArgs extends StakeArgs {
  /** Penalty destination ATA (LP wallet's LOAR ATA). */
  penaltyDestinationAta: PublicKey;
}

export function buildUnstakeIx(args: UnstakeArgs): TransactionInstruction {
  const [configPda] = deriveStakingConfigPda(args.programId);
  const [stakeInfoPda] = deriveStakeInfoPda(args.programId, args.user);
  const [globalVault] = deriveStakingGlobalVaultPda(args.programId);
  const data = Buffer.concat([anchorDiscriminator('unstake'), encodeU64Le(args.amount)]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.user, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: args.loarMint, isSigner: false, isWritable: false },
      { pubkey: stakeInfoPda, isSigner: false, isWritable: true },
      { pubkey: globalVault, isSigner: false, isWritable: false },
      { pubkey: args.globalVaultAta, isSigner: false, isWritable: true },
      { pubkey: args.userLoarAta, isSigner: false, isWritable: true },
      { pubkey: args.penaltyDestinationAta, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// StakeInfo body (after 8-byte disc):
//   user Pubkey, amount u64, staked_at i64, last_claim_at i64, tier u8, bump u8
// = 58 bytes
export interface DecodedStakeInfo {
  user: PublicKey;
  amount: bigint;
  stakedAt: bigint;
  lastClaimAt: bigint;
  tier: number;
}

export function decodeStakeInfoAccount(body: Buffer): DecodedStakeInfo | null {
  if (body.length < 58) return null;
  let off = 0;
  const user = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const amount = body.readBigUInt64LE(off);
  off += 8;
  const stakedAt = body.readBigInt64LE(off);
  off += 8;
  const lastClaimAt = body.readBigInt64LE(off);
  off += 8;
  const tier = body.readUInt8(off);
  return { user, amount, stakedAt, lastClaimAt, tier };
}

// ── Credit Manager program ─────────────────────────────────────────────────

export function deriveCreditConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('credit_manager_config')], programId);
}

export function deriveCreditSolVaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('credit_sol_vault')], programId);
}

export function deriveCreditLoarVaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('credit_loar_vault')], programId);
}

export function deriveCreditPackagePda(
  programId: PublicKey,
  packageId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('package'), encodeU64Le(packageId)],
    programId
  );
}

export function deriveUserCreditsPda(programId: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_credits'), user.toBuffer()],
    programId
  );
}

export interface PurchaseWithSolArgs {
  programId: PublicKey;
  buyer: PublicKey;
  packageId: bigint;
}

export function buildPurchaseWithSolIx(args: PurchaseWithSolArgs): TransactionInstruction {
  const [configPda] = deriveCreditConfigPda(args.programId);
  const [solVault] = deriveCreditSolVaultPda(args.programId);
  const [packagePda] = deriveCreditPackagePda(args.programId, args.packageId);
  const [userCreditsPda] = deriveUserCreditsPda(args.programId, args.buyer);
  const data = Buffer.concat([
    anchorDiscriminator('purchase_with_sol'),
    encodeU64Le(args.packageId),
  ]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.buyer, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: packagePda, isSigner: false, isWritable: false },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: userCreditsPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface PurchaseWithLoarArgs {
  programId: PublicKey;
  buyer: PublicKey;
  packageId: bigint;
  loarMint: PublicKey;
  tokenProgramId: PublicKey;
  buyerLoarAta: PublicKey;
  loarVaultAta: PublicKey;
}

export function buildPurchaseWithLoarIx(args: PurchaseWithLoarArgs): TransactionInstruction {
  const [configPda] = deriveCreditConfigPda(args.programId);
  const [loarVault] = deriveCreditLoarVaultPda(args.programId);
  const [packagePda] = deriveCreditPackagePda(args.programId, args.packageId);
  const [userCreditsPda] = deriveUserCreditsPda(args.programId, args.buyer);
  const data = Buffer.concat([
    anchorDiscriminator('purchase_with_loar'),
    encodeU64Le(args.packageId),
  ]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.buyer, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: args.loarMint, isSigner: false, isWritable: false },
      { pubkey: packagePda, isSigner: false, isWritable: false },
      { pubkey: loarVault, isSigner: false, isWritable: false },
      { pubkey: args.loarVaultAta, isSigner: false, isWritable: true },
      { pubkey: args.buyerLoarAta, isSigner: false, isWritable: true },
      { pubkey: userCreditsPda, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// UserCredits body (after 8-byte disc):
//   user Pubkey (32)
//   balance u64 (8)
//   total_purchased u64 (8)
//   total_spent u64 (8)
//   total_bonus_received u64 (8)
//   granted_total u64 (8)
//   bump u8 (1)
// = 73 bytes
export interface DecodedUserCredits {
  user: PublicKey;
  balance: bigint;
  totalPurchased: bigint;
  totalSpent: bigint;
  totalBonusReceived: bigint;
  grantedTotal: bigint;
}

export function decodeUserCreditsAccount(body: Buffer): DecodedUserCredits | null {
  if (body.length < 73) return null;
  let off = 0;
  const user = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const balance = body.readBigUInt64LE(off);
  off += 8;
  const totalPurchased = body.readBigUInt64LE(off);
  off += 8;
  const totalSpent = body.readBigUInt64LE(off);
  off += 8;
  const totalBonusReceived = body.readBigUInt64LE(off);
  off += 8;
  const grantedTotal = body.readBigUInt64LE(off);
  return { user, balance, totalPurchased, totalSpent, totalBonusReceived, grantedTotal };
}

// ── Canon Market program ───────────────────────────────────────────────────

export function deriveCanonConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('canon_config')], programId);
}

export function deriveCanonSubmissionPda(
  programId: PublicKey,
  universe: PublicKey,
  contentHash: Buffer
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('canon_submission'), universe.toBuffer(), encodeFixedBytes(contentHash, 32)],
    programId
  );
}

export function deriveCanonVoteLockPda(
  programId: PublicKey,
  submission: PublicKey,
  voter: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('canon_vote_lock'), submission.toBuffer(), voter.toBuffer()],
    programId
  );
}

export function deriveCanonVoteVaultPda(
  programId: PublicKey,
  submission: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('canon_vote_vault'), submission.toBuffer()],
    programId
  );
}

export interface CanonVoteArgs {
  programId: PublicKey;
  voter: PublicKey;
  submission: PublicKey;
  tokenMint: PublicKey;
  tokenProgramId: PublicKey;
  associatedTokenProgramId: PublicKey;
  voterTokenAta: PublicKey;
  voteVaultAta: PublicKey;
  support: boolean;
  amount: bigint;
}

export function buildCanonVoteIx(args: CanonVoteArgs): TransactionInstruction {
  const [configPda] = deriveCanonConfigPda(args.programId);
  const [voteVaultAuth] = deriveCanonVoteVaultPda(args.programId, args.submission);
  const [voteLockPda] = deriveCanonVoteLockPda(args.programId, args.submission, args.voter);
  const data = Buffer.concat([
    anchorDiscriminator('vote'),
    Buffer.from([args.support ? 1 : 0]),
    encodeU64Le(args.amount),
  ]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.voter, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: args.submission, isSigner: false, isWritable: true },
      { pubkey: args.tokenMint, isSigner: false, isWritable: false },
      { pubkey: voteVaultAuth, isSigner: false, isWritable: false },
      { pubkey: args.voteVaultAta, isSigner: false, isWritable: true },
      { pubkey: args.voterTokenAta, isSigner: false, isWritable: true },
      { pubkey: voteLockPda, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: args.associatedTokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// Submission body:
//   id u64 (8) + universe Pubkey (32) + token_mint Pubkey (32) + submitter Pubkey (32)
//   + content_hash [u8;32] (32) + episode_record Pubkey (32) + submission_fee u64 (8)
//   + submitted_at i64 (8) + deadline i64 (8) + finalized_at i64 (8) + quorum_threshold u64 (8)
//   + votes_for u64 (8) + votes_against u64 (8) + state u8 (1) + bump u8 (1) + vote_vault_bump u8 (1)
// = 235 bytes
export type CanonSubmissionState = 'Active' | 'Accepted' | 'Rejected' | 'Expired';

const CANON_STATE_VARIANTS: CanonSubmissionState[] = ['Active', 'Accepted', 'Rejected', 'Expired'];

export interface DecodedCanonSubmission {
  id: bigint;
  universe: PublicKey;
  tokenMint: PublicKey;
  submitter: PublicKey;
  contentHashHex: string;
  episodeRecord: PublicKey;
  submissionFee: bigint;
  submittedAt: bigint;
  deadline: bigint;
  finalizedAt: bigint;
  quorumThreshold: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  state: CanonSubmissionState;
}

export function decodeCanonSubmissionAccount(body: Buffer): DecodedCanonSubmission | null {
  if (body.length < 235) return null;
  let off = 0;
  const id = body.readBigUInt64LE(off);
  off += 8;
  const universe = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const tokenMint = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const submitter = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const contentHash = body.subarray(off, off + 32);
  off += 32;
  const episodeRecord = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const submissionFee = body.readBigUInt64LE(off);
  off += 8;
  const submittedAt = body.readBigInt64LE(off);
  off += 8;
  const deadline = body.readBigInt64LE(off);
  off += 8;
  const finalizedAt = body.readBigInt64LE(off);
  off += 8;
  const quorumThreshold = body.readBigUInt64LE(off);
  off += 8;
  const votesFor = body.readBigUInt64LE(off);
  off += 8;
  const votesAgainst = body.readBigUInt64LE(off);
  off += 8;
  const stateVariant = body.readUInt8(off);
  const state = CANON_STATE_VARIANTS[stateVariant];
  if (!state) return null;
  return {
    id,
    universe,
    tokenMint,
    submitter,
    contentHashHex: '0x' + contentHash.toString('hex'),
    episodeRecord,
    submissionFee,
    submittedAt,
    deadline,
    finalizedAt,
    quorumThreshold,
    votesFor,
    votesAgainst,
    state,
  };
}

// ── Split Router program ───────────────────────────────────────────────────

export function deriveSplitRouterConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('split_router_config')], programId);
}

export function deriveSplitsPda(programId: PublicKey, entityHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('splits'), encodeFixedBytes(entityHash, 32)],
    programId
  );
}

export interface RouteWithSplitsArgs {
  programId: PublicKey;
  payer: PublicKey;
  entityHash: Buffer;
  treasury: PublicKey;
  /** Recipients passed as `remaining_accounts` in order matching the stored Splits PDA. */
  recipients: PublicKey[];
  amountLamports: bigint;
  platformFeeBps: number;
}

export function buildRouteWithSplitsIx(args: RouteWithSplitsArgs): TransactionInstruction {
  const [configPda] = deriveSplitRouterConfigPda(args.programId);
  const [splitsPda] = deriveSplitsPda(args.programId, args.entityHash);
  const data = Buffer.concat([
    anchorDiscriminator('route_with_splits'),
    encodeU64Le(args.amountLamports),
    Buffer.from([args.platformFeeBps & 0xff, (args.platformFeeBps >> 8) & 0xff]),
  ]);

  const keys = [
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: splitsPda, isSigner: false, isWritable: false },
    { pubkey: args.treasury, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // remaining_accounts: recipients in the same order as Splits.recipients[0..n]
    ...args.recipients.map((pk) => ({ pubkey: pk, isSigner: false, isWritable: true })),
  ];
  return new TransactionInstruction({ programId: args.programId, keys, data });
}

// Splits body:
//   entity_hash [u8;32] (32)
//   owner Pubkey (32)
//   recipient_count u8 (1)
//   recipients [Pubkey; 10] (320)
//   bps [u16; 10] (20)
//   last_changed_at i64 (8)
//   bump u8 (1)
// = 414 bytes
export interface DecodedSplits {
  entityHashHex: string;
  owner: PublicKey;
  recipientCount: number;
  recipients: PublicKey[];
  bps: number[];
  lastChangedAt: bigint;
}

export function decodeSplitsAccount(body: Buffer): DecodedSplits | null {
  if (body.length < 414) return null;
  let off = 0;
  const entityHash = body.subarray(off, off + 32);
  off += 32;
  const owner = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const recipientCount = body.readUInt8(off);
  off += 1;
  const recipients: PublicKey[] = [];
  for (let i = 0; i < 10; i++) {
    recipients.push(new PublicKey(body.subarray(off, off + 32)));
    off += 32;
  }
  const bps: number[] = [];
  for (let i = 0; i < 10; i++) {
    bps.push(body.readUInt16LE(off));
    off += 2;
  }
  const lastChangedAt = body.readBigInt64LE(off);
  return {
    entityHashHex: '0x' + entityHash.toString('hex'),
    owner,
    recipientCount,
    recipients: recipients.slice(0, recipientCount),
    bps: bps.slice(0, recipientCount),
    lastChangedAt,
  };
}

// ── Remix Fees program ────────────────────────────────────────────────────

export function deriveRemixFeesConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('remix_fees_config')], programId);
}

export function deriveUniverseFeePda(
  programId: PublicKey,
  universe: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('universe_fee'), universe.toBuffer()],
    programId
  );
}

export interface ChargeRemixFeeArgs {
  programId: PublicKey;
  remixer: PublicKey;
  universeAccount: PublicKey;
  universe: PublicKey;
  loarMint: PublicKey;
  tokenProgramId: PublicKey;
  associatedTokenProgramId: PublicKey;
  remixerAta: PublicKey;
  /** Original creator wallet — from Universe.creator. */
  originalCreator: PublicKey;
  creatorAta: PublicKey;
  lpAta: PublicKey;
  treasuryAta: PublicKey;
  contentHash: Buffer;
}

export function buildChargeRemixFeeIx(args: ChargeRemixFeeArgs): TransactionInstruction {
  const [configPda] = deriveRemixFeesConfigPda(args.programId);
  const [universeFeePda] = deriveUniverseFeePda(args.programId, args.universe);
  const data = Buffer.concat([
    anchorDiscriminator('charge_remix_fee'),
    args.universe.toBuffer(),
    encodeFixedBytes(args.contentHash, 32),
  ]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.remixer, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: args.loarMint, isSigner: false, isWritable: false },
      { pubkey: args.universeAccount, isSigner: false, isWritable: false },
      { pubkey: universeFeePda, isSigner: false, isWritable: true },
      { pubkey: args.remixerAta, isSigner: false, isWritable: true },
      { pubkey: args.originalCreator, isSigner: false, isWritable: false },
      { pubkey: args.creatorAta, isSigner: false, isWritable: true },
      { pubkey: args.lpAta, isSigner: false, isWritable: true },
      { pubkey: args.treasuryAta, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: args.associatedTokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// RemixFees Config body (after 8-byte disc):
//   admin Pubkey (32)
//   pending_admin Pubkey (32)
//   loar_mint Pubkey (32)
//   treasury Pubkey (32)
//   liquidity_pool Pubkey (32)
//   default_remix_fee u64 (8)
//   min_remix_fee u64 (8)
//   creator_share_bps u16 (2)
//   lp_share_bps u16 (2)
//   treasury_share_bps u16 (2)
//   total_remix_fees u64 (8)
//   total_remixes u64 (8)
//   paused bool (1)
//   bump u8 (1)
// = 200 bytes
export interface DecodedRemixFeesConfig {
  admin: PublicKey;
  loarMint: PublicKey;
  treasury: PublicKey;
  liquidityPool: PublicKey;
  defaultRemixFee: bigint;
  minRemixFee: bigint;
  creatorShareBps: number;
  lpShareBps: number;
  treasuryShareBps: number;
  totalRemixFees: bigint;
  totalRemixes: bigint;
  paused: boolean;
}

export function decodeRemixFeesConfigAccount(body: Buffer): DecodedRemixFeesConfig | null {
  if (body.length < 200) return null;
  let off = 0;
  const admin = new PublicKey(body.subarray(off, off + 32));
  off += 32 + 32; // skip pending_admin
  const loarMint = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const treasury = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const liquidityPool = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const defaultRemixFee = body.readBigUInt64LE(off);
  off += 8;
  const minRemixFee = body.readBigUInt64LE(off);
  off += 8;
  const creatorShareBps = body.readUInt16LE(off);
  off += 2;
  const lpShareBps = body.readUInt16LE(off);
  off += 2;
  const treasuryShareBps = body.readUInt16LE(off);
  off += 2;
  const totalRemixFees = body.readBigUInt64LE(off);
  off += 8;
  const totalRemixes = body.readBigUInt64LE(off);
  off += 8;
  const paused = body.readUInt8(off) !== 0;
  return {
    admin,
    loarMint,
    treasury,
    liquidityPool,
    defaultRemixFee,
    minRemixFee,
    creatorShareBps,
    lpShareBps,
    treasuryShareBps,
    totalRemixFees,
    totalRemixes,
    paused,
  };
}

// ── Fee Locker program ────────────────────────────────────────────────────

export function deriveFeeLockerConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fee_locker_config')], programId);
}

export function deriveFeeDepositorPda(
  programId: PublicKey,
  depositor: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_locker_depositor'), depositor.toBuffer()],
    programId
  );
}

export function deriveFeeBalancePda(
  programId: PublicKey,
  feeOwner: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_balance'), feeOwner.toBuffer(), mint.toBuffer()],
    programId
  );
}

export function deriveFeeVaultPda(programId: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fee_vault'), mint.toBuffer()], programId);
}

export interface FeeLockerClaimArgs {
  programId: PublicKey;
  feeOwner: PublicKey;
  mint: PublicKey;
  tokenProgramId: PublicKey;
  associatedTokenProgramId: PublicKey;
  vaultAta: PublicKey;
  feeOwnerAta: PublicKey;
}

export function buildFeeLockerClaimIx(args: FeeLockerClaimArgs): TransactionInstruction {
  const [vaultAuthority] = deriveFeeVaultPda(args.programId, args.mint);
  const [feeBalancePda] = deriveFeeBalancePda(args.programId, args.feeOwner, args.mint);
  const data = anchorDiscriminator('claim');
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.feeOwner, isSigner: true, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: args.vaultAta, isSigner: false, isWritable: true },
      { pubkey: args.feeOwnerAta, isSigner: false, isWritable: true },
      { pubkey: feeBalancePda, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: args.associatedTokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// FeeBalance body:
//   fee_owner Pubkey (32) + mint Pubkey (32) + amount u64 (8)
//   + total_deposited u64 (8) + total_claimed u64 (8) + bump u8 (1)
// = 89 bytes
export interface DecodedFeeBalance {
  feeOwner: PublicKey;
  mint: PublicKey;
  amount: bigint;
  totalDeposited: bigint;
  totalClaimed: bigint;
}

export function decodeFeeBalanceAccount(body: Buffer): DecodedFeeBalance | null {
  if (body.length < 89) return null;
  let off = 0;
  const feeOwner = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const mint = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const amount = body.readBigUInt64LE(off);
  off += 8;
  const totalDeposited = body.readBigUInt64LE(off);
  off += 8;
  const totalClaimed = body.readBigUInt64LE(off);
  return { feeOwner, mint, amount, totalDeposited, totalClaimed };
}

// ── Loar Burner program ────────────────────────────────────────────────────

export function deriveBurnerConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('burner_config')], programId);
}

export function deriveBurnerActionPda(programId: PublicKey, name: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('burner_action'), encodeFixedBytes(name, 32)],
    programId
  );
}

export interface ExecuteBurnerActionArgs {
  programId: PublicKey;
  user: PublicKey;
  loarMint: PublicKey;
  tokenProgramId: PublicKey;
  userLoarAta: PublicKey;
  lpAta: PublicKey;
  treasuryAta: PublicKey;
  name: Buffer; // 32 bytes
}

export function buildExecuteBurnerActionIx(args: ExecuteBurnerActionArgs): TransactionInstruction {
  const [configPda] = deriveBurnerConfigPda(args.programId);
  const [actionPda] = deriveBurnerActionPda(args.programId, args.name);
  const data = Buffer.concat([
    anchorDiscriminator('execute_action'),
    encodeFixedBytes(args.name, 32),
  ]);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.user, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: args.loarMint, isSigner: false, isWritable: false },
      { pubkey: actionPda, isSigner: false, isWritable: true },
      { pubkey: args.userLoarAta, isSigner: false, isWritable: true },
      { pubkey: args.lpAta, isSigner: false, isWritable: true },
      { pubkey: args.treasuryAta, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// Burner Config body (after 8-byte disc):
//   admin(32) pending_admin(32) platform(32) loar_mint(32) treasury(32) lp(32)
//   lp_ratio_bps(2) total_collected(8) total_to_lp(8) paused(1) bump(1)
// = 222 bytes
export interface DecodedBurnerConfig {
  admin: PublicKey;
  platform: PublicKey;
  loarMint: PublicKey;
  treasury: PublicKey;
  liquidityPool: PublicKey;
  lpRatioBps: number;
  totalCollected: bigint;
  totalToLp: bigint;
  paused: boolean;
}

export function decodeBurnerConfigAccount(body: Buffer): DecodedBurnerConfig | null {
  if (body.length < 222) return null;
  let off = 0;
  const admin = new PublicKey(body.subarray(off, off + 32));
  off += 32 + 32; // skip pending_admin
  const platform = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const loarMint = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const treasury = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const liquidityPool = new PublicKey(body.subarray(off, off + 32));
  off += 32;
  const lpRatioBps = body.readUInt16LE(off);
  off += 2;
  const totalCollected = body.readBigUInt64LE(off);
  off += 8;
  const totalToLp = body.readBigUInt64LE(off);
  off += 8;
  const paused = body.readUInt8(off) !== 0;
  return {
    admin,
    platform,
    loarMint,
    treasury,
    liquidityPool,
    lpRatioBps,
    totalCollected,
    totalToLp,
    paused,
  };
}

// Burner Action body:
//   name [u8;32] (32) + cost u64 (8) + active bool (1)
//   + total_collected u64 (8) + total_count u64 (8) + bump u8 (1)
// = 58 bytes
export interface DecodedBurnerAction {
  nameHex: string;
  cost: bigint;
  active: boolean;
  totalCollected: bigint;
  totalCount: bigint;
}

export function decodeBurnerActionAccount(body: Buffer): DecodedBurnerAction | null {
  if (body.length < 58) return null;
  let off = 0;
  const name = body.subarray(off, off + 32);
  off += 32;
  const cost = body.readBigUInt64LE(off);
  off += 8;
  const active = body.readUInt8(off) !== 0;
  off += 1;
  const totalCollected = body.readBigUInt64LE(off);
  off += 8;
  const totalCount = body.readBigUInt64LE(off);
  return {
    nameHex: '0x' + name.toString('hex'),
    cost,
    active,
    totalCollected,
    totalCount,
  };
}
