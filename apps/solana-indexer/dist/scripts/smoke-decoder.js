/**
 * Smoke test for the IDL-driven event decoder.
 *
 * Builds a deterministic UniverseCreated event payload (event discriminator
 * from universe.json IDL + hand-borsh-encoded fields), runs it through
 * `decodeAnchorEvent`, and asserts the typed result.
 *
 * Run: pnpm tsx apps/solana-indexer/scripts/smoke-decoder.ts
 * Exits 0 on success, non-zero on any assertion failure.
 */
import bs58 from 'bs58';
import { decodeAnchorEvent } from '../src/anchor-events';
import { PROGRAM_BY_ID } from '../src/program-registry';
function fail(msg) {
    console.error('FAIL:', msg);
    process.exit(1);
}
function assertEq(actual, expected, label) {
    if (actual !== expected) {
        fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}
const universe = [...PROGRAM_BY_ID.values()].find((p) => p.name === 'universe');
if (!universe)
    fail('universe program not registered');
const UNIVERSE_CREATED_DISC = Buffer.from([244, 82, 63, 148, 26, 10, 53, 67]);
const universePubkeyBytes = Buffer.alloc(32, 0x01);
const creatorPubkeyBytes = Buffer.alloc(32, 0x02);
const contentHashBytes = Buffer.alloc(32, 0xab);
const plotHashBytes = Buffer.alloc(32, 0xcd);
const visibilityByte = Buffer.from([1]); // 1 = Public
const payload = Buffer.concat([
    UNIVERSE_CREATED_DISC,
    universePubkeyBytes,
    creatorPubkeyBytes,
    contentHashBytes,
    plotHashBytes,
    visibilityByte,
]);
const base58 = bs58.encode(payload);
const decoded = decodeAnchorEvent(base58, universe.programId);
if (!decoded)
    fail('decoder returned null');
if (decoded.kind !== 'UniverseCreated')
    fail(`expected kind UniverseCreated, got ${decoded.kind}`);
const expectedUniverse = bs58.encode(universePubkeyBytes);
const expectedCreator = bs58.encode(creatorPubkeyBytes);
assertEq(decoded.universe, expectedUniverse, 'universe pubkey');
assertEq(decoded.creator, expectedCreator, 'creator pubkey');
assertEq(decoded.contentHashHex, '0x' + 'ab'.repeat(32), 'contentHashHex');
assertEq(decoded.plotHashHex, '0x' + 'cd'.repeat(32), 'plotHashHex');
assertEq(decoded.visibility, 'Public', 'visibility');
assertEq(decoded.raw.program, 'universe', 'raw.program');
assertEq(decoded.raw.name, 'UniverseCreated', 'raw.name');
// Visibility = Private path
const privatePayload = Buffer.concat([
    UNIVERSE_CREATED_DISC,
    universePubkeyBytes,
    creatorPubkeyBytes,
    contentHashBytes,
    plotHashBytes,
    Buffer.from([0]), // 0 = Private
]);
const privateDecoded = decodeAnchorEvent(bs58.encode(privatePayload), universe.programId);
if (!privateDecoded || privateDecoded.kind !== 'UniverseCreated')
    fail('private path failed');
assertEq(privateDecoded.visibility, 'Private', 'private visibility');
// Unknown discriminator → null
const garbage = Buffer.concat([Buffer.alloc(8, 0xff), Buffer.alloc(32, 0x00)]);
const garbageDecoded = decodeAnchorEvent(bs58.encode(garbage), universe.programId);
if (garbageDecoded !== null) {
    fail(`expected null for unknown discriminator, got ${JSON.stringify(garbageDecoded)}`);
}
// Unknown program → null
const unknownProgram = decodeAnchorEvent(bs58.encode(payload), '11111111111111111111111111111111');
if (unknownProgram !== null)
    fail('expected null for unknown programId');
// ── rights program: RightsSetViaAttestation auto-decodes via IDL ────────────
//
// Validates that adding a new program to the registry (the rights program in
// Phase S1) makes its events decodable end-to-end with zero per-event code.
const rights = [...PROGRAM_BY_ID.values()].find((p) => p.name === 'rights');
if (!rights)
    fail('rights program not registered');
const RIGHTS_SET_DISC = Buffer.from([177, 96, 2, 212, 74, 47, 87, 133]);
const evmCreator20 = Buffer.alloc(20, 0x99);
const versionLe = Buffer.alloc(8);
versionLe.writeBigUInt64LE(42n);
const blockLe = Buffer.alloc(8);
blockLe.writeBigUInt64LE(1234567890n);
const evmTxHash = Buffer.alloc(32, 0xee);
const rightsPayload = Buffer.concat([
    RIGHTS_SET_DISC,
    Buffer.alloc(32, 0x77), // content_hash
    Buffer.from([2]), // rights_type = Original (index 2: Unset/Fun/Original)
    Buffer.alloc(32, 0x55), // creator pubkey
    evmCreator20,
    versionLe,
    evmTxHash,
    blockLe,
]);
const rightsDecoded = decodeAnchorEvent(bs58.encode(rightsPayload), rights.programId);
if (!rightsDecoded)
    fail('rights decoder returned null');
if (rightsDecoded.kind !== 'Generic') {
    fail(`rights event should be Generic (no typed handler yet), got ${rightsDecoded.kind}`);
}
assertEq(rightsDecoded.raw.program, 'rights', 'rights program');
assertEq(rightsDecoded.raw.name, 'RightsSetViaAttestation', 'rights event name');
assertEq(rightsDecoded.raw.data.contentHash, '0x' + '77'.repeat(32), 'rights contentHash');
assertEq(rightsDecoded.raw.data.rightsType, 'Original', 'rights rightsType enum');
assertEq(rightsDecoded.raw.data.evmCreator, '0x' + '99'.repeat(20), 'rights evmCreator');
assertEq(rightsDecoded.raw.data.version, '42', 'rights version');
assertEq(rightsDecoded.raw.data.evmBlockNumber, '1234567890', 'rights evmBlockNumber');
console.log('OK: decoder smoke passed (UniverseCreated typed + RightsSetViaAttestation generic + unknown-disc + unknown-program)');
//# sourceMappingURL=smoke-decoder.js.map