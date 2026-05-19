/**
 * Royalty Split Resolver — turns a leaf asset id into a payable split.
 *
 * Walks the `assetEvents` lineage chain from the asset back to its root,
 * collapses ancestors with the same creator (so a single creator who made
 * 3 edits in a row doesn't get triple-counted), applies the per-universe
 * policy for the asset's rights class, and returns the final share list
 * as `{ creatorUid, creatorAddress, bps }[]`.
 *
 * The function is read-only — it never mutates lineage state. Use it as
 * a *preview* in the publish/listing UI, and again at settlement time to
 * cross-check whatever was persisted on-chain.
 */

import { db } from '../../lib/firebase';
import { type AssetEvent, ASSET_EVENTS_COLLECTION } from '../lineage';
import {
  DEFAULT_POLICY,
  TOTAL_BPS,
  allocateShares,
  type RoyaltyPolicyConfig,
  type RoyaltyPolicyId,
  type RightsClass,
} from './policy';

const POLICIES_COLLECTION = 'universeRoyaltyPolicies';

export interface RoyaltyRecipient {
  creatorUid: string;
  creatorAddress: string | null;
  /** Where this recipient sits in the lineage. 0 = root, depth = current. */
  depth: number;
  /** Basis points (10000 = 100%). */
  bps: number;
  /** Optional label for UI — derived from depth. */
  role: 'root' | 'ancestor' | 'parent' | 'current';
}

export interface ResolvedSplit {
  assetId: string;
  rightsClass: RightsClass;
  policyId: RoyaltyPolicyId;
  recipients: RoyaltyRecipient[];
  /** Chain length walked (for diagnostics). */
  chainDepth: number;
  /** When the lineage chain was truncated by maxDepth. */
  truncated: boolean;
}

function eventsCol() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection(ASSET_EVENTS_COLLECTION);
}

function policiesCol() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection(POLICIES_COLLECTION);
}

/**
 * Load a universe's policy from Firestore, falling back to the platform default.
 * Universe IDs are normalised to lowercase since EVM addresses are
 * mixed-case but conventionally stored lowercased.
 */
