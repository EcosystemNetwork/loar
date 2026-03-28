/**
 * Root tRPC Router — clean aggregator of all domain sub-routers.
 *
 * Domain structure:
 *   universes      — Universe CRUD, team, treasury, collabs
 *   content        — User content CRUD, wiki/lore generation
 *   generation     — AI video generation (smart routing), image generation
 *   marketplace    — Canon submissions, voting, NFT listings
 *   credits        — Credit packages, balances, spend/purchase
 *   subscriptions  — Universe subscription tiers
 *   analytics      — Views, engagement, trending, wallet tracking
 *   ads            — Ad slots, sponsorships, bidding
 *   licensing      — IP licensing, merch, royalties
 *   storage        — Unified storage, Firebase Storage, Filecoin Synapse
 *   profiles       — User profiles, discovery
 *   entities       — Universe entities (characters, locations, items)
 *   quests         — Quest system, affiliates, daily check-ins
 *   sandbox        — Draft creations
 *   admin          — Platform config, fee management
 *
 * See docs/api.md for the full router inventory, auth matrix, and examples.
 */
import { publicProcedure, protectedProcedure, router } from '../lib/trpc';
import { z } from 'zod';
import { db, firebaseAvailable } from '../lib/firebase';

// ── Domain routers ──────────────────────────────────────────────────────
import { universesRouter } from './universes/universes.routes';
import { cinematicUniversesRouter } from './cinematicUniverses/cinematicUniverses.index'; // @deprecated alias
import { contentRouter } from './content/content.routes';
import { wikiRouter } from './content/wiki.routes';
import { generationRouter } from './generation/generation.routes';
import { imageRouter } from './generation/image.routes';
import { falRouter } from './fal/fal.routes'; // @deprecated — use generation.* + image.*
import { marketplaceRouter } from './marketplace/marketplace.routes';
import { nftRouter } from './nft/nft.routes';
import { listingsRouter } from './listings/listings.routes';
import { creditsRouter } from './credits/credits.routes';
import { subscriptionsRouter } from './subscriptions/subscriptions.routes';
import { analyticsRouter } from './analytics/analytics.routes';
import { adsRouter } from './ads/ads.routes';
import { licensingRouter } from './licensing/licensing.routes';
import { storageRouter } from './storage/storage.routes';
import { firebaseStorageRouter } from './storage/firebase.routes';
import { synapseRouter } from './storage/synapse.routes';
import { profilesRouter } from './profiles/profiles.routes';
import { entitiesRouter } from './entities/entities.index';
import { questsRouter } from './quests/quests.routes';
import { sandboxRouter } from './sandbox/sandbox.routes';
import { collabsRouter } from './collabs/collabs.routes';
import { universeTeamRouter } from './universeTeam/universeTeam.routes';
import { universeTreasuryRouter } from './universeTreasury/universeTreasury.routes';
import { adminRouter } from './admin/admin.routes';
import { portfolioRouter } from './portfolio/portfolio.routes';

// ── Wallet login tracking (analytics domain) ───────────────────────────
const walletLoginsCol = firebaseAvailable ? db.collection('walletLogins') : null;
const usersCol = firebaseAvailable ? db.collection('users') : null;

// ── Root router ─────────────────────────────────────────────────────────
export const appRouter = router({
  // ── System ──────────────────────────────────────────────────────────
  healthCheck: publicProcedure.query(() => 'OK'),

  privateData: protectedProcedure.query(({ ctx }) => ({
    message: 'This is private',
    user: { uid: ctx.user.uid, address: ctx.user.address, email: ctx.user.email },
  })),

  trackWalletLogin: publicProcedure
    .input(
      z.object({
        address: z.string(),
        chainId: z.number(),
        connector: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!walletLoginsCol || !usersCol) {
        return { ok: true };
      }

      const now = new Date();
      const addressLower = input.address.toLowerCase();

      await walletLoginsCol.add({
        address: addressLower,
        chainId: input.chainId,
        connector: input.connector || 'unknown',
        loginAt: now,
        userAgent: '',
      });

      const userRef = usersCol.doc(addressLower);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        await userRef.update({
          lastLoginAt: now,
          loginCount: (userDoc.data()?.loginCount || 0) + 1,
          chainId: input.chainId,
        });
      } else {
        await userRef.set({
          address: addressLower,
          firstLoginAt: now,
          lastLoginAt: now,
          loginCount: 1,
          chainId: input.chainId,
          connector: input.connector || 'unknown',
        });
      }

      return { ok: true };
    }),

  // ── Universes domain ────────────────────────────────────────────────
  universes: universesRouter,
  cinematicUniverses: cinematicUniversesRouter, // @deprecated — use universes.*
  collabs: collabsRouter,
  universeTeam: universeTeamRouter,
  universeTreasury: universeTreasuryRouter,

  // ── Content domain ──────────────────────────────────────────────────
  content: contentRouter,
  wiki: wikiRouter,
  entities: entitiesRouter,

  // ── Generation domain ───────────────────────────────────────────────
  generation: generationRouter,
  image: imageRouter,
  fal: falRouter, // @deprecated — backward compat; migrate to generation.* + image.*

  // ── Marketplace domain ──────────────────────────────────────────────
  marketplace: marketplaceRouter,
  nft: nftRouter,
  listings: listingsRouter,

  // ── Monetization ────────────────────────────────────────────────────
  credits: creditsRouter,
  subscriptions: subscriptionsRouter,
  ads: adsRouter,
  licensing: licensingRouter,

  // ── Analytics ───────────────────────────────────────────────────────
  analytics: analyticsRouter,

  // ── Storage ─────────────────────────────────────────────────────────
  storage: storageRouter,
  firebaseStorage: firebaseStorageRouter,
  synapse: synapseRouter,

  // ── User ────────────────────────────────────────────────────────────
  profiles: profilesRouter,
  quests: questsRouter,
  sandbox: sandboxRouter,

  // ── Admin ───────────────────────────────────────────────────────────
  admin: adminRouter,

  // ── Portfolio BFF (mobile vault aggregation) ────────────────────────
  portfolio: portfolioRouter,
});

export type AppRouter = typeof appRouter;
