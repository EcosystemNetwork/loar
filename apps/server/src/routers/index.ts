/**
 * Root tRPC Router — clean aggregator of all domain sub-routers.
 *
 * Domain structure:
 *   universes      — Universe CRUD, team, treasury, collabs
 *   content        — User content CRUD, wiki/lore generation
 *   generation     — AI video generation (smart routing + billing)
 *   image          — Image generation (smart routing + billing + history)
 *   voice          — TTS, sound effects, voice design, voice cloning (ElevenLabs)
 *   threed         — 3D generation text-to-3D / image-to-3D (Meshy)
 *   studio         — Entity asset pack orchestrator (fan-out across all modalities)
 *   marketplace    — Canon submissions, voting, NFT listings
 *   credits        — Credit packages, balances, spend/purchase
 *   subscriptions  — Universe subscription tiers
 *   analytics      — Views, engagement, trending, wallet tracking
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
import { contentRouter } from './content/content.routes';
import { wikiRouter } from './content/wiki.routes';
import { commentsRouter } from './content/comments.routes';
import { generationRouter } from './generation/generation.routes';
import { imageRouter } from './generation/image.routes';
import { marketplaceRouter } from './marketplace/marketplace.routes';
import { nftRouter } from './nft/nft.routes';
import { listingsRouter } from './listings/listings.routes';
import { creditsRouter } from './credits/credits.routes';
import { subscriptionsRouter } from './subscriptions/subscriptions.routes';
import { analyticsRouter } from './analytics/analytics.routes';
import { storageRouter } from './storage/storage.routes';
import { firebaseStorageRouter } from './storage/firebase.routes';
import { synapseRouter } from './storage/synapse.routes';
import { profilesRouter } from './profiles/profiles.routes';
import { entitiesRouter } from './entities/entities.index';
import { offChainNodesRouter } from './offChainNodes/offChainNodes.routes';
import { nodeMediaRouter } from './nodeMedia/nodeMedia.routes';
import { questsRouter } from './quests/quests.routes';
import { sandboxRouter } from './sandbox/sandbox.routes';
import { universeTeamRouter } from './universeTeam/universeTeam.routes';
import { universeTreasuryRouter } from './universeTreasury/universeTreasury.routes';
import { adminRouter } from './admin/admin.routes';
import { portfolioRouter } from './portfolio/portfolio.routes';
import { mediaRouter } from './media/media.routes';
import { voiceRouter } from './generation/voice.routes';
import { threedRouter } from './generation/threed.routes';
import { audioRouter } from './generation/audio.routes';
import { editingRouter } from './generation/editing.routes';
import { editJobsRouter } from './editJobs/editJobs.index';
import { outpaintRouter } from './generation/outpaint.routes';
import { characterPipelineRouter } from './generation/character-pipeline.routes';
import { collaborationRouter } from './collaboration/collaboration.routes';
import { studioRouter } from './studio/studio.routes';
import { governanceRouter } from './governance/governance.routes';
import { revenueRouter } from './revenue/revenue.routes';
import { tokenGatesRouter } from './tokenGates/tokenGates.routes';
import { socialRouter } from './social/social.routes';
import { feedRouter } from './feed/feed.routes';
import { playerRouter } from './player/player.routes';
import { loraRouter } from './generation/lora.routes';
import { privateSectionRouter } from './privateSection/privateSection.routes';
import { splitsRouter } from './splits/splits.routes';
import { universeGenConfigRouter } from './universeGenConfig/universeGenConfig.routes';
import { contentLicensingRouter } from './contentLicensing/contentLicensing.routes';
import { galleryRouter } from './gallery/gallery.routes';
import { moderationRouter } from './moderation/moderation.routes';
import { stripeRouter } from './credits/stripe.routes';
import { pricingRouter } from './pricing/pricing.routes';
import { tokenSocialRouter } from './tokenSocial/tokenSocial.routes';
import { platformSubscriptionsRouter } from './platformSubscriptions/platformSubscriptions.routes';
import { castRouter } from './cast/cast.routes';
import { sceneControlsRouter } from './sceneControls/sceneControls.routes';
import { pollsRouter } from './polls/polls.routes';
import { notificationsRouter } from './notifications/notifications.routes';
import { lipsyncRouter } from './generation/lipsync.routes';
import { cutdownRouter } from './generation/cutdown.routes';
import { sceneAudioRouter } from './generation/sceneAudio.routes';
import { talkingSceneRouter } from './generation/talking-scene.routes';
import { universeStyleRouter } from './universeStyle/universeStyle.routes';
import { universeTonePacksRouter } from './universeStyle/tonePacks.routes';
import { revenueDashboardRouter } from './revenueDashboard/revenueDashboard.routes';
import { episodesRouter } from './episodes/episodes.routes';
import { shotTemplatesRouter } from './shotTemplates/shotTemplates.routes';
import { lineageRouter } from './lineage/lineage.routes';
import { mcpRouter } from './mcp/mcp.routes';
import { jobsRouter } from './jobs/jobs.routes';
import { vlmRouter } from './vlm/vlm.index';
import { indexerRouter } from './indexer/indexer.routes';

// ── Wallet login tracking (analytics domain) ───────────────────────────
const getWalletLoginsCol = () => (firebaseAvailable ? db.collection('walletLogins') : null);
const getUsersCol = () => (firebaseAvailable ? db.collection('users') : null);

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
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address'),
        chainId: z.number(),
        connector: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const walletLoginsCol = getWalletLoginsCol();
      const usersCol = getUsersCol();
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

  // ── Indexer reads (replaces Ponder GraphQL) ─────────────────────────
  indexer: indexerRouter,

  // ── Universes domain ────────────────────────────────────────────────
  universes: universesRouter,
  universeTeam: universeTeamRouter,
  universeTreasury: universeTreasuryRouter,

  // ── Content domain ──────────────────────────────────────────────────
  content: contentRouter,
  wiki: wikiRouter,
  comments: commentsRouter,
  entities: entitiesRouter,
  offChainNodes: offChainNodesRouter,
  nodeMedia: nodeMediaRouter,
  media: mediaRouter,
  collaboration: collaborationRouter,

  // ── Generation domain ───────────────────────────────────────────────
  generation: generationRouter,
  image: imageRouter,
  voice: voiceRouter,
  audio: audioRouter,
  threed: threedRouter,
  characterPipeline: characterPipelineRouter,
  editing: editingRouter,
  editJobs: editJobsRouter,
  outpaint: outpaintRouter,
  lora: loraRouter,
  lipsync: lipsyncRouter,
  cutdown: cutdownRouter,
  sceneAudio: sceneAudioRouter,
  talkingScene: talkingSceneRouter,

  // ── Studio OS ────────────────────────────────────────────────────────
  studio: studioRouter,

  // ── Marketplace domain ──────────────────────────────────────────────
  marketplace: marketplaceRouter,
  nft: nftRouter,
  listings: listingsRouter,

  // ── Monetization ────────────────────────────────────────────────────
  credits: creditsRouter,
  subscriptions: subscriptionsRouter,

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

  // ── Governance ──────────────────────────────────────────────────────
  governance: governanceRouter,
  tokenGates: tokenGatesRouter,

  // ── Revenue Dashboard ──────────────────────────────────────────────
  revenue: revenueRouter,

  // ── Social ─────────────────────────────────────────────────────────
  social: socialRouter,

  // ── Feed & Discovery ───────────────────────────────────────────────
  feed: feedRouter,

  // ── Player ─────────────────────────────────────────────────────────
  player: playerRouter,

  // ── Private Section (Creator's Room) ────────────────────────────────
  privateSection: privateSectionRouter,

  // ── Admin ───────────────────────────────────────────────────────────
  admin: adminRouter,
  moderation: moderationRouter,
  stripe: stripeRouter,

  // ── Portfolio BFF (mobile vault aggregation) ────────────────────────
  portfolio: portfolioRouter,

  // ── Pricing ────────────────────────────────────────────────────────
  pricing: pricingRouter,

  // ── Universe Creator Studio ────────────────────────────────────────
  splits: splitsRouter,
  universeGenConfig: universeGenConfigRouter,
  contentLicensing: contentLicensingRouter,
  gallery: galleryRouter,

  // ── Platform Subscriptions ──────────────────────────────────────────
  platformSubscriptions: platformSubscriptionsRouter,

  // ── Token Social (comments, watchlist, portfolio) ──────────────────
  tokenSocial: tokenSocialRouter,

  // ── Node Editor Expansion (v1) ────────────────────────────────────
  cast: castRouter,
  sceneControls: sceneControlsRouter,

  // ── Polls & Fan-Input-to-Canon ────────────────────────────────────
  polls: pollsRouter,

  // ── Notifications (push + email preferences, device tokens) ───────
  notifications: notificationsRouter,

  // ── Universe Style Locking ─────────────────────────────────────────
  universeStyle: universeStyleRouter,
  universeTonePacks: universeTonePacksRouter,

  // ── Revenue Dashboard (creator analytics) ──────────────────────────
  revenueDashboard: revenueDashboardRouter,

  // ── Episodes (clip arrangement + export) ──────────────────────────
  episodes: episodesRouter,

  // ── Shot Templates (PRD 7: pose/composition/angle control) ────────
  shotTemplates: shotTemplatesRouter,

  // ── Asset Lineage, Rights, Credits, Analytics (PRD 10) ─────────────
  lineage: lineageRouter,

  // ── MCP resources surface (agent navigation via loar:// URIs) ────────
  // See docs/prd-mcp-integration.md §5
  mcp: mcpRouter,

  // ── Unified async-job status + cancel (all generation backends) ──────
  // See docs/prd-mcp-integration.md §5 / B-2
  jobs: jobsRouter,

  // ── VLM subsystem (extract, proposals, canon, search, moderation, copilot, recap, governance) ─
  // See docs/prd-vlm-subsystem.md
  vlm: vlmRouter,
});

export type AppRouter = typeof appRouter;
