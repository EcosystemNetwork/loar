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
