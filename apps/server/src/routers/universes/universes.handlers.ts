/**
 * Universes Firestore handlers — CRUD operations for universe documents.
 * Documents are keyed by the lowercase contract address to ensure uniqueness.
 *
 * Renamed from cinematicUniverses.handlers.ts — the Firestore collection name
 * remains 'cinematicUniverses' for data continuity.
 */
import { db } from '../../lib/firebase';
import { randomUUID } from 'crypto';

// ── Mint fee credit conversion ────────────────────────────────────────────
const UNIVERSE_MINT_CREDITS = parseInt(process.env.UNIVERSE_MINT_CREDITS ?? '5000', 10);

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
      creator: input.creator,
      name: input.name ?? null,
      tokenAddress: input.tokenAddress,
      governanceAddress: input.governanceAddress,
      image_url: input.imageUrl,
      portrait_image_url: input.portraitImageUrl ?? null,
      description: input.description,
      onChainUniverseId: input.onChainUniverseId ?? null,
      mintTxHash: input.mintTxHash ?? null,
      unstoppableDomain: input.unstoppableDomain ?? null,
      hasPrivateSection: true,
      isMultiSig: false,
      multiSigAddress: null,
      accessModel: 'open', // open | subscription | token_gate | both
      created_at: new Date(),
      updated_at: new Date(),
    };

    await collection().doc(id).set(data);

    await seedUniverseCreditPool(id, input.creator, input.mintTxHash);
    await seedPrivateSectionConfig(id);

    return {
      success: true,
      data: { id, ...data },
      message: 'Universe created successfully',
      mintCreditsAwarded: UNIVERSE_MINT_CREDITS,
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
    const snapshot = await collection().orderBy('created_at').get();
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
  try {
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
  } catch (err) {
    console.error(`[seedPrivateSectionConfig] Failed for ${universeId}:`, err);
  }
}

// ── Internal: seed universe credit pool from mint fee ────────────────────

async function seedUniverseCreditPool(
  universeId: string,
  creatorUid: string,
  mintTxHash?: string | null
) {
  try {
    const poolRef = db.collection('universeCredits').doc(universeId);
    const existing = await poolRef.get();

    if (
      existing.exists &&
      (existing.data()?.seedTxHash === mintTxHash || existing.data()?.balance > 0)
    ) {
      return;
    }

    const now = new Date();

    await poolRef.set(
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

    await db.collection('universeCreditTransactions').add({
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
  } catch (err) {
    console.error(`[seedUniverseCreditPool] Failed to seed credits for ${universeId}:`, err);
  }
}
