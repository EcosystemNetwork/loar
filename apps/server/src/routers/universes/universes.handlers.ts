/**
 * Universes Firestore handlers — CRUD operations for universe documents.
 * Documents are keyed by the lowercase contract address to ensure uniqueness.
 *
 * Renamed from cinematicUniverses.handlers.ts — the Firestore collection name
 * remains 'cinematicUniverses' for data continuity.
 */
import { db } from '../../lib/firebase';
import { randomUUID } from 'crypto';
import { getSafeInfo } from '../../lib/safe-admin';

// ── Mint fee credit conversion (~$10 worth of generation credits) ─────────
const UNIVERSE_MINT_CREDITS = parseInt(process.env.UNIVERSE_MINT_CREDITS ?? '333', 10);

interface CreateUniverseInput {
  address: string;
  creator: string;
  name?: string;
  tokenAddress: string;
  governanceAddress: string;
  imageUrl: string;
  portraitImageUrl?: string;
  description: string;
  onChainUniverseId?: string;
  mintTxHash?: string;
  unstoppableDomain?: string | null;
  chainId?: number;
  /** Chain namespace — 'eip155' for EVM, 'solana' for Solana. Defaults to 'eip155'. */
  chainNamespace?: 'eip155' | 'solana';
  /** Solana cluster when chainNamespace === 'solana'. */
  solanaCluster?: 'devnet' | 'mainnet-beta' | 'testnet';
  /** 'fun' = sandbox, starts private until owner launches it publicly.
   *  'monetized' = launchpad universe, public from mint. */
  universeType?: 'fun' | 'monetized';
}

/** Firestore collection name kept as 'cinematicUniverses' for data continuity. */
const collection = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('cinematicUniverses');
};

export async function createUniverse(input: CreateUniverseInput) {
  try {
    const namespace = input.chainNamespace ?? 'eip155';
    // EVM addresses are case-insensitive — we lowercase them as the doc id.
    // Solana addresses (base58) are case-sensitive; preserve the original.
    const id = namespace === 'eip155' ? input.address.toLowerCase() : input.address;

    const existing = await collection().doc(id).get();
    if (existing.exists) {
      throw new Error('A universe with this timeline contract address already exists');
    }

    const universeType = input.universeType ?? 'monetized';
    // Fun universes start private and require an explicit "Launch Publicly"
    // gesture. Monetized universes are always public (they ship via the
    // launchpad, so hiding them post-mint would unlist a trading token).
    const isPrivate = universeType === 'fun';

    const data = {
      address: namespace === 'eip155' ? input.address : input.address,
      creator: namespace === 'eip155' ? input.creator.toLowerCase() : input.creator,
      name: input.name ?? null,
      tokenAddress: namespace === 'eip155' ? input.tokenAddress.toLowerCase() : input.tokenAddress,
      governanceAddress:
        namespace === 'eip155' ? input.governanceAddress.toLowerCase() : input.governanceAddress,
      image_url: input.imageUrl,
      portrait_image_url: input.portraitImageUrl ?? null,
      description: input.description,
      onChainUniverseId: input.onChainUniverseId ?? null,
      mintTxHash: input.mintTxHash ?? null,
      unstoppableDomain: input.unstoppableDomain ?? null,
      chainId: input.chainId ?? null,
      chainNamespace: namespace,
      solanaCluster: namespace === 'solana' ? (input.solanaCluster ?? 'devnet') : null,
      hasPrivateSection: true,
      isMultiSig: false,
      multiSigAddress: null,
      accessModel: 'open', // open | subscription | token_gate | both
      universeType,
      isPrivate,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await collection().doc(id).set(data);

    // Seeding failures are logged but must not silently break the onboarding flow.
    // Surface errors so callers know credits/config may need manual intervention.
    const seedingErrors: string[] = [];

    try {
      await seedUniverseCreditPool(id, input.creator, input.mintTxHash);
    } catch (err) {
      console.error(`[createUniverse] Credit seeding failed for ${id}:`, err);
      seedingErrors.push('credit_pool');
    }

    try {
      await seedPrivateSectionConfig(id);
    } catch (err) {
      console.error(`[createUniverse] Private section config failed for ${id}:`, err);
      seedingErrors.push('private_section');
    }

    return {
      success: true,
      data: { id, ...data },
      message: seedingErrors.length
        ? `Universe created but seeding failed for: ${seedingErrors.join(', ')}`
        : 'Universe created successfully',
      mintCreditsAwarded: seedingErrors.includes('credit_pool') ? 0 : UNIVERSE_MINT_CREDITS,
      seedingErrors: seedingErrors.length ? seedingErrors : undefined,
    };
  } catch (error) {
    console.error('Error creating universe:', error);
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }
    throw new Error('Failed to create universe');
  }
}

