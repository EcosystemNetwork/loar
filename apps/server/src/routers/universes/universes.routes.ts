/**
 * Universes router — CRUD operations for universe metadata in Firestore.
 * Uses wallet signature verification (not Firebase auth) for create operations.
 *
 * Renamed from cinematicUniverses to align with domain naming conventions.
 */
import { z } from 'zod';
import { publicProcedure, router } from '../../lib/trpc';
import {
  createUniverse,
  getUniverse,
  getAllUniverses,
  getUniversesByCreator,
} from './universes.handlers';

const createUniverseSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid creator address'),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  governanceAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid governance address'),
  imageUrl: z.string().url('Invalid image URL'),
  description: z.string().min(1, 'Description is required').max(1000, 'Description too long'),
  signature: z.string().min(1, 'Signature is required'),
  message: z.string().min(1, 'Message is required'),
  onChainUniverseId: z.string().optional(),
  mintTxHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
});

const getUniverseSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

const getByCreatorSchema = z.object({
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid creator address'),
});

export const universesRouter = router({
  /** Create a new universe (wallet-based auth via signature). */
  create: publicProcedure.input(createUniverseSchema).mutation(async ({ input }) => {
    const { verifyMessage } = await import('viem');

    const isValid = await verifyMessage({
      address: input.creator as `0x${string}`,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });

    if (!isValid) {
      throw new Error('Invalid wallet signature');
    }

    if (!input.message.toLowerCase().includes(input.creator.toLowerCase())) {
      throw new Error('Message must contain creator address');
    }

    const timestampMatch = input.message.match(/at (\d+)/);
    if (!timestampMatch) {
      throw new Error("Message must contain timestamp (e.g. 'at 1234567890')");
    }
    const messageTimestamp = parseInt(timestampMatch[1], 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - messageTimestamp) > 300) {
      throw new Error('Message timestamp expired (>5 minutes)');
    }

    return await createUniverse({
      address: input.address,
      creator: input.creator,
      tokenAddress: input.tokenAddress,
      governanceAddress: input.governanceAddress,
      imageUrl: input.imageUrl,
      description: input.description,
      onChainUniverseId: input.onChainUniverseId,
      mintTxHash: input.mintTxHash,
    });
  }),

  /** Get a specific universe by ID. */
  get: publicProcedure.input(getUniverseSchema).query(async ({ input }) => {
    return await getUniverse(input.id);
  }),

  /** Get all universes. */
  getAll: publicProcedure.query(async () => {
    return await getAllUniverses();
  }),

  /** Get universes by creator address. */
  getByCreator: publicProcedure.input(getByCreatorSchema).query(async ({ input }) => {
    return await getUniversesByCreator(input.creator);
  }),
});

export type UniversesRouter = typeof universesRouter;
