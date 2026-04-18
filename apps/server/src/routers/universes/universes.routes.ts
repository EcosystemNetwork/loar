/**
 * Universes router — CRUD operations for universe metadata in Firestore.
 * Uses wallet signature verification (not Firebase auth) for create operations.
 *
 * Renamed from cinematicUniverses to align with domain naming conventions.
 */
import { z } from 'zod';
import { publicProcedure, protectedProcedure, adminProcedure, router } from '../../lib/trpc';
import {
  createUniverse,
  getUniverse,
  getAllUniverses,
  getUniversesByCreator,
  setUniverseHidden,
} from './universes.handlers';
import { isUniverseAdmin, getSafeInfo } from '../../lib/safe-admin';
import { db } from '../../lib/firebase';
import { generateNonce, consumeNonce } from '../../lib/siwe';

const createUniverseSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid creator address'),
  name: z.string().min(1).max(200).optional(),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  governanceAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid governance address'),
  imageUrl: z.string().url('Invalid image URL'),
  portraitImageUrl: z.string().url('Invalid portrait image URL').optional(),
  description: z.string().min(1, 'Description is required').max(1000, 'Description too long'),
  signature: z.string().min(1, 'Signature is required'),
  message: z.string().min(1, 'Message is required'),
  /** Server-issued nonce from /auth/nonce — prevents signature replay */
  nonce: z.string().min(1, 'Nonce is required'),
  onChainUniverseId: z.string().optional(),
  mintTxHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  /** Chain ID the universe was deployed on (e.g. 11155111 for Sepolia, 84532 for Base Sepolia). */
  chainId: z.number().int().positive().optional(),
  /** Optional Unstoppable Domains name for this universe (e.g. "myuniverse.crypto"). */
  unstoppableDomain: z.string().max(100).nullish(),
});

const getUniverseSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

const getByCreatorSchema = z.object({
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid creator address'),
});

