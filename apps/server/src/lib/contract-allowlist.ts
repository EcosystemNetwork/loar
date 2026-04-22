/**
 * Contract Allowlist for /api/tx/write
 *
 * The server's Circle wallets are a signing oracle — without an allowlist, any
 * authenticated user can ask the server to sign calls to arbitrary contracts
 * (e.g. ERC20 `approve` to an attacker-controlled spender, draining funds).
 *
 * Two sources of truth:
 *  1. Static: every deployed LOAR contract in `packages/abis/src/addresses.ts`.
 *  2. Dynamic: per-universe token contracts tracked in Firestore's `universes`
 *     collection (deployed on-demand via UniverseFactory).
 *
 * An admin override (`CONTRACT_ALLOWLIST_EXTRA`) is supported for
 * testnet-only ad-hoc contracts.
 */
import * as addresses from '@loar/abis/addresses';
import { db, firebaseAvailable } from './firebase';

const LOWER = (a: string) => a.toLowerCase();

// ── Static allowlist ────────────────────────────────────────────────────────
// Shape: Map<chainId(number), Set<addressLowercase>>
const staticAllow = new Map<number, Set<string>>();

function registerStatic(chainId: number, addr: string) {
  if (!addr) return;
  let set = staticAllow.get(chainId);
  if (!set) {
    set = new Set();
    staticAllow.set(chainId, set);
  }
  set.add(LOWER(addr));
}

// Every export from `@loar/abis/addresses` is `{ [chainId: string]: address }`.
// Iterate through them all to build the chain→address multimap without having
// to enumerate contract names by hand.
for (const value of Object.values(addresses as Record<string, unknown>)) {
  if (!value || typeof value !== 'object') continue;
  for (const [chainIdStr, addr] of Object.entries(value as Record<string, string>)) {
    const chainId = Number(chainIdStr);
    if (!Number.isFinite(chainId)) continue;
    if (typeof addr !== 'string' || !addr.startsWith('0x')) continue;
    registerStatic(chainId, addr);
  }
}

// Load admin-provided extras from env (comma-separated "chainId:0xaddr").
if (process.env.CONTRACT_ALLOWLIST_EXTRA) {
  for (const entry of process.env.CONTRACT_ALLOWLIST_EXTRA.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [chainStr, addr] = trimmed.split(':');
    const chainId = Number(chainStr);
    if (Number.isFinite(chainId) && addr?.startsWith('0x')) {
      registerStatic(chainId, addr);
    }
  }
}

// ── Dynamic allowlist (per-universe tokens) ─────────────────────────────────
// LRU-ish cache so we don't hit Firestore on every tx.
const DYNAMIC_TTL_MS = 60_000;
const dynamicCache = new Map<string, { allowed: boolean; expiresAt: number }>();

function cacheKey(chainId: number, address: string) {
  return `${chainId}:${LOWER(address)}`;
}

async function lookupDynamic(chainId: number, address: string): Promise<boolean> {
  if (!firebaseAvailable) return false;

  const key = cacheKey(chainId, address);
  const cached = dynamicCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed;
  }

  const lowered = LOWER(address);
  // Universe tokens are recorded with `tokenAddress: lowercase`. The Firestore
  // collection is `cinematicUniverses` (the legacy name was kept for data
  // continuity) — querying `universes` always returns empty, breaking the
  // dynamic per-universe allowlist branch.
  const snap = await db
    .collection('cinematicUniverses')
    .where('tokenAddress', '==', lowered)
    .limit(1)
    .get();

  const allowed = !snap.empty;
  dynamicCache.set(key, { allowed, expiresAt: Date.now() + DYNAMIC_TTL_MS });
  return allowed;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function isContractAllowed(chainId: number, address: string): Promise<boolean> {
  if (!address?.startsWith('0x')) return false;
  const lowered = LOWER(address);

  const set = staticAllow.get(chainId);
  if (set?.has(lowered)) return true;

  return lookupDynamic(chainId, address);
}

/** For tests / debug routes. */
export function _staticAllowlistSize(): number {
  let n = 0;
  for (const set of staticAllow.values()) n += set.size;
  return n;
}
