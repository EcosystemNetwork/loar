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
