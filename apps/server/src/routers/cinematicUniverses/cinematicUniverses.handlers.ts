/**
 * Cinematic Universes Firestore handlers — CRUD operations for universe documents.
 * Documents are keyed by the lowercase contract address to ensure uniqueness.
 */
import { db } from '../../lib/firebase';

interface CreateCinematicUniverseInput {
  address: string;
  creator: string;
  tokenAddress: string;
  governanceAddress: string;
  imageUrl: string;
  description: string;
}

const collection = db.collection('cinematicUniverses');

export async function createCinematicUniverse(input: CreateCinematicUniverseInput) {
  try {
    const id = input.address.toLowerCase();

    const existing = await collection.doc(id).get();
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
      created_at: new Date(),
      updated_at: new Date(),
    };

    await collection.doc(id).set(data);

    return {
      success: true,
      data: { id, ...data },
      message: 'Cinematic universe created successfully',
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
    const doc = await collection.doc(id).get();

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
    const snapshot = await collection.orderBy('created_at').get();
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
    const snapshot = await collection.where('creator', '==', creator).orderBy('created_at').get();
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
