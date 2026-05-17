/**
 * Listings Router — Unified marketplace aggregation layer
 *
 * Abstracts across all product types (NFT, subscription, merch, license, etc.)
 * into a single listing model for mobile browse/buy/sell flows.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { createPublicClient, http, parseEther, type Hash } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { throwApiError } from '../../lib/errors';
import { recordRevenueEvent } from '../../services/revenue-recorder';
import { resolveActingUid } from '../../services/agentAuth';
import { assertContentOperable, assertCanonReadyForMonetization } from '../../lib/content-status';

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});
const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});
function getChainClient(chainId?: number) {
  if (chainId === baseSepolia.id) return baseSepoliaClient;
  return sepoliaClient;
}

export const PRODUCT_TYPES = [
  'EPISODE_NFT',
  'CHARACTER_NFT',
  'ARTIFACT',
  'SUBSCRIPTION_TIER',
  'CANON_LICENSE',
  'MERCH',
  'SPONSORED_SLOT',
  'IP_LICENSE',
] as const;

export const CURRENCIES = ['ETH', 'LOAR', 'CREDITS', 'USD'] as const;
export const RIGHTS_LANES = ['fan', 'original', 'licensed'] as const;
export const LISTING_STATUSES = ['DRAFT', 'ACTIVE', 'SOLD_OUT', 'DELISTED'] as const;

const listingsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('listings');
};

const ordersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('orders');
};

export const listingsRouter = router({
  /** Browse all active listings with filters and pagination */
  browse: publicProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        productType: z.enum(PRODUCT_TYPES).optional(),
        rightsLane: z.enum(RIGHTS_LANES).optional(),
        search: z.string().optional(),
        sortBy: z.enum(['newest', 'price_asc', 'price_desc', 'popular']).default('newest'),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      if (!db) return { listings: [], nextCursor: null };

      let q: FirebaseFirestore.Query = listingsCol().where('status', '==', 'ACTIVE');

      if (input.universeId) q = q.where('universeId', '==', input.universeId);
      if (input.productType) q = q.where('productType', '==', input.productType);
      if (input.rightsLane) q = q.where('rightsLane', '==', input.rightsLane);

      if (input.sortBy === 'price_asc') q = q.orderBy('priceNum', 'asc');
      else if (input.sortBy === 'price_desc') q = q.orderBy('priceNum', 'desc');
      else if (input.sortBy === 'popular') q = q.orderBy('sold', 'desc');
      else q = q.orderBy('createdAt', 'desc');

      if (input.cursor) q = q.startAfter(input.cursor);
      q = q.limit(input.limit + 1);

      const snap = await q.get();
      let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];

      if (input.search) {
        const s = input.search.toLowerCase();
        docs = docs.filter(
          (d) =>
            String(d.title ?? '')
              .toLowerCase()
              .includes(s) ||
            String(d.description ?? '')
              .toLowerCase()
              .includes(s)
        );
      }

      const hasMore = docs.length > input.limit;
      const results = docs.slice(0, input.limit);
      const nextCursor = hasMore ? String(snap.docs[input.limit - 1].id) : null;

      return { listings: results, nextCursor };
    }),

  /** Get a single listing by ID */
  get: publicProcedure.input(z.object({ listingId: z.string() })).query(async ({ input }) => {
    if (!db) throwApiError('INTERNAL_SERVER_ERROR', 'Firebase not configured');
    const doc = await listingsCol().doc(input.listingId).get();
    if (!doc.exists) throwApiError('NOT_FOUND', 'Listing not found');
    return { id: doc.id, ...doc.data() };
  }),

  /** Create a new listing (DRAFT or ACTIVE) */
  create: protectedProcedure
    .input(
      z.object({
        productType: z.enum(PRODUCT_TYPES),
        assetRef: z.string().nullable().default(null),
        universeId: z.string().nullable().default(null),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).default(''),
        mediaUrl: z.string().url().nullable().default(null),
        thumbnailUrl: z.string().url().nullable().default(null),
        price: z.string().default('0'),
        currency: z.enum(CURRENCIES).default('ETH'),
        supply: z.number().min(0).default(0),
        rightsLane: z.enum(RIGHTS_LANES).default('original'),
        royaltyBps: z.number().min(0).max(10000).default(500),
        publishImmediately: z.boolean().default(false),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throwApiError('INTERNAL_SERVER_ERROR', 'Firebase not configured');

      const { onBehalfOfUid, ...listingInput } = input;
      const { actingUid } = await resolveActingUid(ctx.user.uid, onBehalfOfUid, 'listings');

      // Block listing of moderated content
      if (listingInput.assetRef) {
        await assertContentOperable(listingInput.assetRef);
        await assertCanonReadyForMonetization(listingInput.assetRef);
      }

      const now = new Date();
      const listing = {
        ...listingInput,
        sellerUid: actingUid,
        sellerAddress: ctx.user.address ?? null,
        sold: 0,
        priceNum: parseFloat(listingInput.price) || 0,
        status: listingInput.publishImmediately ? 'ACTIVE' : 'DRAFT',
        createdAt: now,
        updatedAt: now,
      };

      const ref = await listingsCol().add(listing);
      return { id: ref.id, ...listing };
    }),

  /** Seller: get my own listings */
  myListings: protectedProcedure
    .input(
      z.object({
        status: z.enum([...LISTING_STATUSES, 'ALL']).default('ALL'),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!db) return [];
      let q: FirebaseFirestore.Query = listingsCol()
        .where('sellerUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc');
      if (input.status !== 'ALL') q = q.where('status', '==', input.status);
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /** Update a listing (seller only) */
  update: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        mediaUrl: z.string().url().nullable().optional(),
        thumbnailUrl: z.string().url().nullable().optional(),
        price: z.string().optional(),
        currency: z.enum(CURRENCIES).optional(),
        supply: z.number().min(0).optional(),
        rightsLane: z.enum(RIGHTS_LANES).optional(),
        royaltyBps: z.number().min(0).max(10000).optional(),
        status: z.enum(LISTING_STATUSES).optional(),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throwApiError('INTERNAL_SERVER_ERROR', 'Firebase not configured');
      const { listingId, onBehalfOfUid, ...changes } = input;
      const { actingUid } = await resolveActingUid(ctx.user.uid, onBehalfOfUid, 'listings');

      const ref = listingsCol().doc(listingId);
      const doc = await ref.get();
      if (!doc.exists) throwApiError('NOT_FOUND', 'Listing not found');
      if (doc.data()?.sellerUid !== actingUid) throwApiError('FORBIDDEN', 'Not your listing');

      const updates: Record<string, unknown> = { ...changes, updatedAt: new Date() };
      if (changes.price !== undefined) updates.priceNum = parseFloat(changes.price) || 0;

      await ref.update(updates);
      return { ok: true };
    }),

  /** Delist a listing (seller only) */
  delist: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throwApiError('INTERNAL_SERVER_ERROR', 'Firebase not configured');
      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'listings');
      const ref = listingsCol().doc(input.listingId);
      const doc = await ref.get();
      if (!doc.exists) throwApiError('NOT_FOUND', 'Listing not found');
      if (doc.data()?.sellerUid !== actingUid) throwApiError('FORBIDDEN', 'Not your listing');
      await ref.update({ status: 'DELISTED', updatedAt: new Date() });
      return { ok: true };
    }),

  /** Unified purchase — records order, increments sold counter */
  purchase: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        quantity: z.number().min(1).default(1),
        txHash: z.string().optional(),
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throwApiError('INTERNAL_SERVER_ERROR', 'Firebase not configured');

      const listingRef = listingsCol().doc(input.listingId);
      const listingDoc = await listingRef.get();
      if (!listingDoc.exists) throwApiError('NOT_FOUND', 'Listing not found');

      const listing = listingDoc.data()!;
      if (listing.status !== 'ACTIVE') throwApiError('BAD_REQUEST', 'Listing is not active');
      if (listing.rightsLane === 'fan') {
        throwApiError('BAD_REQUEST', 'Non-commercial (fan) content cannot be purchased');
      }
      if (listing.supply > 0 && listing.sold + input.quantity > listing.supply) {
        throwApiError('BAD_REQUEST', 'Insufficient supply');
      }

      // Block direct ETH/LOAR purchases that bypass a smart contract.
      // Until an escrow or PaymentRouter integration is live, direct transfers
      // to seller EOAs are unsafe (no refund path, no dispute mechanism).
      // Only allow: free claims, CREDITS purchases, and contract-based NFT mints.
      if (
        (listing.currency === 'ETH' || listing.currency === 'LOAR') &&
        parseFloat(listing.price) > 0 &&
        !listing.contractAddress
      ) {
        throwApiError(
          'BAD_REQUEST',
          'Direct ETH/LOAR purchases are temporarily disabled. Purchases must go through a smart contract (e.g. NFT mint). This listing needs a contract address configured.'
        );
      }

      // Verify on-chain payment for ETH-denominated listings
      if (listing.currency === 'ETH' && input.txHash) {
        // Dedup: reject if this txHash was already used for another order
        const existingOrder = await ordersCol().where('txHash', '==', input.txHash).limit(1).get();
        if (!existingOrder.empty) {
          throwApiError('BAD_REQUEST', 'This transaction has already been used for a purchase');
        }

        try {
          const client = getChainClient(input.chainId);
          const tx = await client.getTransaction({ hash: input.txHash as Hash });
          const receipt = await client.getTransactionReceipt({ hash: input.txHash as Hash });

          if (receipt.status !== 'success') {
            throwApiError('BAD_REQUEST', 'Payment transaction was reverted on-chain');
          }

          // Verify the seller received the payment (seller address or listing-specified recipient)
          const expectedRecipient = (listing.sellerAddress ?? listing.sellerUid)?.toLowerCase();
          if (expectedRecipient && tx.to?.toLowerCase() !== expectedRecipient) {
            throwApiError('BAD_REQUEST', 'Payment was not sent to the expected recipient');
          }

          // Verify minimum amount (listing price × quantity, 1% tolerance for gas)
          if (listing.price > 0) {
            const expectedWei = parseEther(String(listing.price * input.quantity));
            const minRequired = (expectedWei * 99n) / 100n;
            if (tx.value < minRequired) {
              throwApiError(
                'BAD_REQUEST',
                `Insufficient payment. Expected ~${expectedWei.toString()} wei, got ${tx.value.toString()} wei`
              );
            }
          }
        } catch (err: any) {
          if (err?.code) throw err; // Re-throw our own API errors
          throwApiError('BAD_REQUEST', 'Payment transaction not found on-chain');
        }
      } else if (listing.currency === 'ETH' && !input.txHash) {
        throwApiError('BAD_REQUEST', 'ETH purchases require a transaction hash');
      }

      // Atomic: re-validate listing state + create order + update sold counter
      // in a single transaction to prevent price manipulation and quantity oversell.
      const now = new Date();
      const result = await db.runTransaction(async (tx) => {
        const freshListingDoc = await tx.get(listingRef);
        if (!freshListingDoc.exists) throw new Error('Listing not found');
        const freshListing = freshListingDoc.data()!;

        // Re-validate inside transaction (listing may have changed since initial read)
        if (freshListing.status !== 'ACTIVE') throw new Error('Listing is no longer active');
        if (
          freshListing.supply > 0 &&
          (freshListing.sold ?? 0) + input.quantity > freshListing.supply
        ) {
          throw new Error('Insufficient supply');
        }

        const order = {
          listingId: input.listingId,
          buyerUid: ctx.user.uid,
          buyerAddress: ctx.user.address ?? null,
          sellerUid: freshListing.sellerUid,
          productType: freshListing.productType,
          universeId: freshListing.universeId,
          title: freshListing.title,
          thumbnailUrl: freshListing.thumbnailUrl ?? null,
          price: freshListing.price,
          currency: freshListing.currency,
          quantity: input.quantity,
          txHash: input.txHash ?? null,
          status: 'COMPLETED',
          createdAt: now,
        };

        const orderRef = ordersCol().doc();
        tx.set(orderRef, order);

        const newSold = (freshListing.sold ?? 0) + input.quantity;
        const newStatus =
          freshListing.supply > 0 && newSold >= freshListing.supply
            ? 'SOLD_OUT'
            : freshListing.status;
        tx.update(listingRef, { sold: newSold, status: newStatus, updatedAt: now });

        return { orderId: orderRef.id, ...order };
      });

      // Auto-record revenue for the seller
      const revenueSource =
        result.productType === 'MERCH'
          ? 'merch'
          : result.productType === 'CANON_LICENSE'
            ? 'canon_royalties'
            : result.productType === 'IP_LICENSE'
              ? 'licensing'
              : result.productType === 'SUBSCRIPTION_TIER'
                ? 'subscriptions'
                : ('nft_sales' as const);

      recordRevenueEvent({
        creatorUid: result.sellerUid,
        source: revenueSource,
        amountWei: result.price?.toString() ?? '0',
        universeId: result.universeId,
        metadata: { listingId: input.listingId, orderId: result.orderId },
      }).catch(() => {});

      return result;
    }),

  /** Get a single order (buyer or seller only) */
  getOrder: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!db) throwApiError('INTERNAL_SERVER_ERROR', 'Firebase not configured');
      const doc = await ordersCol().doc(input.orderId).get();
      if (!doc.exists) throwApiError('NOT_FOUND', 'Order not found');
      const order = doc.data()!;
      if (order.buyerUid !== ctx.user.uid && order.sellerUid !== ctx.user.uid) {
        throwApiError('FORBIDDEN', 'Access denied');
      }
      return { id: doc.id, ...order };
    }),

  /** Seller earnings and activity summary */
  sellerStats: protectedProcedure.query(async ({ ctx }) => {
    if (!db) {
      return {
        totalEarnings: '0',
        totalSold: 0,
        activeListings: 0,
        draftListings: 0,
        recentOrders: [] as unknown[],
      };
    }

    const [listingsSnap, ordersSnap] = await Promise.all([
      listingsCol().where('sellerUid', '==', ctx.user.uid).get(),
      ordersCol()
        .where('sellerUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get(),
    ]);

    const listings = listingsSnap.docs.map((d) => d.data());
    const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const activeListings = listings.filter((l) => l.status === 'ACTIVE').length;
    const draftListings = listings.filter((l) => l.status === 'DRAFT').length;
    const totalSold = listings.reduce((sum, l) => sum + ((l.sold as number) || 0), 0);

    const totalEarnings = orders
      .filter((o) => (o as any).currency === 'ETH' || (o as any).currency === 'LOAR')
      .reduce(
        (sum, o) => sum + parseFloat(String((o as any).price ?? '0')) * ((o as any).quantity ?? 1),
        0
      )
      .toString();

    return { totalEarnings, totalSold, activeListings, draftListings, recentOrders: orders };
  }),

  /** Public: all active listings for a universe storefront */
  universeStorefront: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      if (!db) return { listings: [] };
      const snap = await listingsCol()
        .where('universeId', '==', input.universeId)
        .where('status', '==', 'ACTIVE')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      const listings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return { listings };
    }),
});
