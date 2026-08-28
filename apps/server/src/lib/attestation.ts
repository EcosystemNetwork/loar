/**
 * Cross-chain attestation — Ed25519-signed receipts linking a Solana cNFT to
 * its EVM-side LOAR universe + content hash.
 *
 * Most multi-chain demos hand-wave the "this cNFT corresponds to that EVM
 * Universe" claim. We make it cryptographic: the server holds an Ed25519
 * keypair (loaded from ATTESTATION_PRIVATE_KEY env var, or generated +
 * persisted on first boot for dev). For every cNFT mint we publish a JSON
 * receipt containing:
 *   - chainNamespace: 'solana' | 'eip155'
 *   - solana: { cnftAssetId, episodePda, mintTxSignature, cluster }
 *   - evm:    { universeAddress, chainId, contentHashHex }
 *   - mintedAt (ISO timestamp)
 *   - signer  (base58 pubkey of the LOAR attestation key)
 *   - sig     (base58 Ed25519 signature over the canonical JSON of the rest)
 *
 * Verification: anyone can fetch the public key via GET /api/solana/attestation/key
 * and verify a receipt against it offline. The key is rotation-friendly via
 * ATTESTATION_PRIVATE_KEY_PREVIOUS (same pattern as SIWE_JWT_SECRET rotation).
 */
import { createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync } from 'node:crypto';
import bs58 from 'bs58';
import { db, firebaseAvailable } from './firebase';

/** SPKI DER prefix for raw 32-byte ed25519 pubkeys. RFC 8410. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** PKCS8 prefix for raw 32-byte ed25519 secret keys. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

interface AttestationKey {
  /** 32-byte raw private key (base58-encoded as stored). */
  privKeyB58: string;
  /** 32-byte raw public key (base58). */
  pubKeyB58: string;
}

let _key: AttestationKey | null = null;
let _previousPubKeys: string[] | null = null;

