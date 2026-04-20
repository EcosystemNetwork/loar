/**
 * Factory-child tracker.
 *
 * The UniverseManager spawns 4 kinds of child contracts per universe: the
 * Universe contract itself, a Governor, a GovernanceToken, and a BondingCurve.
 * Handlers for those dynamic contracts run against *every* child address, so
 * we need to know which addresses to subscribe to at `eth_getLogs` time.
 *
 * This module owns a Firestore-backed registry (`indexer_factoryChildren`)
 * plus an in-memory cache refreshed after each factory insert. On boot we
 * hydrate the cache with everything we know, so restarts don't re-read on-chain.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firestore.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { COLLECTIONS, type FactoryChild, type Hex } from './schema.js';

const CHAIN = env.LISTENER_CHAIN;

// In-memory sets keyed by kind.
const children = {
  universe: new Set<Hex>(),
  governor: new Set<Hex>(),
  token: new Set<Hex>(),
  bondingCurve: new Set<Hex>(),
};

export async function hydrateFactoryCache(): Promise<void> {
  const snap = await db.collection(COLLECTIONS.factoryChildren).where('chain', '==', CHAIN).get();
  for (const doc of snap.docs) {
    const d = doc.data() as FactoryChild;
    children[d.kind].add(d.childAddress);
  }
  logger.info(
    {
      universe: children.universe.size,
      governor: children.governor.size,
      token: children.token.size,
      bondingCurve: children.bondingCurve.size,
    },
    'factory cache hydrated'
  );
}

export async function recordFactoryChild(
  kind: FactoryChild['kind'],
  childAddress: Hex,
  factoryAddress: Hex,
  parentUniverse: Hex | undefined,
  createdAtBlock: number,
  createdAt: number
): Promise<void> {
  const lowered = childAddress.toLowerCase() as Hex;
  children[kind].add(lowered);

  const doc: FactoryChild = {
    chain: CHAIN,
    factoryAddress: factoryAddress.toLowerCase() as Hex,
    childAddress: lowered,
    kind,
    parentUniverse: parentUniverse?.toLowerCase() as Hex | undefined,
    createdAtBlock,
    createdAt,
  };

  const id = `${CHAIN}:${lowered}`;
  await db
    .collection(COLLECTIONS.factoryChildren)
    .doc(id)
    .set({ ...doc, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export function getChildren(kind: FactoryChild['kind']): Hex[] {
  return [...children[kind]];
}

export function hasChild(kind: FactoryChild['kind'], addr: Hex): boolean {
  return children[kind].has(addr.toLowerCase() as Hex);
}
