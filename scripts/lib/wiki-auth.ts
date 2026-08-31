/**
 * Chain-agnostic SIWx auth for populate / wiki scripts.
 *
 * Signs in against the LOAR server with either an EVM key (SIWE →
 * POST /auth/verify) or a Solana key (SIWS → POST /auth/solana/verify) and
 * returns a session JWT usable as `Authorization: Bearer <token>` on every
 * tRPC call.
 *
 * The chain is auto-detected from the key shape, or forced with
 * `chain: 'evm' | 'solana'` (scripts wire this to --chain / AUTH_CHAIN).
 *
 *   EVM key    — 32-byte hex, optional 0x prefix (64 hex chars).
 *   Solana key — base58 of the 64-byte secret (Phantom/Solflare export),
 *                a JSON array of 64 ints (solana-keygen), or 128/64 hex.
 *
 * ── Authorization caveat ────────────────────────────────────────────────
 * Signing in is not the same as being allowed to write. Wiki mutations
 * (entities.update, universes.updateMetadata, wiki.generateFromVideo, …)
 * check that the caller is the *creator* of the universe / entity. A
 * Solana-primary session (sub = base58 pubkey) can only edit content
 * created by that same pubkey — unless the wallet was previously linked to
 * an EVM identity via POST /auth/solana/link, in which case SIWS issues an
 * EVM-primary JWT and `evmAddress` on the result is populated. An EVM key
 * can only edit EVM-owned content, and vice-versa.
 */
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export type AuthChain = 'evm' | 'solana';
export type SolanaCluster = 'devnet' | 'mainnet-beta' | 'testnet';

/** First 32 base58 chars of each cluster's genesis hash (mirrors @loar/abis/chain). */
const SOLANA_GENESIS_HASH: Record<SolanaCluster, string> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc7UMKUbpZF',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

export interface AuthOptions {
  /** tRPC / auth base, no trailing slash (e.g. https://api.loar.fun). */
  serverUrl: string;
  /** Web origin used for the SIWx domain + Origin header, no trailing slash. */
  webOrigin: string;
  /** Raw private key from env — EVM hex or Solana base58/json/hex. */
  privateKey: string;
  /** Force a chain instead of auto-detecting from the key shape. */
  chain?: AuthChain;
  /** SIWE chain id. Default 11155111 (Sepolia). */
  evmChainId?: number;
  /** SIWS cluster. Default 'mainnet-beta'. */
  solanaCluster?: SolanaCluster;
}

export interface AuthResult {
  /** Session JWT — send as `Authorization: Bearer <token>`. */
  token: string;
  /** Which chain actually authenticated. */
  chain: AuthChain;
  /** The signing address: EVM checksum 0x… or Solana base58. */
  address: string;
  /**
   * For a Solana sign-in that resolved to a linked EVM identity, the EVM
   * address the JWT is actually keyed to. null otherwise.
   */
  evmAddress: string | null;
}

// ── key-shape detection ───────────────────────────────────────────────
function stripHex(k: string): string {
  return k.startsWith('0x') || k.startsWith('0X') ? k.slice(2) : k;
}

/** Auto-detect the chain from the private-key shape. */
export function detectAuthChain(rawKey: string): AuthChain {
  const k = rawKey.trim();
  if (k.startsWith('[')) return 'solana'; // solana-keygen json array
  const hex = stripHex(k);
  if (/^[0-9a-fA-F]+$/.test(hex)) {
    // 64 hex = 32 bytes = EVM key. 128 hex = 64 bytes = Solana secret.
    if (hex.length === 64) return 'evm';
    if (hex.length === 128) return 'solana';
  }
  // Anything else that base58-decodes to 32/64 bytes is Solana.
  return 'solana';
}

// ── shared HTTP helpers ───────────────────────────────────────────────
async function fetchNonce(serverUrl: string): Promise<string> {
  const res = await fetch(`${serverUrl}/auth/nonce`);
  if (!res.ok) throw new Error(`GET /auth/nonce failed (${res.status})`);
  const { nonce } = (await res.json()) as { nonce: string };
  if (!nonce) throw new Error('GET /auth/nonce returned no nonce');
  return nonce;
}

