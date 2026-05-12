/**
 * Anchor event decoder — turns raw Helius webhook payloads into typed
 * UniverseCreated / EpisodeMinted / EpisodeCanonized event objects.
 *
 * Anchor emits events via the `emit!` macro, which under the hood logs a
 * base64-encoded `Event` discriminator + borsh-serialized payload via
 * `sol_log_data`. Helius surfaces these as `instructions[*].innerInstructions[*]`
 * with `programId == THIS_PROGRAM` and `data` = base58 of the discriminator+payload.
 *
 * Strategy: hand-coded borsh decoders matched on discriminator (sha256("event:<Name>")[..8]).
 * Once `anchor build` emits IDLs into apps/programs/target/idl/, we can swap
 * to `@coral-xyz/anchor`'s BorshEventCoder for fully-generated decoding.
 */
import { createHash } from 'node:crypto';
import bs58 from 'bs58';

function eventDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
}

const DISC = {
  UniverseCreated: eventDiscriminator('UniverseCreated'),
  UniversePublished: eventDiscriminator('UniversePublished'),
  EpisodeMinted: eventDiscriminator('EpisodeMinted'),
  EpisodeCanonized: eventDiscriminator('EpisodeCanonized'),
};

// ── Borsh primitives ────────────────────────────────────────────────────────

class BorshReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  remaining(): number {
    return this.buf.length - this.offset;
  }

  readPubkey(): string {
    const slice = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return bs58.encode(slice);
  }

  readFixedBytes(n: number): Buffer {
    const slice = Buffer.from(this.buf.subarray(this.offset, this.offset + n));
    this.offset += n;
    return slice;
  }

  readU8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readU64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readString(): string {
    const len = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    const s = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return s;
  }

  readVisibilityEnum(): 'Private' | 'Public' {
    const variant = this.readU8();
    return variant === 0 ? 'Private' : 'Public';
  }
}

// ── Decoded event types ─────────────────────────────────────────────────────

export type DecodedEvent =
  | {
      kind: 'UniverseCreated';
      universe: string;
      creator: string;
      contentHashHex: string;
      plotHashHex: string;
      visibility: 'Private' | 'Public';
    }
  | { kind: 'UniversePublished'; universe: string }
  | {
      kind: 'EpisodeMinted';
      episode: string;
      universe: string;
      creator: string;
      contentHashHex: string;
      title: string;
      metadataUri: string;
    }
  | { kind: 'EpisodeCanonized'; episode: string; universe: string };

function hex(buf: Buffer): string {
  return '0x' + buf.toString('hex');
}

/**
 * Decode a single Anchor event from its raw log payload (base58-encoded
 * discriminator+borsh from `sol_log_data`).
 *
 * Returns null if the discriminator doesn't match any known LOAR event —
 * other programs' events get silently ignored at this layer.
 */
export function decodeAnchorEvent(dataBase58: string): DecodedEvent | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(bs58.decode(dataBase58));
  } catch {
    return null;
  }
  if (raw.length < 8) return null;

  const disc = raw.subarray(0, 8);
  const reader = new BorshReader(Buffer.from(raw.subarray(8)));

  if (disc.equals(DISC.UniverseCreated)) {
    return {
      kind: 'UniverseCreated',
      universe: reader.readPubkey(),
      creator: reader.readPubkey(),
      contentHashHex: hex(reader.readFixedBytes(32)),
      plotHashHex: hex(reader.readFixedBytes(32)),
      visibility: reader.readVisibilityEnum(),
    };
  }
  if (disc.equals(DISC.UniversePublished)) {
    return { kind: 'UniversePublished', universe: reader.readPubkey() };
  }
  if (disc.equals(DISC.EpisodeMinted)) {
    return {
      kind: 'EpisodeMinted',
      episode: reader.readPubkey(),
      universe: reader.readPubkey(),
      creator: reader.readPubkey(),
      contentHashHex: hex(reader.readFixedBytes(32)),
      title: reader.readString(),
      metadataUri: reader.readString(),
    };
  }
  if (disc.equals(DISC.EpisodeCanonized)) {
    return {
      kind: 'EpisodeCanonized',
      episode: reader.readPubkey(),
      universe: reader.readPubkey(),
    };
  }
  return null;
}

/**
 * Walk a Helius-enhanced tx's instructions + inner-instructions, find calls
 * to LOAR programs, and decode any emitted events. Helius surfaces Anchor
 * `emit!` outputs as inner instructions with `programId == <emitting program>`
 * and `data` = the base58 payload.
 */
export function decodeEventsFromTx(args: {
  instructions: Array<{
    programId: string;
    data?: string;
    innerInstructions?: Array<{ programId?: string; data?: string }>;
  }>;
  knownProgramIds: Set<string>;
}): DecodedEvent[] {
  const events: DecodedEvent[] = [];
  for (const ix of args.instructions) {
    for (const inner of ix.innerInstructions ?? []) {
      if (!inner.data || !inner.programId) continue;
      if (!args.knownProgramIds.has(inner.programId)) continue;
      const event = decodeAnchorEvent(inner.data);
      if (event) events.push(event);
    }
    // Some Helius schemas put emit! data on the outer instruction's `data`
    // when the program self-CPIs — handle that too.
    if (ix.data && args.knownProgramIds.has(ix.programId)) {
      const event = decodeAnchorEvent(ix.data);
      if (event) events.push(event);
    }
  }
  return events;
}