export async function getUniverse(id: string) {
  try {
    const doc = await collection().doc(id.toLowerCase()).get();

    if (!doc.exists) {
      throw new Error('Universe not found');
    }

    return {
      success: true,
      data: { id: doc.id, ...doc.data() },
    };
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith('Failed to')) throw error;
    console.error('Error fetching universe:', error);
    throw new Error('Failed to fetch universe', { cause: error });
  }
}

export async function getAllUniverses(options?: {
  /** Include admin-hidden docs (admin dashboards only). */
  includeHidden?: boolean;
  /**
   * If provided, universes where `creator === viewerAddress` are kept even when
   * `isPrivate` is true — owners always see their own stuff. `includeHidden`
   * still controls admin-hidden docs independently.
   */
  viewerAddress?: string;
}) {
  try {
    const snapshot = await collection().orderBy('created_at').limit(500).get();
    let data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];

    if (!options?.includeHidden) {
      data = data.filter((u) => !u.isHidden);
    }

    const viewer = options?.viewerAddress?.toLowerCase();
    data = data.filter((u) => !u.isPrivate || (viewer && u.creator?.toLowerCase() === viewer));

    return {
      success: true,
      data,
      total: data.length,
    };
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith('Failed to')) throw error;
    console.error('Error fetching all universes:', error);
    throw new Error('Failed to fetch universes', { cause: error });
  }
}

/**
 * Returns the set of universe IDs (lowercase addresses) whose content must
 * NOT surface on public listing endpoints — union of admin-hidden and
 * owner-private universes. Callers can pass a `viewerAddress` to exempt
 * universes the viewer owns, so creators always see their own content.
 *
 * This is the single chokepoint every public content endpoint calls before
 * returning a list. It's an O(N) scan of the universe collection, which is
 * bounded (few hundred docs today). If it grows: denormalize or add an index.
 */
export async function getExcludedUniverseIds(options?: {
  viewerAddress?: string;
}): Promise<Set<string>> {
  const snapshot = await collection().select('creator', 'isHidden', 'isPrivate').get();
  const viewer = options?.viewerAddress?.toLowerCase();
  const excluded = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const hidden = Boolean(data.isHidden);
    const isPrivate = Boolean(data.isPrivate);
    if (!hidden && !isPrivate) continue;
    if (
      isPrivate &&
      !hidden &&
      viewer &&
      (data.creator as string | undefined)?.toLowerCase() === viewer
    ) {
      continue; // owner sees their own private universe content
    }
    excluded.add(doc.id);
  }
  return excluded;
}

/**
 * Admin-only: soft-delete a universe by flipping the `isHidden` flag.
 * The doc is preserved; published content keeps its `universeId` reference
 * and stays visible in the global gallery.
 *
 * PRD-10: Writes an immutable `contentAuditLog` entry recording the actor,
 * universe, and prior/new state so hide/unhide operations are never silent.
 */
export async function setUniverseHidden(
  universeId: string,
  isHidden: boolean,
  actor?: { uid?: string; address?: string }
) {
  const id = universeId.toLowerCase();
  const doc = await collection().doc(id).get();
  if (!doc.exists) throw new Error('Universe not found');

  const previousHidden = Boolean(doc.data()?.isHidden);
  const now = new Date();

  const batch = db.batch();
  batch.update(collection().doc(id), { isHidden, updated_at: now });
  batch.set(db.collection('contentAuditLog').doc(), {
    action: isHidden ? 'universe_hidden' : 'universe_unhidden',
    universeId: id,
    previousHidden,
    newHidden: isHidden,
    actorUid: actor?.uid ?? null,
    actorAddress: actor?.address ?? null,
    createdAt: now.toISOString(),
  });
  await batch.commit();

  return { id, isHidden };
}

/**
 * Owner-controlled: toggle a universe's `isPrivate` flag. When true, the
 * universe and every piece of content linked to it (gallery items, entities,
 * etc.) disappear from all public listing endpoints — but the owner still
 * sees their own stuff. Writes a `contentAuditLog` entry mirroring
 * `setUniverseHidden` so every visibility change is recoverable.
 *
 * Caller authorization (creator-or-multisig-owner) is enforced in the route.
 */
export async function setUniversePrivate(
  universeId: string,
  isPrivate: boolean,
  actor?: { uid?: string; address?: string }
) {
  const id = universeId.toLowerCase();
  const doc = await collection().doc(id).get();
  if (!doc.exists) throw new Error('Universe not found');

  const previousPrivate = Boolean(doc.data()?.isPrivate);
  const now = new Date();

  const batch = db.batch();
  batch.update(collection().doc(id), { isPrivate, updated_at: now });
  batch.set(db.collection('contentAuditLog').doc(), {
    action: isPrivate ? 'universe_made_private' : 'universe_made_public',
    universeId: id,
    previousPrivate,
    newPrivate: isPrivate,
    actorUid: actor?.uid ?? null,
    actorAddress: actor?.address ?? null,
    createdAt: now.toISOString(),
  });
  await batch.commit();

  return { id, isPrivate };
}