async function postVerify(
  url: string,
  webOrigin: string,
  payload: { message: string; signature: string }
): Promise<{ token: string; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: webOrigin,
      // Ask the server to echo the JWT in the body too (mobile clients have
      // no cookie jar). We still fall back to the Set-Cookie header.
      'x-mobile-client': '1',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `${new URL(url).pathname} failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`
    );
  }
  const setCookie = res.headers.get('set-cookie') ?? '';
  const cookieToken = setCookie.match(/siwe-session=([^;]+)/)?.[1];
  const token = cookieToken ?? (typeof body?.token === 'string' ? body.token : undefined);
  if (!token) {
    throw new Error(
      `${new URL(url).pathname} did not return a session token (no Set-Cookie, no body.token)`
    );
  }
  return { token, body };
}

// ── EVM (SIWE) ────────────────────────────────────────────────────────
async function authEvm(opts: AuthOptions): Promise<AuthResult> {
  const raw = opts.privateKey.trim();
  const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const nonce = await fetchNonce(opts.serverUrl);
  const domain = new URL(opts.webOrigin).host;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const message = [
    `${domain} wants you to sign in with your Ethereum account:`,
    getAddress(account.address),
    '',
    'Sign in to LOAR',
    '',
    `URI: ${opts.webOrigin}`,
    `Version: 1`,
    `Chain ID: ${opts.evmChainId ?? 11155111}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  const { token } = await postVerify(`${opts.serverUrl}/auth/verify`, opts.webOrigin, {
    message,
    signature,
  });
  return { token, chain: 'evm', address: account.address, evmAddress: account.address };
}

// ── Solana (SIWS) ─────────────────────────────────────────────────────
function loadSolanaKeypair(raw: string): Keypair {
  const s = raw.trim();
  if (s.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]));
  }
  const hex = stripHex(s);
  if (/^[0-9a-fA-F]+$/.test(hex) && (hex.length === 128 || hex.length === 64)) {
    const bytes = Buffer.from(hex, 'hex');
    return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes);
  }
  const bytes = bs58.decode(s);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(
    `Unrecognized Solana secret key (decoded to ${bytes.length} bytes; expected 32 or 64)`
  );
}

async function authSolana(opts: AuthOptions): Promise<AuthResult> {
  const kp = loadSolanaKeypair(opts.privateKey);
  const address = kp.publicKey.toBase58();
  const cluster = opts.solanaCluster ?? 'mainnet-beta';
  const nonce = await fetchNonce(opts.serverUrl);
  // Server matches the message domain against SIWE_ALLOWED_DOMAINS and the
  // Origin header host; `host` (with :port for localhost) satisfies both.
  const domain = new URL(opts.webOrigin).host;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  const message = [
    `${domain} wants you to sign in with your Solana account:`,
    address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${opts.webOrigin}`,
    `Version: 1`,
    `Chain ID: solana:${SOLANA_GENESIS_HASH[cluster].slice(0, 32)}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  const signature = bs58.encode(sig);
  const { token, body } = await postVerify(`${opts.serverUrl}/auth/solana/verify`, opts.webOrigin, {
    message,
    signature,
  });
  const evmAddress =
    typeof body?.evmAddress === 'string' && body.evmAddress ? body.evmAddress : null;
  return { token, chain: 'solana', address, evmAddress };
}

/**
 * Sign in with whichever chain matches the key (or `opts.chain` if forced)
 * and return a session token + resolved identity.
 */
export async function resolveAuth(opts: AuthOptions): Promise<AuthResult> {
  if (!opts.privateKey?.trim()) {
    throw new Error('resolveAuth: privateKey is empty');
  }
  const chain = opts.chain ?? detectAuthChain(opts.privateKey);
  return chain === 'evm' ? authEvm(opts) : authSolana(opts);
}
