/**
 * Cinematic Universes Firestore handlers — CRUD operations for universe documents.
 * Documents are keyed by the lowercase contract address to ensure uniqueness.
 */
import { db } from '../../lib/firebase';
import { randomUUID } from 'crypto';

// ── Mint fee credit conversion ────────────────────────────────────────────
//
// The UniverseManager contract charges 0.05 Base ETH to mint a universe:
//   • 50% (0.025 ETH) → lpRecipient (deepens $LOAR liquidity, earns LP fees for platform)
//   • 50% (0.025 ETH) → held in contract, claimed by platform treasury
//
// The platform converts the 0.025 ETH credit portion into shared credits for
// the universe's team wallet. The rate is configurable via UNIVERSE_MINT_CREDITS
// env var (defaults to 5000 credits ≈ $50 at standard pricing).
//
const UNIVERSE_MINT_CREDITS = parseInt(process.env.UNIVERSE_MINT_CREDITS ?? '5000', 10);

interface CreateCinematicUniverseInput {
  address: string;
  creator: string;
  tokenAddress: string;
  governanceAddress: string;
  imageUrl: string;
  description: string;
  /** On-chain uint universe ID returned by createUniverse() */
  onChainUniverseId?: string;
  /** Transaction hash of the createUniverse() call */
  mintTxHash?: string;
}

const collection = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('cinematicUniverses');
};

export async function createCinematicUniverse(input: CreateCinematicUniverseInput) {
  try {
    const id = input.address.toLowerCase();

    const existing = await collection().doc(id).get();
    if (existing.exists) {
      throw new Error('A cinematic universe with this timeline contract address already exists');
    }

    const data = {
      address: input.address,
      creator: input.creator,
      tokenAddress: input.tokenAddress,
      governanceAddress: input.governanceAddress,
      image_url: input.imageUrl,
      description: input.description,
      onChainUniverseId: input.onChainUniverseId ?? null,
      mintTxHash: input.mintTxHash ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await collection().doc(id).set(data);

    // ── Seed the universe credit pool from the mint fee ───────────────
    // The on-chain UniverseManager held 0.025 ETH (credit portion) when
    // this universe was minted. We mirror that as platform credits in the
    // universe's shared team wallet so team members can start generating
    // immediately without additional top-ups.
    await seedUniverseCreditPool(id, input.creator, input.mintTxHash);

    return {
      success: true,
      data: { id, ...data },
      message: 'Cinematic universe created successfully',
      mintCreditsAwarded: UNIVERSE_MINT_CREDITS,
    };
  } catch (error) {
    console.error('Error creating cinematic universe:', error);
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }
    throw new Error('Failed to create cinematic universe');
  }
}

export async function getCinematicUniverse(id: string) {
  try {
    const doc = await collection().doc(id).get();

    if (!doc.exists) {
      throw new Error('Cinematic universe not found');
    }

    return {
      success: true,
      data: { id: doc.id, ...doc.data() },
    };
  } catch (error) {
    console.error('Error fetching cinematic universe:', error);
    throw new Error('Failed to fetch cinematic universe');
  }
}

export async function getAllCinematicUniverses() {
  try {
    const snapshot = await collection().orderBy('created_at').get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return {
      success: true,
      data,
      total: data.length,
    };
  } catch (error) {
    console.error('Error fetching all cinematic universes:', error);
    throw new Error('Failed to fetch cinematic universes');
  }
}

export async function getCinematicUniversesByCreator(creator: string) {
  try {
    const snapshot = await collection().where('creator', '==', creator).orderBy('created_at').get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return {
      success: true,
      data,
      total: data.length,
    };
  } catch (error) {
    console.error('Error fetching cinematic universes by creator:', error);
    throw new Error('Failed to fetch cinematic universes by creator');
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

    // Idempotency: don't double-seed if already seeded
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
      /** 0.025 ETH held on-chain; platform converts at UNIVERSE_MINT_CREDITS rate */
      ethAmountWei: '25000000000000000',
      source: 'mint_fee',
      note: '50% of 0.05 ETH universe mint fee converted to team credits',
      createdAt: now,
    });
  } catch (err) {
    // Non-fatal — log and continue. The universe doc was already created.
    console.error(`[seedUniverseCreditPool] Failed to seed credits for ${universeId}:`, err);
  }
}
