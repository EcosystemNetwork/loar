/**
 * Cinematic Universes router — CRUD operations for universe metadata in Firestore.
 * Uses wallet signature verification (not Firebase auth) for create operations.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import {
  createCinematicUniverse,
  getCinematicUniverse,
  getAllCinematicUniverses,
  getCinematicUniversesByCreator,
} from './cinematicUniverses.handlers';

const createCinematicUniverseSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid creator address'),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  governanceAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid governance address'),
  imageUrl: z.string().url('Invalid image URL'),
  description: z.string().min(1, 'Description is required').max(1000, 'Description too long'),
  signature: z.string().min(1, 'Signature is required'), // Wallet signature for verification
  message: z.string().min(1, 'Message is required'), // Message that was signed
});

const getCinematicUniverseSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

const getByCreatorSchema = z.object({
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid creator address'),
});

export const cinematicUniversesRouter = router({
  // Create a new cinematic universe (wallet-based auth)
  createcu: publicProcedure.input(createCinematicUniverseSchema).mutation(async ({ input }) => {
    // Verify wallet signature
    const { verifyMessage } = await import('viem');

    try {
      const isValid = await verifyMessage({
        address: input.creator as `0x${string}`,
        message: input.message,
        signature: input.signature as `0x${string}`,
      });

      if (!isValid) {
        throw new Error('Invalid wallet signature');
      }

      // Verify the message contains the creator address to prevent replay attacks
      if (!input.message.toLowerCase().includes(input.creator.toLowerCase())) {
        throw new Error('Message must contain creator address');
      }

      // Verify timestamp to prevent replay attacks (5-minute window)
      const timestampMatch = input.message.match(/at (\d+)/);
      if (!timestampMatch) {
        throw new Error("Message must contain timestamp (e.g. 'at 1234567890')");
      }
      const messageTimestamp = parseInt(timestampMatch[1], 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - messageTimestamp) > 300) {
        throw new Error('Message timestamp expired (>5 minutes)');
      }

      return await createCinematicUniverse({
        address: input.address,
        creator: input.creator,
        tokenAddress: input.tokenAddress,
        governanceAddress: input.governanceAddress,
        imageUrl: input.imageUrl,
        description: input.description,
      });
    } catch (error) {
      console.error('Wallet signature verification failed:', error);
      throw new Error('Authentication failed: Invalid wallet signature');
    }
  }),

  // Get a specific cinematic universe by ID
  get: publicProcedure.input(getCinematicUniverseSchema).query(async ({ input }) => {
    return await getCinematicUniverse(input.id);
  }),

  // Get all cinematic universes
  getAll: publicProcedure.query(async () => {
    return await getAllCinematicUniverses();
  }),

  // Get cinematic universes by creator address
  getByCreator: publicProcedure.input(getByCreatorSchema).query(async ({ input }) => {
    return await getCinematicUniversesByCreator(input.creator);
  }),
});

export type CinematicUniversesRouter = typeof cinematicUniversesRouter;