/**
 * Admin-only: permanently delete a universe doc. The on-chain contract is
 * untouched (immutable), and related collections (gallery content, credits,
 * privateSectionConfig) are intentionally preserved — deleting the universe
 * only removes its metadata row so it disappears from every listing path.
 *
 * Writes an immutable `contentAuditLog` entry capturing the snapshot of the
 * deleted doc so the action is recoverable (manually) and never silent.
 */
export async function deleteUniverse(
  universeId: string,
  actor?: { uid?: string; address?: string },
  reason?: string
) {
  const id = universeId.toLowerCase();
  const ref = collection().doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Universe not found');

  const snapshot = doc.data() ?? {};
  const now = new Date();

  const batch = db.batch();
  batch.delete(ref);
  batch.set(db.collection('contentAuditLog').doc(), {
    action: 'universe_deleted',
    universeId: id,
    actorUid: actor?.uid ?? null,
    actorAddress: actor?.address ?? null,
    reason: reason ?? null,
    deletedSnapshot: JSON.parse(JSON.stringify(snapshot)),
    createdAt: now.toISOString(),
  });
  await batch.commit();

  return { id, deleted: true };
}

export async function getUniversesByCreator(
  creator: string,
  options?: {
    includeHidden?: boolean;
    /** When the viewer is the creator themselves, private universes are kept. */
    viewerAddress?: string;
  }
) {
  try {
    const snapshot = await collection().where('creator', '==', creator).get();
    let data = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
        const aTime = a.created_at?.toMillis?.() ?? a.created_at ?? 0;
        const bTime = b.created_at?.toMillis?.() ?? b.created_at ?? 0;
        return aTime - bTime;
      }) as any[];

    if (!options?.includeHidden) {
      data = data.filter((u) => !u.isHidden);
    }

    const viewerIsCreator = options?.viewerAddress?.toLowerCase() === creator.toLowerCase();
    if (!viewerIsCreator) {
      data = data.filter((u) => !u.isPrivate);
    }

    return {
      success: true,
      data,
      total: data.length,
    };
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith('Failed to')) throw error;
    console.error('Error fetching universes by creator:', error);
    throw new Error('Failed to fetch universes by creator', { cause: error });
  }
}

/**
 * Returns every universe the caller can author into — union of three roles:
 *
 *   - `creator`     : Firestore `creator == uid` (covers single-EOA universes
 *                     AND multi-sig universes where `creator` is set to the
 *                     Safe address but the caller's uid happens to match,
 *                     which never occurs in practice)
 *   - `safe_signer` : caller appears in the denormalized `multiSigOwners` array
 *                     (populated on `setMultiSig`). Falls back to a live
 *                     `getOwners()` check for legacy multi-sig docs that
 *                     pre-date the denormalization.
 *   - `team_member` : active row in `universeTeamMembers`
 *
 * Hidden universes (admin moderation) are excluded; private ones are kept
 * because the caller is a collaborator on them by definition.
 *
 * Eventually consistent for multi-sig: Safe ownership changes made directly
 * on the Safe contract (without re-calling `setMultiSig`) won't sync until
 * a legacy fallback path runs or the universe is re-wired. The actual write
 * path always re-checks ownership live via `isUniverseAdmin`, so this is a
 * discovery-only staleness risk, not an authorization one.
 */
const LEGACY_MS_SCAN_LIMIT = 50;