function loadKeyFromEnvVar(envVarName: string): AttestationKey | null {
  const raw = process.env[envVarName];
  if (!raw) return null;
  try {
    const privBytes = bs58.decode(raw);
    if (privBytes.length !== 32) {
      throw new Error(`${envVarName} must decode to 32 bytes (got ${privBytes.length})`);
    }
    const privKey = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(privBytes)]),
      format: 'der',
      type: 'pkcs8',
    });
    const pubDer = createPublicKey(privKey).export({ format: 'der', type: 'spki' });
    const pubBytes = (pubDer as Buffer).subarray(12);
    return {
      privKeyB58: bs58.encode(privBytes),
      pubKeyB58: bs58.encode(pubBytes),
    };
  } catch (err) {
    console.warn(
      `[attestation] ${envVarName} is set but invalid — ignoring:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function loadKeyFromEnv(): AttestationKey | null {
  return loadKeyFromEnvVar('ATTESTATION_PRIVATE_KEY');
}

/**
 * Generate a fresh ed25519 keypair and persist its base58 form. In production
 * the key should come from env (typically rotated via secrets manager); this
 * fallback exists so local dev + the Frontier demo work without setup.
 */
function generateAndPersist(): AttestationKey {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  const privBytes = privDer.subarray(16); // strip PKCS8 prefix → 32 bytes
  const pubDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
  const pubBytes = pubDer.subarray(12);

  const key: AttestationKey = {
    privKeyB58: bs58.encode(privBytes),
    pubKeyB58: bs58.encode(pubBytes),
  };

  // Best-effort persist so subsequent restarts produce verifiable receipts
  // for the same signer. Production should set ATTESTATION_PRIVATE_KEY.
  if (firebaseAvailable) {
    void db.collection('serverKeys').doc('attestation').set({
      pubKeyB58: key.pubKeyB58,
      privKeyB58: key.privKeyB58,
      generatedAt: new Date(),
    });
    console.warn(
      `[attestation] generated fresh ed25519 key (signer=${key.pubKeyB58.slice(0, 8)}…). ` +
        'For production, set ATTESTATION_PRIVATE_KEY env var.'
    );
  }

  return key;
}

async function loadKeyFromFirestore(): Promise<AttestationKey | null> {
  if (!firebaseAvailable) return null;
  const doc = await db.collection('serverKeys').doc('attestation').get();
  if (!doc.exists) return null;
  const data = doc.data() as { privKeyB58?: string; pubKeyB58?: string };
  if (!data.privKeyB58 || !data.pubKeyB58) return null;
  return { privKeyB58: data.privKeyB58, pubKeyB58: data.pubKeyB58 };
}

async function getKey(): Promise<AttestationKey> {
  if (_key) return _key;
  const envKey = loadKeyFromEnv();
  if (envKey) {
    _key = envKey;
    return envKey;
  }
  const stored = await loadKeyFromFirestore();
  if (stored) {
    _key = stored;
    return stored;
  }
  _key = generateAndPersist();
  return _key;
}

export async function getAttestationPublicKey(): Promise<string> {
  return (await getKey()).pubKeyB58;
}

/**
 * All currently-trusted attestation signer pubkeys, in order of preference:
 *   1. Active signer (env or generated).
 *   2. ATTESTATION_PRIVATE_KEY_PREVIOUS — the prior signer during rotation.
 *
 * External verifiers use this list to validate receipts emitted before a
 * rotation. Rotation procedure:
 *
 *   1. ATTESTATION_PRIVATE_KEY_PREVIOUS = <current ATTESTATION_PRIVATE_KEY>
 *   2. ATTESTATION_PRIVATE_KEY          = <new from `openssl rand 32 | base58`>
 *   3. Deploy.
 *   4. After 90 days, drop ATTESTATION_PRIVATE_KEY_PREVIOUS — receipts
 *      older than that age out of the bridgeIntents TTL window anyway.
 */
export async function getTrustedAttestationKeys(): Promise<{
  active: string;
  previous: string[];
}> {
  const active = (await getKey()).pubKeyB58;
  if (_previousPubKeys === null) {
    const prev = loadKeyFromEnvVar('ATTESTATION_PRIVATE_KEY_PREVIOUS');
    _previousPubKeys = prev ? [prev.pubKeyB58] : [];
  }
  return { active, previous: _previousPubKeys };
}

// ── Receipt payload ─────────────────────────────────────────────────────────

export interface AttestationPayload {
  schema: 'loar-cnft-cross-chain-v1';
  mintedAt: string; // ISO 8601
  solana: {
    cluster: string;
    cnftAssetId?: string;
    episodePda: string;
    mintTxSignature: string;
  };
  evm?: {
    chainId: number;
    universeAddress: string;
    contentHashHex: string;
  };
  lineage?: {
    entityId?: string;
    contentId?: string;
    extractionId?: string;
    sceneIndex?: number;
  };
}

export interface SignedAttestation extends AttestationPayload {
  signer: string; // base58 ed25519 pubkey
  sig: string; // base58 ed25519 signature over canonicalJSON(payload-without-sig)
}

/**
 * Canonicalize an object for stable signing — keys sorted, no whitespace, no
 * undefined values. JSON.stringify with sorted keys is fine for our shape
 * (no nested arrays where order matters semantically; cluster/string/numeric
 * values only).
 */
function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>)
    .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
    .sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

/**
 * Sign a payload, returning the full receipt. Pure — no network or DB calls
 * besides the one-time key load.
 */
export async function signAttestation(payload: AttestationPayload): Promise<SignedAttestation> {
  const key = await getKey();
  const privKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(bs58.decode(key.privKeyB58))]),
    format: 'der',
    type: 'pkcs8',
  });
  const message = Buffer.from(canonicalJson(payload), 'utf8');
  const sigBuf = sign(null, message, privKey);
  return {
    ...payload,
    signer: key.pubKeyB58,
    sig: bs58.encode(sigBuf),
  };
}

/**
 * Verify a receipt against a known signer pubkey. Returns true iff the
 * signature is valid AND the signer matches. External integrators should
 * fetch the canonical signer via GET /api/solana/attestation/key.
 */
export function verifyAttestation(receipt: SignedAttestation): boolean {
  try {
    const { sig, signer, ...payload } = receipt;
    const pubKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(bs58.decode(signer))]),
      format: 'der',
      type: 'spki',
    });
    const message = Buffer.from(canonicalJson(payload), 'utf8');
    return verify(null, message, pubKey, Buffer.from(bs58.decode(sig)));
  } catch {
    return false;
  }
}
