/**
 * Universes Firestore handlers — CRUD operations for universe documents.
 * Documents are keyed by the lowercase contract address to ensure uniqueness.
 *
 * Renamed from cinematicUniverses.handlers.ts — the Firestore collection name
 * remains 'cinematicUniverses' for data continuity.
 */
import { db } from '../../lib/firebase';
import { randomUUID } from 'crypto';

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
}

/** Firestore collection name kept as 'cinematicUniverses' for data continuity. */
const collection = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('cinematicUniverses');
};

export async function createUniverse(input: CreateUniverseInput) {
  try {
    const id = input.address.toLowerCase();

    const existing = await collection().doc(id).get();
    if (existing.exists) {
      throw new Error('A universe with this timeline contract address already exists');
    }

    const data = {
      address: input.address,
      creator: input.creator.toLowerCase(),
      name: input.name ?? null,
      tokenAddress: input.tokenAddress.toLowerCase(),
      governanceAddress: input.governanceAddress.toLowerCase(),
      image_url: input.imageUrl,
      portrait_image_url: input.portraitImageUrl ?? null,
      description: input.description,
      onChainUniverseId: input.onChainUniverseId ?? null,
      mintTxHash: input.mintTxHash ?? null,
      unstoppableDomain: input.unstoppableDomain ?? null,
      chainId: input.chainId ?? null,
      hasPrivateSection: true,
      isMultiSig: false,
      multiSigAddress: null,
      accessModel: 'open', // open | subscription | token_gate | both
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

export async function getAllUniverses() {
  try {
    const snapshot = await collection().orderBy('created_at').limit(500).get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

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

export async function getUniversesByCreator(creator: string) {
  try {
    const snapshot = await collection().where('creator', '==', creator).get();
    const data = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
        const aTime = a.created_at?.toMillis?.() ?? a.created_at ?? 0;
        const bTime = b.created_at?.toMillis?.() ?? b.created_at ?? 0;
        return aTime - bTime;
      });

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
