/**
 * Anchor event decoder — IDL-driven via `@coral-xyz/anchor`'s `BorshEventCoder`.
 *
 * Anchor's `emit!` macro writes events as a self-CPI inner instruction whose
 * `data` is the base58 of (8-byte event discriminator + borsh payload).
 * Helius surfaces these under `instructions[*].innerInstructions[*]` with
 * `programId == <emitting program>`.
 *
 * Layered design:
 *   - `decodeAnchorEvent(data, programId)` returns an `AnchorEvent` for any
 *     registered LOAR program's event — no per-event hand-coding required.
 *     New programs become decodable the moment their IDL is added to
 *     `program-registry.ts`.
 *   - `liftTyped(event)` lifts the four events the indexer has dedicated
 *     side-effects for (Universe* / Episode*) into the typed `DecodedEvent`
 *     union the rest of the indexer consumes. Everything else falls through
 *     as `kind: 'Generic'` so it still lands in `solanaEvents` — future
 *     ported programs auto-index without touching this file.
 */
import bs58 from 'bs58';
import { KNOWN_PROGRAM_IDS, PROGRAM_BY_ID, type RegisteredProgram } from './program-registry';

// ── Generic + typed surfaces ────────────────────────────────────────────────

/** Normalized event payload: PublicKey → bs58, [u8;N] → 0x hex, BN → string. */
export interface AnchorEvent {
  program: string;
  programId: string;
  name: string;
  data: Record<string, unknown>;
}

export type DecodedEvent =
  | {
      kind: 'UniverseCreated';
      universe: string;
      creator: string;
      contentHashHex: string;
      plotHashHex: string;
      visibility: 'Private' | 'Public';
      raw: AnchorEvent;
    }
  | { kind: 'UniversePublished'; universe: string; raw: AnchorEvent }
  | {
      kind: 'EpisodeMinted';
      episode: string;
      universe: string;
      creator: string;
      contentHashHex: string;
      title: string;
      metadataUri: string;
      raw: AnchorEvent;
    }
  | { kind: 'EpisodeCanonized'; episode: string; universe: string; raw: AnchorEvent }
  | { kind: 'Generic'; raw: AnchorEvent };

// ── Field normalization ─────────────────────────────────────────────────────
//
// BorshEventCoder yields Anchor's runtime types: PublicKey, BN, Buffer for
// fixed byte arrays, and `{ Variant: {} }` for enums. We flatten everything to
// JSON-safe primitives so Firestore stores stable values and downstream
// consumers don't need anchor types.

function hasFn(v: unknown, name: string): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)[name] === 'function'
  );
}

function isPublicKeyLike(v: unknown): boolean {
  return hasFn(v, 'toBase58');
}

function isBnLike(v: unknown): boolean {
  // BN.js instances carry .toArray, .bitLength, .toString — duck-type without
  // a direct bn.js import (it's a transitive anchor dep, not direct).
  return hasFn(v, 'toArray') && hasFn(v, 'bitLength') && hasFn(v, 'toString');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Uint8Array) &&
    !Buffer.isBuffer(v) &&
    !isPublicKeyLike(v) &&
    !isBnLike(v)
  );
}

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (isPublicKeyLike(v)) return (v as { toBase58: () => string }).toBase58();
  if (isBnLike(v)) return (v as { toString: (r: number) => string }).toString(10);
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
    return '0x' + Buffer.from(v as Uint8Array).toString('hex');
  }
  if (Array.isArray(v)) {
    // u8 arrays come through as plain number[] from borsh — pack into hex for
    // hash-like fixed-size arrays (length 32) so they match EVM bytes32 shape.
    if (v.length > 0 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 255)) {
      return '0x' + Buffer.from(v as number[]).toString('hex');
    }
    return v.map(normalizeValue);
  }
  if (isPlainObject(v)) {
    // Anchor enum: `{ Private: {} }` — collapse to the variant name.
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const inner = v[keys[0]];
      if (isPlainObject(inner) && Object.keys(inner).length === 0) {
        return keys[0];
      }
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[snakeToCamel(k)] = normalizeValue(v[k]);
    return out;
  }
  return v;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function normalizeFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[snakeToCamel(k)] = normalizeValue(v);
  }
  return out;
}

// ── Decode ──────────────────────────────────────────────────────────────────