export const universesRouter = router({
  /** Generate a nonce for universe creation signatures */
  getNonce: publicProcedure.query(async () => {
    const nonce = await generateNonce();
    return { nonce };
  }),

  /** Create a new universe (wallet-based auth via signature + server nonce). */
  create: protectedProcedure.input(createUniverseSchema).mutation(async ({ input, ctx }) => {
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

    // Verify authenticated user matches the claimed creator
    if (input.creator.toLowerCase() !== ctx.user.uid.toLowerCase()) {
      throw new Error('Creator must match authenticated wallet');
    }

    // Verify the server-issued nonce is present in the message and hasn't been used
    if (!input.message.includes(input.nonce)) {
      throw new Error('Message must contain the server-issued nonce');
    }
    await consumeNonce(input.nonce);

    return await createUniverse({
      address: input.address,
      creator: input.creator,
      name: input.name,
      tokenAddress: input.tokenAddress,
      governanceAddress: input.governanceAddress,
      imageUrl: input.imageUrl,
      portraitImageUrl: input.portraitImageUrl,
      description: input.description,
      onChainUniverseId: input.onChainUniverseId,
      mintTxHash: input.mintTxHash,
      unstoppableDomain: input.unstoppableDomain ?? null,
      chainId: input.chainId,
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

  /** Discover universes with search, sorting, and pagination. */
  discover: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        sortBy: z.enum(['newest', 'oldest', 'name']).default('newest'),
        accessModel: z.enum(['open', 'subscription', 'token_gate', 'both']).optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const col = db.collection('cinematicUniverses');

      // Firestore query — order by created_at (only reliable server-side sort)
      let query = col.orderBy('created_at', input.sortBy === 'oldest' ? 'asc' : 'desc');

      // Access model filter (Firestore can handle this with the orderBy)
      if (input.accessModel) {
        query = col
          .where('accessModel', '==', input.accessModel)
          .orderBy('created_at', input.sortBy === 'oldest' ? 'asc' : 'desc');
      }

      // Cursor-based pagination
      if (input.cursor) {
        const cursorDoc = await col.doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      // Fetch extra for client-side filtering
      const fetchLimit = input.search ? 200 : input.limit + 1;
      const snapshot = await query.limit(fetchLimit).get();

      let items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];

      items = items.filter((u: any) => !u.isHidden);

      // Client-side search (Firestore doesn't support full-text)
      if (input.search) {
        const term = input.search.toLowerCase();
        items = items.filter(
          (u: any) =>
            u.name?.toLowerCase().includes(term) ||
            u.description?.toLowerCase().includes(term) ||
            u.id?.toLowerCase().includes(term)
        );
      }

      // Client-side sort by name if requested
      if (input.sortBy === 'name') {
        items.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
      }

      // Paginate
      const hasMore = items.length > input.limit;
      const pageItems = items.slice(0, input.limit);

      return {
        items: pageItems,
        nextCursor: hasMore ? pageItems[pageItems.length - 1]?.id : undefined,
        total: pageItems.length,
      };
    }),

  /** Get universes by creator address. */
  getByCreator: publicProcedure.input(getByCreatorSchema).query(async ({ input }) => {
    return await getUniversesByCreator(input.creator);
  }),

  /** Update token and governance addresses after token deployment (Step 2). */
  finalizeTokenDeployment: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
        governanceAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid governance address'),
        tokenDeployTxHash: z
          .string()
          .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid tx hash')
          .optional(),
        chainId: z.number().int().positive().optional(),
        poolId: z.string().optional(),
        hookAddress: z
          .string()
          .regex(/^0x[a-fA-F0-9]{40}$/)
          .optional(),
        lockerAddress: z
          .string()
          .regex(/^0x[a-fA-F0-9]{40}$/)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      if (!(await isUniverseAdmin(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can finalize token deployment');
      }

      const doc = await db.collection('cinematicUniverses').doc(universeId).get();
      if (!doc.exists) throw new Error('Universe not found');

      const updates: Record<string, any> = {
        tokenAddress: input.tokenAddress.toLowerCase(),
        governanceAddress: input.governanceAddress.toLowerCase(),
        tokenDeployTxHash: input.tokenDeployTxHash ?? null,
        updated_at: new Date(),
      };
      if (input.chainId) updates.chainId = input.chainId;
      if (input.poolId) updates.poolId = input.poolId;
      if (input.hookAddress) updates.hookAddress = input.hookAddress.toLowerCase();
      if (input.lockerAddress) updates.lockerAddress = input.lockerAddress.toLowerCase();

      await db.collection('cinematicUniverses').doc(universeId).update(updates);

      return { ok: true };
    }),

  /** Convert a universe to multi-sig ownership via a Safe wallet. */
  setMultiSig: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        multiSigAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Safe address'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      const callerUid = ctx.user.uid.toLowerCase();

      // Only the current creator can convert to multi-sig
      const doc = await db.collection('cinematicUniverses').doc(universeId).get();
      if (!doc.exists) throw new Error('Universe not found');

      const creator = (doc.data()?.creator as string | undefined)?.toLowerCase();
      if (creator !== callerUid) {
        throw new Error('Only the universe creator can enable multi-sig ownership');
      }

      // Verify the address is actually a Safe by reading its owners
      const safeInfo = await getSafeInfo(input.multiSigAddress);
      if (!safeInfo || safeInfo.owners.length === 0) {
        throw new Error('The provided address is not a valid Safe multi-sig wallet');
      }

      // Verify the caller is an owner of the Safe
      if (!safeInfo.owners.includes(callerUid)) {
        throw new Error('You must be an owner of the Safe wallet to enable multi-sig');
      }

      await db.collection('cinematicUniverses').doc(universeId).update({
        isMultiSig: true,
        multiSigAddress: input.multiSigAddress.toLowerCase(),
        creator: input.multiSigAddress.toLowerCase(),
        updated_at: new Date(),
      });

      return {
        ok: true,
        multiSigAddress: input.multiSigAddress.toLowerCase(),
        owners: safeInfo.owners,
        threshold: safeInfo.threshold,
      };
    }),

  /** Get multi-sig info for a universe (public). */
  getMultiSigInfo: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await db
        .collection('cinematicUniverses')
        .doc(input.universeId.toLowerCase())
        .get();
      if (!doc.exists) throw new Error('Universe not found');

      const data = doc.data()!;
      if (!data.isMultiSig || !data.multiSigAddress) {
        return { isMultiSig: false, multiSigAddress: null, owners: [], threshold: 0 };
      }

      const safeInfo = await getSafeInfo(data.multiSigAddress as string);
      return {
        isMultiSig: true,
        multiSigAddress: data.multiSigAddress,
        owners: safeInfo?.owners ?? [],
        threshold: safeInfo?.threshold ?? 0,
      };
    }),

  /** Set or clear an Unstoppable Domains name for a universe. Admin only. */
  setUnstoppableDomain: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        unstoppableDomain: z.string().max(100).nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      if (!(await isUniverseAdmin(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can set the domain');
      }
      await db.collection('cinematicUniverses').doc(universeId).update({
        unstoppableDomain: input.unstoppableDomain,
        updated_at: new Date(),
      });
      return { ok: true };
    }),

  /** Update the access model for a universe (admin only). */
  updateAccessModel: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        accessModel: z.enum(['open', 'subscription', 'token_gate', 'both']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      if (!(await isUniverseAdmin(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can update access settings');
      }

      await db.collection('cinematicUniverses').doc(universeId).update({
        accessModel: input.accessModel,
        updated_at: new Date(),
      });

      return { ok: true, accessModel: input.accessModel };
    }),

  /** Update universe metadata (name, image, description). Admin only. */
  updateMetadata: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        name: z.string().min(1).max(200).optional(),
        imageUrl: z.string().url('Invalid image URL').optional(),
        portraitImageUrl: z.string().url('Invalid portrait image URL').optional().nullable(),
        description: z.string().min(1).max(1000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      if (!(await isUniverseAdmin(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can update metadata');
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.imageUrl !== undefined) updates.image_url = input.imageUrl;
      if (input.portraitImageUrl !== undefined) updates.portrait_image_url = input.portraitImageUrl;
      if (input.description !== undefined) updates.description = input.description;

      await db.collection('cinematicUniverses').doc(universeId).update(updates);
      return { ok: true };
    }),

  /** Admin-only: list every universe (including hidden ones) for the admin dashboard. */
  adminList: adminProcedure.query(async () => {
    return await getAllUniverses({ includeHidden: true });
  }),

  /** Admin-only: soft-delete a universe by flipping its isHidden flag. */
  setHidden: adminProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        isHidden: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await setUniverseHidden(input.universeId, input.isHidden, {
        uid: ctx.user?.uid,
        address: ctx.user?.address,
      });
    }),

  /** Get the access model for a universe (public). */
  getAccessModel: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await db
        .collection('cinematicUniverses')
        .doc(input.universeId.toLowerCase())
        .get();
      if (!doc.exists) return { accessModel: 'open' };
      return { accessModel: doc.data()?.accessModel || 'open' };
    }),
});

export type UniversesRouter = typeof universesRouter;
