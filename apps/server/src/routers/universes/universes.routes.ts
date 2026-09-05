/**
 * Universes router — CRUD operations for universe metadata in Firestore.
 * Uses wallet signature verification (not Firebase auth) for create operations.
 *
 * Renamed from cinematicUniverses to align with domain naming conventions.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
  isAdminAddress,
} from '../../lib/trpc';
import {
  createUniverse,
  getUniverse,
  getAllUniverses,
  getUniversesByCreator,
  getEditableUniversesForUser,
  setUniverseHidden,
  setUniversePrivate,
  deleteUniverse,
} from './universes.handlers';
import { isUniverseAdmin, isUniverseAdminStrict, getSafeInfo } from '../../lib/safe-admin';
import { isEvmAddress, normalizeUniverseId } from '../../lib/universe-id';
import { getUserSolanaWallet } from '../../lib/circle-solana';
import { db } from '../../lib/firebase';
import { generateNonce, consumeNonce } from '../../lib/siwe';
import { getPlatformConfig } from '../../services/platformConfig';
import { assertFeatureEnabledOrForbidden } from '../../lib/feature-guards';
import { awardUniverseCreationPoints } from '../../services/points';

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
  /** Chain ID the universe was deployed on (e.g. 11155111 for Sepolia, 1 for Ethereum mainnet). */
  chainId: z.number().int().positive().optional(),
  /** Optional Unstoppable Domains name for this universe (e.g. "myuniverse.crypto"). */
  unstoppableDomain: z.string().max(100).nullish(),
  /** 'fun' starts private (owner must Launch Publicly); 'monetized' is public from mint. */
  universeType: z.enum(['fun', 'monetized']).default('monetized'),
});

const getUniverseSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

const getByCreatorSchema = z.object({
  creator: z
    .string()
    .regex(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, 'Invalid creator address'),
});

