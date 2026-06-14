/**
 * ENS — identity layer for LOAR users + AI agents.
 *
 * Resolution runs against Ethereum mainnet (ENS's canonical registry) via the
 * shared chain-client. Powers:
 *   - forward / reverse name resolution (display real names instead of 0x…)
 *   - text-record reads (avatar, url, com.twitter, …)
 *   - ENSIP-25/26 agent identity: read an agent's MCP / A2A endpoints + card
 *     from text records so an ENS name becomes a discoverable agent handle.
 *
 * Reverse names are forward-verified (ENS reverse records are unauthenticated:
 * anyone can set one, so we resolve the claimed name back to the address and
 * only trust it on a match).
 *
 * No env required — uses RPC_URL_MAINNET (falls back to a public node).
 */
import { normalize } from 'viem/ens';
import { getChainClient } from './chain-client';

const MAINNET = 1;

// 10-minute in-process cache (mirrors the Unstoppable Domains resolver TTL).
// Keys derive from attacker-controlled input (arbitrary addresses / ENS names
// from API callers), so the Map is capped + oldest-evicted to prevent an
// unbounded-memory DoS via flooding distinct lookups.
const TTL_MS = 10 * 60_000;
const CACHE_MAX = 10_000;
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string): T | undefined {
  const e = cache.get(key);
  if (e && e.expiresAt > Date.now()) return e.value as T;
  if (e) cache.delete(key);
  return undefined;
}
function put<T>(key: string, value: T): T {
  if (cache.has(key)) cache.delete(key); // refresh insertion order
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

function mainnetClient() {
  return getChainClient(MAINNET);
}

/** ENSIP-26 / common agent text-record keys read for an agent card. */
export const AGENT_TEXT_KEYS = [
  'agent-endpoint[mcp]',
  'agent-endpoint[a2a]',
  'url',
  'description',
  'avatar',
  'com.twitter',
  'com.github',
] as const;

/**
 * Reverse-resolve an address → primary ENS name, forward-verified.
 * Returns null when there's no name or the reverse record doesn't round-trip.
 */
export async function lookupAddress(address: string): Promise<string | null> {
  const key = `rev:${address.toLowerCase()}`;
  const hit = cached<string | null>(key);
  if (hit !== undefined) return hit;

  try {
    const client = mainnetClient();
    const name = await client.getEnsName({ address: address as `0x${string}` });
    if (!name) return put(key, null);
    // Forward-verify: the name must resolve back to this address.
    const fwd = await client.getEnsAddress({ name: normalize(name) });
    const ok = fwd?.toLowerCase() === address.toLowerCase();
    return put(key, ok ? name : null);
  } catch {
    return put(key, null);
  }
}

/** Forward-resolve an ENS name → address. */
export async function resolveName(name: string): Promise<string | null> {
  const key = `fwd:${name.toLowerCase()}`;
  const hit = cached<string | null>(key);
  if (hit !== undefined) return hit;
  try {
    const addr = await mainnetClient().getEnsAddress({ name: normalize(name) });
    return put(key, addr ?? null);
  } catch {
    return put(key, null);
  }
}

/** Read a single ENS text record. */
export async function getText(name: string, recordKey: string): Promise<string | null> {
  const key = `txt:${name.toLowerCase()}:${recordKey}`;
  const hit = cached<string | null>(key);
  if (hit !== undefined) return hit;
  try {
    const value = await mainnetClient().getEnsText({ name: normalize(name), key: recordKey });
    return put(key, value ?? null);
  } catch {
    return put(key, null);
  }
}

export interface EnsProfile {
  name: string;
  address: string | null;
  avatar: string | null;
  url: string | null;
  description: string | null;
  twitter: string | null;
  github: string | null;
}

/** Resolve a full display profile for an ENS name. */
export async function getProfile(name: string): Promise<EnsProfile | null> {
  const normalized = (() => {
    try {
      return normalize(name);
    } catch {
      return null;
    }
  })();
  if (!normalized) return null;

  const [address, avatar, url, description, twitter, github] = await Promise.all([
    resolveName(normalized),
    getText(normalized, 'avatar'),
    getText(normalized, 'url'),
    getText(normalized, 'description'),
    getText(normalized, 'com.twitter'),
    getText(normalized, 'com.github'),
  ]);

  return { name: normalized, address, avatar, url, description, twitter, github };
}

export interface AgentEnsCard {
  name: string;
  address: string | null;
  /** MCP endpoint (ENSIP-26 `agent-endpoint[mcp]`). */
  mcpEndpoint: string | null;
  /** A2A endpoint (ENSIP-26 `agent-endpoint[a2a]`). */
  a2aEndpoint: string | null;
  url: string | null;
  description: string | null;
  avatar: string | null;
  /** True when the name advertises at least one agent endpoint. */
  isAgent: boolean;
}

/**
 * Read an ENS name as an agent card (ENSIP-25/26). An ENS name becomes a
 * discoverable, verifiable agent identity when it carries `agent-endpoint[*]`
 * text records pointing at its MCP / A2A surface.
 */
export async function getAgentCard(name: string): Promise<AgentEnsCard | null> {
  const normalized = (() => {
    try {
      return normalize(name);
    } catch {
      return null;
    }
  })();
  if (!normalized) return null;

  const [address, mcpEndpoint, a2aEndpoint, url, description, avatar] = await Promise.all([
    resolveName(normalized),
    getText(normalized, 'agent-endpoint[mcp]'),
    getText(normalized, 'agent-endpoint[a2a]'),
    getText(normalized, 'url'),
    getText(normalized, 'description'),
    getText(normalized, 'avatar'),
  ]);

  return {
    name: normalized,
    address,
    mcpEndpoint,
    a2aEndpoint,
    url,
    description,
    avatar,
    isAgent: !!(mcpEndpoint || a2aEndpoint),
  };
}