export async function getUniversePolicy(
  universeId: string | null | undefined
): Promise<RoyaltyPolicyConfig> {
  if (!universeId) return DEFAULT_POLICY;
  try {
    const doc = await policiesCol().doc(universeId.toLowerCase()).get();
    if (!doc.exists) return DEFAULT_POLICY;
    const data = doc.data() as Partial<RoyaltyPolicyConfig> | undefined;
    if (!data) return DEFAULT_POLICY;
    return {
      byRightsClass: { ...DEFAULT_POLICY.byRightsClass, ...(data.byRightsClass ?? {}) },
      maxDepth: typeof data.maxDepth === 'number' ? data.maxDepth : DEFAULT_POLICY.maxDepth,
      minShareBps:
        typeof data.minShareBps === 'number' ? data.minShareBps : DEFAULT_POLICY.minShareBps,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function setUniversePolicy(
  universeId: string,
  config: RoyaltyPolicyConfig
): Promise<void> {
  await policiesCol()
    .doc(universeId.toLowerCase())
    .set(
      {
        ...config,
        updatedAt: new Date(),
      },
      { merge: true }
    );
}

/**
 * Walk root → self. Bounded by `maxDepth` to keep Firestore reads small
 * even on pathological chains. Returns the chain in root-first order.
 */
async function walkChain(
  assetId: string,
  maxDepth: number
): Promise<{ chain: AssetEvent[]; truncated: boolean }> {
  const chain: AssetEvent[] = [];
  const seen = new Set<string>();
  let current: string | null = assetId;
  let truncated = false;

  while (current && !seen.has(current)) {
    if (chain.length >= maxDepth + 1) {
      truncated = true;
      break;
    }
    seen.add(current);
    const doc = await eventsCol().doc(current).get();
    if (!doc.exists) break;
    const data = doc.data() as AssetEvent;
    chain.push(data);
    current = data.parentAssetId ?? null;
  }

  // We collected self → root; flip so callers get root → self.
  return { chain: chain.reverse(), truncated };
}

/**
 * Collapse consecutive same-creator entries — when one creator does
 * three edits in a row, treat them as a single ancestor slot so they
 * don't get triple-share.
 */
function collapseConsecutiveDuplicates(chain: AssetEvent[]): AssetEvent[] {
  if (chain.length === 0) return chain;
  const out: AssetEvent[] = [chain[0]!];
  for (let i = 1; i < chain.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = chain[i]!;
    if (cur.creatorUid && cur.creatorUid === prev.creatorUid) continue;
    out.push(cur);
  }
  return out;
}

/**
 * Main entry point. Returns a deterministic split for the given asset.
 * Falls back to a single 100%-current-creator recipient when the asset
 * has no lineage row yet (e.g. external upload).
 */
export async function resolveSplitsForAsset(
  assetId: string,
  fallback?: { creatorUid?: string; creatorAddress?: string | null; rightsClass?: RightsClass }
): Promise<ResolvedSplit> {
  const tentativeConfig = DEFAULT_POLICY;
  const { chain: rawChain, truncated } = await walkChain(assetId, tentativeConfig.maxDepth);

  // No lineage rows yet → return a single-recipient split from the fallback.
  if (rawChain.length === 0) {
    const rightsClass: RightsClass = fallback?.rightsClass ?? 'original';
    const policy = tentativeConfig.byRightsClass[rightsClass];
    return {
      assetId,
      rightsClass,
      policyId: policy,
      chainDepth: 0,
      truncated: false,
      recipients: [
        {
          creatorUid: fallback?.creatorUid ?? 'unknown',
          creatorAddress: fallback?.creatorAddress ?? null,
          depth: 0,
          bps: TOTAL_BPS,
          role: 'current',
        },
      ],
    };
  }

  const chain = collapseConsecutiveDuplicates(rawChain);
  const leaf = chain[chain.length - 1]!;
  const rightsClass: RightsClass = leaf.rightsClass ?? fallback?.rightsClass ?? 'original';

  // Per-universe policy override (or platform default).
  const config = await getUniversePolicy(leaf.universeAddress ?? leaf.universeId ?? null);
  const policyId = config.byRightsClass[rightsClass];
  const shares = allocateShares(policyId, chain.length, config);

  const recipients: RoyaltyRecipient[] = [];
  chain.forEach((evt, idx) => {
    const bps = shares[idx] ?? 0;
    if (bps <= 0) return;
    const role: RoyaltyRecipient['role'] =
      idx === chain.length - 1
        ? 'current'
        : idx === 0
          ? 'root'
          : idx === chain.length - 2
            ? 'parent'
            : 'ancestor';
    recipients.push({
      creatorUid: evt.creatorUid,
      creatorAddress: evt.creatorAddress,
      depth: idx,
      bps,
      role,
    });
  });

  // Defensive — if rounding/floor logic dropped everyone except current,
  // make sure the array sums to TOTAL_BPS by topping up current.
  const sum = recipients.reduce((a, r) => a + r.bps, 0);
  if (sum !== TOTAL_BPS && recipients.length > 0) {
    recipients[recipients.length - 1]!.bps += TOTAL_BPS - sum;
  }

  return {
    assetId,
    rightsClass,
    policyId,
    chainDepth: chain.length,
    truncated,
    recipients,
  };
}

/**
 * Pure preview helper — bypasses Firestore. Given a hypothetical chain
 * length + rights class, return what the split WOULD look like. Used by
 * the UI to render an example split when no lineage is loaded yet.
 */
export function previewSplit(
  chainLength: number,
  rightsClass: RightsClass,
  config: RoyaltyPolicyConfig = DEFAULT_POLICY
): { policyId: RoyaltyPolicyId; shares: number[] } {
  const policyId = config.byRightsClass[rightsClass];
  const shares = allocateShares(policyId, chainLength, config);
  return { policyId, shares };
}