/**
 * Decode a single Anchor event from its raw base58 program-log data.
 *
 * Returns null if:
 *   - `programId` isn't a registered LOAR program
 *   - data isn't valid base58
 *   - the discriminator doesn't match any event in the program's IDL
 *     (other programs' events that happened to slip past the routing filter)
 */
export function decodeAnchorEvent(dataBase58: string, programId: string): DecodedEvent | null {
  const program: RegisteredProgram | undefined = PROGRAM_BY_ID.get(programId);
  if (!program) return null;

  let raw: Buffer;
  try {
    raw = Buffer.from(bs58.decode(dataBase58));
  } catch {
    return null;
  }
  if (raw.length < 8) return null;

  // BorshEventCoder.decode takes base64. We arrive with base58 because that's
  // how Helius serializes the self-CPI inner-instruction data field.
  const base64 = raw.toString('base64');
  let decoded: { name: string; data: Record<string, unknown> } | null = null;
  try {
    decoded = program.events.decode(base64) as {
      name: string;
      data: Record<string, unknown>;
    } | null;
  } catch {
    // Malformed payload — could be a non-event inner-CPI from this program.
    // Silently ignore at this layer.
    return null;
  }
  if (!decoded) return null;

  const evt: AnchorEvent = {
    program: program.name,
    programId,
    name: decoded.name,
    data: normalizeFields(decoded.data),
  };
  return liftTyped(evt);
}

/**
 * Map (program, event-name) → typed `DecodedEvent` variant for the events the
 * indexer has dedicated side-effects for. Everything else returns as
 * `kind: 'Generic'`.
 */
function liftTyped(evt: AnchorEvent): DecodedEvent {
  const d = evt.data;
  if (evt.program === 'universe' && evt.name === 'UniverseCreated') {
    return {
      kind: 'UniverseCreated',
      universe: d.universe as string,
      creator: d.creator as string,
      contentHashHex: d.contentHash as string,
      plotHashHex: d.plotHash as string,
      visibility: d.visibility as 'Private' | 'Public',
      raw: evt,
    };
  }
  if (evt.program === 'universe' && evt.name === 'UniversePublished') {
    return { kind: 'UniversePublished', universe: d.universe as string, raw: evt };
  }
  if (evt.program === 'episode' && evt.name === 'EpisodeMinted') {
    return {
      kind: 'EpisodeMinted',
      episode: d.episode as string,
      universe: d.universe as string,
      creator: d.creator as string,
      contentHashHex: d.contentHash as string,
      title: d.title as string,
      metadataUri: d.metadataUri as string,
      raw: evt,
    };
  }
  if (evt.program === 'episode' && evt.name === 'EpisodeCanonized') {
    return {
      kind: 'EpisodeCanonized',
      episode: d.episode as string,
      universe: d.universe as string,
      raw: evt,
    };
  }
  return { kind: 'Generic', raw: evt };
}

// ── Tx-walker ───────────────────────────────────────────────────────────────

/**
 * Walk a Helius-enhanced tx's instructions + inner-instructions, find calls to
 * any registered LOAR program, and decode emitted events.
 *
 * When `knownProgramIds` is omitted, falls back to the registry's full set —
 * caller can pass a narrowed set (e.g. env-gated) to restrict routing.
 */
export function decodeEventsFromTx(args: {
  instructions: Array<{
    programId: string;
    data?: string;
    innerInstructions?: Array<{ programId?: string; data?: string }>;
  }>;
  knownProgramIds?: ReadonlySet<string>;
}): DecodedEvent[] {
  const known = args.knownProgramIds ?? KNOWN_PROGRAM_IDS;
  const events: DecodedEvent[] = [];

  for (const ix of args.instructions) {
    for (const inner of ix.innerInstructions ?? []) {
      if (!inner.data || !inner.programId) continue;
      if (!known.has(inner.programId)) continue;
      const event = decodeAnchorEvent(inner.data, inner.programId);
      if (event) events.push(event);
    }
    // Some Helius schemas surface the emit! data on the outer instruction's
    // `data` field when the program self-CPIs.
    if (ix.data && known.has(ix.programId)) {
      const event = decodeAnchorEvent(ix.data, ix.programId);
      if (event) events.push(event);
    }
  }
  return events;
}
