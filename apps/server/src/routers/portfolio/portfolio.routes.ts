/**
 * Portfolio Router — unified BFF aggregation endpoint for the mobile vault.
 *
 * PRD 2 requirement: "Create a unified portfolio endpoint or BFF layer that merges:
 *   - on-chain balances (via indexer queries)
 *   - Firestore profile/content records
 *   - subscription status
 *   - credits balance
 *   - marketplace state
 *   - revenue state"
 *
 * This is called once on portfolio load to reduce mobile round-trips.
 */
import { protectedProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

const creditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};
const subscriptionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('subscriptions');
};
const sandboxCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('sandboxDrafts');
};
const universesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('cinematicUniverses');
};
const nftMintsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodeNFTs');
};

export const portfolioRouter = router({
  /**
   * Unified portfolio summary — single endpoint for the mobile vault home screen.
   * Returns aggregated counts and balances in one round-trip.
   */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const uid = ctx.user.uid;
    const address = ctx.user.address?.toLowerCase();
    const now = new Date();

    const [
      creditsDoc,
      universesSnap,
      subscriptionsSnap,
      draftsSnap,
      nftMintsSnap,
    ] = await Promise.all([
      creditsCol().doc(uid).get(),
      address
        ? universesCol().where('creator', '==', address).get()
        : Promise.resolve(null),
      subscriptionsCol().where('uid', '==', uid).get(),
      sandboxCol().where('creatorAddress', '==', address ?? '').get(),
      nftMintsCol().where('creatorUid', '==', uid).get(),
    ]);

    // Credits
    const credits = creditsDoc.exists ? creditsDoc.data()! : {};
    const creditsBalance = (credits.balance as number) || 0;

    // Universes
    const universes = (universesSnap?.docs ?? []).map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    // Subscriptions
    const allSubs = subscriptionsSnap.docs.map((d) => d.data());
    const activeSubs = allSubs.filter(
      (s) => s.expiresAt?.toDate?.() > now
    );

    // Drafts
    const pendingDrafts = draftsSnap.docs.filter(
      (d) => d.data().status === 'draft'
    );

    // NFT listings (minted content)
    const nftCount = nftMintsSnap.docs.length;

    return {
      creditsBalance,
      totalCreditsSpent: (credits.totalSpent as number) || 0,

      universesOwned: universes.length,
      universes: universes.slice(0, 5).map((u: any) => ({
        id: u.id,
        address: u.address,
        creator: u.creator,
        description: u.description,
        imageUrl: u.imageUrl,
        tokenAddress: u.tokenAddress,
        governanceAddress: u.governanceAddress,
      })),

      activeSubscriptions: activeSubs.length,
      totalSubscriptions: allSubs.length,

      draftsCount: pendingDrafts.length,
      promotedDraftsCount: draftsSnap.docs.length - pendingDrafts.length,

      totalCollectibles: nftCount,

      // Revenue — placeholder until contract indexing is fully live
      pendingEarningsUsd: 0,
    };
  }),

  /**
   * Owned NFT listings for the mobile collection grid.
   * Returns episode NFTs created by this user with full metadata.
   */
  myCollectibles: protectedProcedure.query(async ({ ctx }) => {
    const snap = await nftMintsCol()
      .where('creatorUid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        contentId: data.contentId as string,
        universeId: (data.universeId as string) || null,
        title: data.title as string,
        description: (data.description as string) || '',
        mediaUrl: data.mediaUrl as string,
        thumbnailUrl: (data.thumbnailUrl as string) || null,
        mediaType: data.mediaType as string,
        ipfsUrl: (data.ipfsUrl as string) || null,
        mintPrice: data.mintPrice as string,
        maxSupply: data.maxSupply as number,
        royaltyBps: data.royaltyBps as number,
        minted: data.minted as number,
        active: data.active as boolean,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
      };
    });
  }),
});