export async function getEditableUniversesForUser(uid: string) {
  const u = uid.toLowerCase();
  const col = collection();

  // Platform-level admin override — addresses listed in ADMIN_ADDRESSES /
  // ADMIN_WALLET get edit access to every universe so they can use the
  // Create hub's universe picker on any project. The role label is
  // "creator" so existing role-based UI doesn't get a special case.
  const { isAdminAddress } = await import('../../lib/trpc');
  if (isAdminAddress(u)) {
    const allSnap = await col.get();
    const docs = allSnap.docs
      .filter((d) => !d.data().isHidden)
      .map((d) => ({ id: d.id, ...d.data(), roles: ['creator' as const] }));
    const sorted = docs.sort((a: any, b: any) => {
      const at = a.created_at?.toMillis?.() ?? a.created_at ?? 0;
      const bt = b.created_at?.toMillis?.() ?? b.created_at ?? 0;
      return Number(bt) - Number(at);
    });
    return { success: true, data: sorted, total: sorted.length };
  }

  const [creatorSnap, prefilterSnap, teamSnap, legacyMsSnap] = await Promise.all([
    col.where('creator', '==', u).get(),
    col.where('multiSigOwners', 'array-contains', u).get(),
    db
      .collection('universeTeamMembers')
      .where('memberUid', '==', u)
      .where('status', '==', 'active')
      .get(),
    col.where('isMultiSig', '==', true).limit(LEGACY_MS_SCAN_LIMIT).get(),
  ]);

  const result = new Map<string, any>();
  const mark = (id: string, data: any, role: 'creator' | 'safe_signer' | 'team_member') => {
    if (data?.isHidden) return;
    const existing = result.get(id);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    result.set(id, { id, ...data, roles: [role] });
  };

  for (const d of creatorSnap.docs) mark(d.id, d.data(), 'creator');
  for (const d of prefilterSnap.docs) mark(d.id, d.data(), 'safe_signer');

  // Team membership → fetch universe metadata for each
  if (!teamSnap.empty) {
    const universeIds = Array.from(
      new Set(
        teamSnap.docs
          .map((d) => (d.data() as any).universeId as string | undefined)
          .filter((id): id is string => !!id)
      )
    );
    const universeDocs = await Promise.all(universeIds.map((id) => col.doc(id).get()));
    for (const d of universeDocs) {
      if (!d.exists) continue;
      mark(d.id, d.data(), 'team_member');
    }
  }

  // Legacy fallback: multi-sig universes that pre-date `multiSigOwners`
  // denormalization. Bounded scan + live `getOwners()` check; we backfill
  // the field as a side effect so subsequent queries are cheap.
  const legacyDocs = legacyMsSnap.docs.filter((d) => {
    const data = d.data();
    const owners = data.multiSigOwners;
    const hasDenorm = Array.isArray(owners) && owners.length > 0;
    return !hasDenorm && !!data.multiSigAddress;
  });

  if (legacyDocs.length > 0) {
    await Promise.all(
      legacyDocs.map(async (d) => {
        const data = d.data();
        try {
          const safeInfo = await getSafeInfo(
            data.multiSigAddress as string,
            data.chainId as number | undefined
          );
          if (!safeInfo) return;
          const ownersLower = safeInfo.owners.map((o) => o.toLowerCase());
          // Best-effort backfill — don't block the response on it.
          void col
            .doc(d.id)
            .update({ multiSigOwners: ownersLower, multiSigOwnersUpdatedAt: new Date() })
            .catch((err) =>
              console.error(`[getEditableUniversesForUser] Backfill failed for ${d.id}:`, err)
            );
          if (ownersLower.includes(u)) mark(d.id, data, 'safe_signer');
        } catch (err) {
          console.error(
            `[getEditableUniversesForUser] Live Safe check failed for ${d.id}:`,
            err instanceof Error ? err.message : err
          );
        }
      })
    );
  }

  const data = Array.from(result.values()).sort((a, b) => {
    const aT = a.created_at?.toMillis?.() ?? a.created_at ?? 0;
    const bT = b.created_at?.toMillis?.() ?? b.created_at ?? 0;
    return bT - aT;
  });

  return { success: true, data, total: data.length };
}

// ── Internal: seed private section config for Creator's Room ─────────────

async function seedPrivateSectionConfig(universeId: string) {
  const configRef = db.collection('privateSectionConfig').doc(universeId);
  const existing = await configRef.get();
  if (existing.exists) return;

  const now = new Date();
  await configRef.set({
    universeId,
    vaultEnabled: true,
    notesEnabled: true,
    holderMinPercentage: 1, // default 1% token ownership for vault access
    createdAt: now,
    updatedAt: now,
  });
}

// ── Internal: seed universe credit pool from mint fee ────────────────────

async function seedUniverseCreditPool(
  universeId: string,
  creatorUid: string,
  mintTxHash?: string | null
) {
  const poolRef = db.collection('universeCredits').doc(universeId);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(poolRef);

    if (
      existing.exists &&
      (existing.data()?.seedTxHash === mintTxHash || existing.data()?.balance > 0)
    ) {
      return; // Already seeded
    }

    const now = new Date();

    tx.set(
      poolRef,
      {
        universeId,
        balance: UNIVERSE_MINT_CREDITS,
        totalPurchased: UNIVERSE_MINT_CREDITS,
        totalSpent: 0,
        seedTxHash: mintTxHash ?? null,
        seedSource: 'mint_fee',
        lastFundedAt: now,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );

    const txRef = db.collection('universeCreditTransactions').doc();
    tx.set(txRef, {
      id: randomUUID(),
      universeId,
      type: 'fund',
      fundedByUid: creatorUid.toLowerCase(),
      paymentMethod: 'eth',
      paymentRef: mintTxHash ?? 'genesis',
      credits: UNIVERSE_MINT_CREDITS,
      ethAmountWei: '25000000000000000',
      source: 'mint_fee',
      note: '50% of 0.05 ETH universe mint fee converted to team credits',
      createdAt: now,
    });
  });
}
