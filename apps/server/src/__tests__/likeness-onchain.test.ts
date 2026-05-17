/**
 * Tests for the pure helpers in `services/likeness-onchain.ts`.
 *
 * The on-chain submit/read helpers hit a live RPC + KMS, so we leave those
 * to integration smoke tests. Here we lock down the deterministic pieces
 * that drive cross-language compatibility with the Solidity contracts:
 *   - content/split hash derivation must remain stable forever (changing
 *     the hash invalidates every existing on-chain registration)
 *   - EIP-191 digest must match the contract's keccak256(abi.encodePacked(...))
 *     byte-for-byte or setRightsWithCreatorSig reverts InvalidSignature.
 *   - getOnChainEnv must default-deny when env vars are missing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encodePacked, keccak256, type Address, type Hex } from 'viem';
import {
  RightsType,
  computeEntityContentHash,
  computeSplitEntityHash,
  buildRightsAttestationDigest,
  getOnChainEnv,
  defaultOnChainChainId,
  isOnChainAvailable,
} from '../services/likeness-onchain';

describe('computeEntityContentHash', () => {
  it('is deterministic for the same entityId', () => {
    expect(computeEntityContentHash('abc-123')).toBe(computeEntityContentHash('abc-123'));
  });

  it('changes when the entityId changes', () => {
    expect(computeEntityContentHash('abc-123')).not.toBe(computeEntityContentHash('abc-124'));
  });

  it('matches the exact Solidity-equivalent shape (keccak256(packed prefix + id))', () => {
    // If this fails it means the hash scheme drifted from what we registered
    // on-chain — every prior listing would be orphaned. Bump this expected
    // value only with a coordinated `ContentLicensing.updatePricing` migration.
    const expected = keccak256(
      encodePacked(['string', 'string'], ['likeness-marketplace:', 'test-entity-abc'])
    );
    expect(computeEntityContentHash('test-entity-abc')).toBe(expected);
  });

  it('returns a 32-byte hex string', () => {
    const h = computeEntityContentHash('x');
    expect(h).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});

describe('computeSplitEntityHash', () => {
  it('uses a different prefix than the content hash', () => {
    // Same entityId → different hashes. Keeps splits independent of content
    // registrations so creators can rotate splits without touching the
    // ContentLicensing row.
    const id = 'shared-entity-id';
    expect(computeSplitEntityHash(id)).not.toBe(computeEntityContentHash(id));
  });

  it('is deterministic + matches the packed prefix shape', () => {
    const expected = keccak256(
      encodePacked(['string', 'string'], ['likeness-marketplace:split:', 'xyz'])
    );
    expect(computeSplitEntityHash('xyz')).toBe(expected);
  });
});

describe('buildRightsAttestationDigest', () => {
  const baseArgs = {
    rightsRegistry: '0x3A14A746990498d5a4eCe867db10a197f91856Bc' as Address,
    chainId: 11155111,
    contentHash: ('0x' + 'a'.repeat(64)) as Hex,
    rightsType: RightsType.ORIGINAL,
    creatorNonce: 0n,
    deadline: 1_700_000_000n,
  };

  it('matches the exact Solidity inner-hash format', () => {
    // Mirror the contract's `setRightsWithCreatorSig` digest construction:
    //   keccak256(abi.encodePacked(
    //     "LOAR-RIGHTS-V1", address, chainId, contentHash, uint8(rightsType),
    //     creatorNonce, deadline))
    // Drift here causes every signed attestation to revert InvalidSignature.
    const manual = keccak256(
      encodePacked(
        ['string', 'address', 'uint256', 'bytes32', 'uint8', 'uint256', 'uint256'],
        [
          'LOAR-RIGHTS-V1',
          baseArgs.rightsRegistry,
          BigInt(baseArgs.chainId),
          baseArgs.contentHash,
          baseArgs.rightsType,
          baseArgs.creatorNonce,
          baseArgs.deadline,
        ]
      )
    );
    expect(buildRightsAttestationDigest(baseArgs)).toBe(manual);
  });

  it('changes when ANY input changes — nonce bump regenerates the digest', () => {
    const a = buildRightsAttestationDigest(baseArgs);
    const b = buildRightsAttestationDigest({ ...baseArgs, creatorNonce: 1n });
    expect(a).not.toBe(b);
  });

  it('changes when the chain id changes (replay protection)', () => {
    // Critical for cross-chain replay: a signature valid for Sepolia must
    // not authorize anything on Base Sepolia. The deployed RightsRegistry
    // rebuilds the digest with its own block.chainid so any mismatch reverts.
    const sep = buildRightsAttestationDigest({ ...baseArgs, chainId: 11155111 });
    const base = buildRightsAttestationDigest({ ...baseArgs, chainId: 84532 });
    expect(sep).not.toBe(base);
  });

  it('changes when the rightsRegistry address changes (replay protection)', () => {
    // Same content hash + same chain id but different registry address must
    // produce a different digest — prevents replay if two registries are
    // ever deployed to the same chain.
    const a = buildRightsAttestationDigest(baseArgs);
    const b = buildRightsAttestationDigest({
      ...baseArgs,
      rightsRegistry: '0x982c153e41b8B78ca48D7A13e6766Ce85F039558' as Address,
    });
    expect(a).not.toBe(b);
  });
});

describe('getOnChainEnv', () => {
  // Snapshot env so tests don't bleed into each other.
  const snapshot: Record<string, string | undefined> = {};
  const KEYS = [
    'CONTENT_LICENSING_ADDRESS_SEPOLIA',
    'RIGHTS_REGISTRY_ADDRESS_SEPOLIA',
    'CONTENT_LICENSING_ADDRESS_BASE_SEPOLIA',
    'RIGHTS_REGISTRY_ADDRESS_BASE_SEPOLIA',
    'RPC_URL',
    'RPC_URL_BASE_SEPOLIA',
    'PONDER_RPC_URL_2',
  ];
  beforeEach(() => {
    for (const k of KEYS) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it('returns null when no env vars are set (default-deny)', () => {
    expect(getOnChainEnv(11155111)).toBeNull();
    expect(getOnChainEnv(84532)).toBeNull();
    expect(isOnChainAvailable()).toBe(false);
    expect(defaultOnChainChainId()).toBeNull();
  });

  it('returns null for an unsupported chain id', () => {
    expect(getOnChainEnv(1)).toBeNull(); // mainnet
    expect(getOnChainEnv(0)).toBeNull();
  });

  it('returns the env when all three sepolia vars are set', () => {
    process.env.CONTENT_LICENSING_ADDRESS_SEPOLIA = '0x' + 'a'.repeat(40);
    process.env.RIGHTS_REGISTRY_ADDRESS_SEPOLIA = '0x' + 'b'.repeat(40);
    process.env.RPC_URL = 'https://example/sepolia';
    const env = getOnChainEnv(11155111);
    expect(env).not.toBeNull();
    expect(env?.chainId).toBe(11155111);
    expect(env?.chainLabel).toBe('Sepolia');
    expect(env?.contentLicensing.toLowerCase()).toBe('0x' + 'a'.repeat(40));
  });

  it('falls back to PONDER_RPC_URL_2 when RPC_URL is absent (legacy var)', () => {
    process.env.CONTENT_LICENSING_ADDRESS_SEPOLIA = '0x' + 'a'.repeat(40);
    process.env.RIGHTS_REGISTRY_ADDRESS_SEPOLIA = '0x' + 'b'.repeat(40);
    process.env.PONDER_RPC_URL_2 = 'https://example/legacy';
    const env = getOnChainEnv(11155111);
    expect(env?.rpcUrl).toBe('https://example/legacy');
  });

  it('still returns null if any single var is missing', () => {
    process.env.CONTENT_LICENSING_ADDRESS_SEPOLIA = '0x' + 'a'.repeat(40);
    // intentionally missing RIGHTS_REGISTRY_ADDRESS_SEPOLIA
    process.env.RPC_URL = 'https://example';
    expect(getOnChainEnv(11155111)).toBeNull();
  });

  it('defaultOnChainChainId prefers Sepolia when both chains configured', () => {
    process.env.CONTENT_LICENSING_ADDRESS_SEPOLIA = '0x' + 'a'.repeat(40);
    process.env.RIGHTS_REGISTRY_ADDRESS_SEPOLIA = '0x' + 'b'.repeat(40);
    process.env.RPC_URL = 'https://example/sepolia';
    process.env.CONTENT_LICENSING_ADDRESS_BASE_SEPOLIA = '0x' + 'c'.repeat(40);
    process.env.RIGHTS_REGISTRY_ADDRESS_BASE_SEPOLIA = '0x' + 'd'.repeat(40);
    process.env.RPC_URL_BASE_SEPOLIA = 'https://example/base';
    expect(defaultOnChainChainId()).toBe(11155111);
  });

  it('falls back to Base Sepolia when only Base is configured', () => {
    process.env.CONTENT_LICENSING_ADDRESS_BASE_SEPOLIA = '0x' + 'c'.repeat(40);
    process.env.RIGHTS_REGISTRY_ADDRESS_BASE_SEPOLIA = '0x' + 'd'.repeat(40);
    process.env.RPC_URL_BASE_SEPOLIA = 'https://example/base';
    expect(defaultOnChainChainId()).toBe(84532);
  });
});

describe('RightsType enum', () => {
  it('mirrors the IRightsRegistry.sol enum order — DO NOT REORDER', () => {
    // If this drifts, every cross-chain attestation digest is invalid and
    // every isMonetizable check reads the wrong slot. Bump only with a
    // coordinated contract upgrade.
    expect(RightsType.UNSET).toBe(0);
    expect(RightsType.FUN).toBe(1);
    expect(RightsType.ORIGINAL).toBe(2);
    expect(RightsType.LICENSED).toBe(3);
    expect(RightsType.PUBLIC_DOMAIN).toBe(4);
    expect(RightsType.FROZEN).toBe(5);
  });
});