export const universesRouter = router({
  /** Generate a nonce for universe creation signatures */
  getNonce: publicProcedure.query(async () => {
    const nonce = await generateNonce();
    return { nonce };
  }),

  /** Create a new universe (wallet-based auth via signature + server nonce). */
  create: protectedProcedure.input(createUniverseSchema).mutation(async ({ input, ctx }) => {
    await assertFeatureEnabledOrForbidden('minting');

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

    const result = await createUniverse({
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
      universeType: input.universeType,
    });

    void import('../../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('universe:created', {
        distinctId: input.creator,
        universeAddress: input.address,
        name: input.name,
        chainId: input.chainId,
      })
    );

    // Points bonus for creating a universe. Idempotent per address,
    // never throws — a points failure must not fail universe creation.
    void awardUniverseCreationPoints(ctx.user.uid, input.address);

    return result;
  }),

  /** Get a specific universe by ID. Private universes are hidden from non-owners. */
  get: publicProcedure.input(getUniverseSchema).query(async ({ input, ctx }) => {
    const result = await getUniverse(input.id);
    const data = (result as any)?.data ?? {};
    const viewer = ctx.user?.address?.toLowerCase();
    const creator = (data.creator as string | undefined)?.toLowerCase();
    const isOwner = !!viewer && !!creator && viewer === creator;
    if (!isOwner && (data.isHidden || data.isPrivate)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
    }
    return result;
  }),

  /** Get all universes. Private universes appear only for the viewing owner. */
  getAll: publicProcedure.query(async ({ ctx }) => {
    return await getAllUniverses({ viewerAddress: ctx.user?.address });
  }),

  /**
   * Admin-curated universe addresses (in order) pinned to the front of the
   * homepage hero billboard and scrolling activity ticker. Public — this is
   * the only slice of `platformConfig` safe to expose to unauthenticated
   * visitors; everything else in that doc stays behind `admin.getConfig`.
   */
  getFeatured: publicProcedure.query(async () => {
    const cfg = await getPlatformConfig();
    return { featuredUniverseIds: cfg.featuredUniverseIds ?? [] };
  }),

  /** Discover universes with search, sorting, and pagination. */
  discover: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        sortBy: z.enum(['newest', 'oldest', 'name']).default('newest'),
        accessModel: z.enum(['open', 'subscription', 'token_gate', 'both']).optional(),
        universeType: z.enum(['fun', 'monetized']).optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
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

      const viewer = ctx.user?.address?.toLowerCase();
      items = items.filter(
        (u: any) => !u.isHidden && (!u.isPrivate || (viewer && u.creator?.toLowerCase() === viewer))
      );

      // Client-side filter — universeType is stored on a per-doc basis and may be missing
      // on legacy records, in which case it defaults to 'monetized' (pre-label behavior).
      if (input.universeType) {
        items = items.filter((u: any) => (u.universeType || 'monetized') === input.universeType);
      }

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

  /**
   * Get universes by creator address. Owner sees their private universes;
   * others do not.
   *
   * When the caller is asking about their own connected EVM address, also
   * merges in universes created by their Circle-managed Solana wallet.
   * Solana universes are minted server-side under a per-user Circle wallet
   * (see initializeSolanaUniverse) that the connected EVM wallet never
   * signs for — without this, they'd be invisible in Studio even though the
   * same account owns them.
   */
  getByCreator: publicProcedure.input(getByCreatorSchema).query(async ({ input, ctx }) => {
    const result = await getUniversesByCreator(input.creator, {
      viewerAddress: ctx.user?.address,
    });

    const askingAboutSelf =
      !!ctx.user?.uid &&
      !!ctx.user.address &&
      isEvmAddress(input.creator) &&
      input.creator.toLowerCase() === ctx.user.address.toLowerCase();

    if (askingAboutSelf && result.success) {
      try {
        const solanaWallet = await getUserSolanaWallet(ctx.user!.uid);
        if (solanaWallet?.address) {
          // viewerAddress = the Solana wallet itself: we derived it
          // server-side from the caller's own session uid, so it's
          // established as theirs without trusting any client input.
          const solanaResult = await getUniversesByCreator(solanaWallet.address, {
            viewerAddress: solanaWallet.address,
          });
          if (solanaResult.success) {
            const seen = new Set(result.data.map((u: any) => u.id));
            for (const u of solanaResult.data) {
              if (!seen.has(u.id)) {
                result.data.push(u);
                seen.add(u.id);
              }
            }
            result.total = result.data.length;
          }
        }
      } catch (err) {
        console.warn('[getByCreator] Solana wallet lookup failed:', err);
      }
    }

    return result;
  }),

  /**
   * Returns every universe the authenticated wallet can edit — union of
   * creator, Safe multi-sig signer, and active team member. Each item carries
   * a `roles` array describing how the caller has access.
   */
  getEditableByMe: protectedProcedure.query(async ({ ctx }) => {
    return await getEditableUniversesForUser(ctx.user.uid);
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
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
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
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
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

      // Snapshot the previous EOA creator so the disable path can restore
      // ownership if the Safe wiring turns out to be wrong (typo, contract
      // not actually a Safe, lost owner key). Without a snapshot the
      // multi-sig conversion is irreversible.
      await db
        .collection('cinematicUniverses')
        .doc(universeId)
        .update({
          isMultiSig: true,
          multiSigAddress: input.multiSigAddress.toLowerCase(),
          multiSigOwners: safeInfo.owners.map((o) => o.toLowerCase()),
          multiSigOwnersUpdatedAt: new Date(),
          creator: input.multiSigAddress.toLowerCase(),
          previousCreatorEoa: callerUid,
          multiSigEnabledAt: new Date(),
          updated_at: new Date(),
        });

      return {
        ok: true,
        multiSigAddress: input.multiSigAddress.toLowerCase(),
        owners: safeInfo.owners,
        threshold: safeInfo.threshold,
      };
    }),

  /** Disable multi-sig and restore the original EOA creator. Callable only by
   *  a current Safe owner — protects against accidental EOA seizure of a
   *  legitimate multi-sig universe while still providing an escape hatch when
   *  the Safe wiring is broken. */
  disableMultiSig: protectedProcedure
    .input(z.object({ universeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
      const callerUid = ctx.user.uid.toLowerCase();

      const doc = await db.collection('cinematicUniverses').doc(universeId).get();
      if (!doc.exists) throw new Error('Universe not found');
      const data = doc.data()!;
      if (!data.isMultiSig || !data.multiSigAddress) {
        throw new Error('Universe is not in multi-sig mode');
      }
      const previousCreator = (data.previousCreatorEoa as string | undefined)?.toLowerCase();
      if (!previousCreator) {
        throw new Error('No prior EOA creator recorded — cannot disable multi-sig safely');
      }

      // Authorize the caller — must be a current Safe owner. If the Safe is
      // unreachable (provider failing) we accept the original creator as a
      // last-resort recovery path so a flaky RPC doesn't permanently lock
      // the universe.
      const safeInfo = await getSafeInfo(data.multiSigAddress as string);
      const isSafeOwner = safeInfo?.owners?.includes(callerUid) ?? false;
      const isOriginalCreator = previousCreator === callerUid;
      if (!isSafeOwner && !isOriginalCreator) {
        throw new Error('Only a Safe owner or the original creator can disable multi-sig');
      }

      await db.collection('cinematicUniverses').doc(universeId).update({
        isMultiSig: false,
        multiSigAddress: null,
        multiSigOwners: [],
        multiSigOwnersUpdatedAt: new Date(),
        creator: previousCreator,
        multiSigDisabledAt: new Date(),
        updated_at: new Date(),
      });

      // Audit log so this admin reversal is traceable.
      await db.collection('contentAuditLog').add({
        kind: 'multisig.disable',
        universeId,
        actor: callerUid,
        previousCreator,
        previousMultiSig: (data.multiSigAddress as string).toLowerCase(),
        recoveryPath: isSafeOwner ? 'safe_owner' : 'original_creator',
        createdAt: new Date(),
      });

      return { ok: true, restoredCreator: previousCreator };
    }),

  /**
   * Resolve admin info for a universe from the server-side Firestore record +
   * server RPC. Used by the web `useIsUniverseAdmin` hook so UI gating does
   * not depend on the user's wallet RPC provider (which is frequently rate
   * limited on public Sepolia / mainnet endpoints).
   *
   * Returns a consistent shape for both EOA and Safe multi-sig admins. When
   * `address` is omitted, `isAdmin` is always false but the rest of the
   * fields are populated (so callers can still render Safe metadata).
   */
  adminInfo: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        address: z
          .string()
          .regex(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, 'Invalid address')
          .optional(),
      })
    )
    .query(async ({ input }) => {
      // EVM ids/addresses are case-insensitive; Solana base58 ones are not.
      const id = normalizeUniverseId(input.universeId);
      const evmCaller = !!input.address && isEvmAddress(input.address);
      const caller = evmCaller ? input.address!.toLowerCase() : input.address;
      // Platform admins (ADMIN_ADDRESSES / ADMIN_WALLET) can edit any
      // universe — mirror the override in `isUniverseAdmin` so the profile
      // editor's owner gate opens for them too.
      const isPlatformAdmin = isAdminAddress(caller);

      const doc = await db.collection('cinematicUniverses').doc(id).get();
      if (!doc.exists) {
        return {
          isAdmin: false,
          isSafe: false,
          adminAddress: undefined as string | undefined,
          safeAddress: undefined as string | undefined,
          owners: [] as string[],
          threshold: 0,
        };
      }

      const data = doc.data()!;
      const creatorRaw = data.creator as string | undefined;
      // Match the caller's casing convention: lowercase for EVM, verbatim for
      // a base58 Solana creator.
      const creator = evmCaller ? creatorRaw?.toLowerCase() : creatorRaw;
      const chainId = data.chainId as number | undefined;

      if (data.isMultiSig && data.multiSigAddress) {
        const safeAddress = (data.multiSigAddress as string).toLowerCase();
        const safeInfo = await getSafeInfo(safeAddress, chainId);
        const owners = safeInfo?.owners ?? [];
        const threshold = safeInfo?.threshold ?? 0;
        const isAdmin =
          isPlatformAdmin || (!!caller && (caller === creator || owners.includes(caller)));
        return {
          isAdmin,
          isSafe: true,
          adminAddress: safeAddress,
          safeAddress,
          owners,
          threshold,
        };
      }

      return {
        isAdmin: isPlatformAdmin || (!!caller && caller === creator),
        isSafe: false,
        adminAddress: creator,
        safeAddress: undefined as string | undefined,
        owners: [] as string[],
        threshold: 0,
      };
    }),

  /** Get multi-sig info for a universe (public). */
  getMultiSigInfo: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await db
        .collection('cinematicUniverses')
        .doc(normalizeUniverseId(input.universeId))
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
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
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
      // INF-5: access model switches control token-gate / subscription
      // revenue paths — strict on-chain owner check required.
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
      if (!(await isUniverseAdminStrict(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can update access settings');
      }

      await db.collection('cinematicUniverses').doc(universeId).update({
        accessModel: input.accessModel,
        updated_at: new Date(),
      });

      return { ok: true, accessModel: input.accessModel };
    }),

  /**
   * Update off-chain universe profile metadata. Editable by the universe
   * creator or any current Safe multi-sig signer (via `isUniverseAdmin`).
   * Universes that have been hidden by platform moderation cannot be edited
   * — the takedown queue must clear `isHidden` first (PRD 10).
   */
  updateMetadata: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        name: z.string().min(1).max(200).optional(),
        imageUrl: z.string().url('Invalid image URL').optional(),
        portraitImageUrl: z.string().url('Invalid portrait image URL').optional().nullable(),
        description: z.string().min(1).max(4000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
      // `ctx.user.uid` is the lowercased subject — fine for EVM (creator is
      // stored lowercased) but lossy for a base58 Solana wallet. Prefer the
      // verbatim address so the Solana creator check can match.
      const caller = ctx.user.address ?? ctx.user.uid;
      if (!(await isUniverseAdmin(universeId, caller))) {
        throw new Error('Only the universe admin can update metadata');
      }

      const doc = await db.collection('cinematicUniverses').doc(universeId).get();
      if (!doc.exists) throw new Error('Universe not found');
      if (doc.data()?.isHidden) {
        throw new Error('This universe is under moderation review and cannot be edited');
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

  /**
   * Owner-controlled: toggle the universe's `isPrivate` flag. Hides the
   * universe + all of its linked content (gallery, entities, featured, etc.)
   * from every public surface. The owner still sees their own content.
   *
   * Allowed callers: the universe creator, or a signer of the multi-sig Safe
   * if the universe is multi-sig owned. Enforced via `isUniverseAdmin`.
   */
  setPrivate: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        isPrivate: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // INF-5: privacy flips can hide monetized content from buyers. Strict check.
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
      if (!(await isUniverseAdminStrict(universeId, ctx.user.uid))) {
        throw new Error('Only the universe creator can change privacy');
      }

      // Monetized (launchpad) universes are always public. Letting an admin
      // flip one private post-launch would unlist a trading token.
      const doc = await db.collection('cinematicUniverses').doc(universeId).get();
      const universeType =
        (doc.data()?.universeType as 'fun' | 'monetized' | undefined) ?? 'monetized';
      if (universeType === 'monetized' && input.isPrivate) {
        throw new Error('Launchpad universes are always public');
      }

      return await setUniversePrivate(universeId, input.isPrivate, {
        uid: ctx.user?.uid,
        address: ctx.user?.address,
      });
    }),

  /**
   * Admin-only: permanently delete a universe's Firestore doc. The on-chain
   * contract remains; gallery content keeps its `universeId` reference but
   * the universe itself disappears from every listing. Irreversible — prefer
   * `setHidden` unless the universe needs to be fully removed (abuse, spam).
   */
  adminDelete: adminProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await deleteUniverse(
        input.universeId,
        { uid: ctx.user?.uid, address: ctx.user?.address },
        input.reason
      );
    }),

  /** Get the access model for a universe (public). */
  getAccessModel: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await db
        .collection('cinematicUniverses')
        .doc(normalizeUniverseId(input.universeId))
        .get();
      if (!doc.exists) return { accessModel: 'open' };
      return { accessModel: doc.data()?.accessModel || 'open' };
    }),

  /**
   * Set the universe label as 'fun' (sandbox / no monetization) or 'monetized'
   * (revenue-bearing). Admin-only. Pure label for now — does not gate any
   * commercial transactions.
   */
  setUniverseType: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        universeType: z.enum(['fun', 'monetized']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // INF-5: universeType flip (fun → monetized) unlocks the revenue
      // mode — treat it like a treasury action and require strict admin.
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
      if (!(await isUniverseAdminStrict(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can update the universe type');
      }

      await db.collection('cinematicUniverses').doc(universeId).update({
        universeType: input.universeType,
        updated_at: new Date(),
      });

      return { ok: true, universeType: input.universeType };
    }),

  /** Get the universe type label (public). Defaults to 'monetized' for legacy docs. */
  getUniverseType: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await db
        .collection('cinematicUniverses')
        .doc(normalizeUniverseId(input.universeId))
        .get();
      if (!doc.exists) return { universeType: 'monetized' as const };
      return {
        universeType: (doc.data()?.universeType as 'fun' | 'monetized') || 'monetized',
      };
    }),

  /**
   * Mark a style_pack entity as the universe's official canon style (admin only).
   * Passing `null` clears the canon designation. The referenced entity is not
   * verified to be a style_pack here — admins are trusted, and swapping kinds
   * would just surface as a no-op in the style composer.
   */
  setCanonStylePack: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        stylePackEntityId: z.string().min(1).nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // EVM ids are stored lowercased; Solana base58 PDAs are case-sensitive.
      const universeId = normalizeUniverseId(input.universeId);
      if (!(await isUniverseAdmin(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can set the canon style pack');
      }

      if (input.stylePackEntityId) {
        const entityDoc = await db.collection('entities').doc(input.stylePackEntityId).get();
        if (!entityDoc.exists) {
          throw new Error('Style pack entity not found');
        }
        if (entityDoc.data()?.kind !== 'style_pack') {
          throw new Error('Selected entity is not a style_pack');
        }
      }

      await db.collection('cinematicUniverses').doc(universeId).update({
        canonStylePackEntityId: input.stylePackEntityId,
        canonStylePackUpdatedAt: new Date(),
        canonStylePackUpdatedBy: ctx.user.uid,
        updated_at: new Date(),
      });

      return { ok: true, canonStylePackEntityId: input.stylePackEntityId };
    }),

  /** Public read of the canon style pack entity id for a universe. */
  getCanonStylePack: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await db
        .collection('cinematicUniverses')
        .doc(normalizeUniverseId(input.universeId))
        .get();
      if (!doc.exists) return { canonStylePackEntityId: null };
      return {
        canonStylePackEntityId:
          (doc.data()?.canonStylePackEntityId as string | null | undefined) ?? null,
      };
    }),
});

export type UniversesRouter = typeof universesRouter;
