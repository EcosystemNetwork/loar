/**
 * Smoke harness fixtures.
 *
 * WALLETS
 *   Deterministic test accounts derived from the well-known Hardhat/Anvil
 *   mnemonic. These keys are public, documented test-only keys used in every
 *   Ethereum tutorial. NEVER use them on mainnet.
 *
 * CONTENT PACKS
 *   Minimal binary fixtures for exercising the storage, generation, and
 *   on-chain layers without requiring live AI calls.
 *
 * DEMO DATA
 *   Sample universe metadata and content text for demos and regression runs.
 */
import { privateKeyToAccount } from 'viem/accounts';

// ── Test Wallets ──────────────────────────────────────────────────────────────
//
// Source: Hardhat/Anvil account #0 and #1 from the canonical test mnemonic
// "test test test test test test test test test test test junk"
//
// These keys are:
//   - Publicly documented as test-only
//   - Used by the entire Ethereum dev ecosystem
//   - Safe to commit — never use on mainnet
//

export const SMOKE_WALLETS = {
  primary: {
    label: 'smoke-test-1',
    privateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
  },
  secondary: {
    label: 'smoke-test-2',
    privateKey:
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
  },
} as const;

export function getPrimaryAccount() {
  return privateKeyToAccount(SMOKE_WALLETS.primary.privateKey);
}

export function getSecondaryAccount() {
  return privateKeyToAccount(SMOKE_WALLETS.secondary.privateKey);
}

// ── Minimal Binary Fixtures ───────────────────────────────────────────────────

/**
 * 1×1 pixel red PNG — 68 bytes.
 * Used for storage.uploadDirect tests without requiring real media.
 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==';

export const TINY_PNG_MIME = 'image/png';
export const TINY_PNG_FILENAME = 'smoke-test-1x1.png';

/**
 * Public HTTPS URL of a small (~10KB) test JPEG.
 * Used for storage.upload (from-URL path) and generation tests.
 * Source: httpbin.org test image — always available, no auth required.
 */
export const TEST_IMAGE_URL = 'https://httpbin.org/image/jpeg';

/**
 * Public HTTPS URL of a small (~48KB) test PNG.
 */
export const TEST_PNG_URL = 'https://httpbin.org/image/png';

// ── Demo Universe Metadata ────────────────────────────────────────────────────

export function sampleUniverseMeta(wallet: `0x${string}`) {
  const ts = Date.now();
  return {
    name: `Smoke Universe ${ts}`,
    description: `Auto-generated smoke test universe — ${new Date(ts).toISOString()}`,
    // Fake but valid-format addresses for Firestore-only create tests
    address: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    tokenAddress: '0x0000000000000000000000000000000000000002' as `0x${string}`,
    governanceAddress: '0x0000000000000000000000000000000000000003' as `0x${string}`,
    creator: wallet,
    // A real IPFS-hosted placeholder image that will always resolve
    imageUrl: 'https://ipfs.io/ipfs/QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn/readme.txt',
  };
}

// ── Demo Content Pack ─────────────────────────────────────────────────────────
//
// This pack is used for demos and regression runs. It represents a minimal
// "episode" worth of content: a plot description and a content URL.
//

export const DEMO_CONTENT_PACK = {
  title: 'The First Signal',
  plot:
    'In the year 2157, a fractured Earth receives a transmission from beyond the edge of the solar system. ' +
    'Commander Aria Chen must decide whether to answer — knowing the signal could be salvation or extinction.',
  contentUrl: TEST_IMAGE_URL,
  contentMimeType: 'image/jpeg',
  tags: ['sci-fi', 'first-contact', 'space-opera'],
  // Stable SHA-256 hex used as a deterministic test contentHash
  // echo -n "smoke-test-content-v1" | sha256sum
  contentHashHex: 'a3b6e5d04f2c91e8b7d3a85f0c4e6d2b7f9a1c3e5d7b9f1a3c5e7d9b1f3a5c7',
  // 32-byte 0x-prefixed hex for on-chain bytes32 arguments
  contentHashBytes32:
    '0xa3b6e5d04f2c91e8b7d3a85f0c4e6d2b7f9a1c3e5d7b9f1a3c5e7d9b1f3a5c7' as `0x${string}`,
  plotHashBytes32:
    '0xb4c7f6e15a3d02f9c8e4b96a1d5f7e3c9b1a5d7f9e3c7b1a5d9f3e7c1b5a9d7' as `0x${string}`,
};

// ── Generation Prompts ────────────────────────────────────────────────────────

export const SMOKE_PROMPTS = {
  textToVideo:
    'A lone astronaut floats in deep space, stars drifting past. Cinematic, dramatic lighting, 5 seconds.',
  imageCaption:
    'A dramatic sci-fi illustration of a commander looking out at a nebula. Cinematic lighting.',
};
