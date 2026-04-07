/**
 * NFT Router — Episode and Character NFT management
 *
 * Content lifecycle:
 *   1. Content lives in Firebase galleries (fast, cheap, mutable)
 *   2. User decides to mint → `mintContent` pins to IPFS, creates NFT listing
 *   3. Minted content is permanent on-chain, sellable in the store
 *   4. Canon-minted content in a universe becomes immutable (governance-locked)
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { getStorageManager } from '../../services/storage';
import { throwApiError } from '../../lib/errors';

const episodesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodeNFTs');
};
const characterNFTsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('characterNFTs');
};
const nftMintsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('nftMints');
};
const contentCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('content');
};

export const nftRouter = router({
  // ---- Mint Content as NFT (Firebase → IPFS → Listing) ----

  /**
   * Mint any gallery content as an NFT.
   * 1. Pins content to IPFS for permanent storage
   * 2. Creates an NFT listing ready for on-chain minting
   * 3. Marks the content record as minted (immutable media)
   */
  mintContent: protectedProcedure
    .input(
      z.object({
        /** ID of the content item in the gallery (Firebase content collection) */
        contentId: z.string(),
        /** Mint price in wei (string for BigInt safety) */
        mintPrice: z.string().default('0'),
        /** Max supply (0 = unlimited) */
        maxSupply: z.number().default(0),
        /** Royalty basis points (default 5%) */
        royaltyBps: z.number().min(0).max(10000).default(500),
        /** Optional universe to associate with */
        universeId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 1. Load the content from gallery
      const contentRef = contentCol().doc(input.contentId);
      const contentDoc = await contentRef.get();
      if (!contentDoc.exists) throwApiError('NOT_FOUND', 'Content not found in gallery');
      const content = contentDoc.data()!;

      if (content.creatorUid !== ctx.user.uid) {
        throwApiError('FORBIDDEN', 'Only the creator can mint their content');
      }

      if (content.mintedAsNft) {
        throwApiError('CONFLICT', 'Content has already been minted as an NFT');
      }

      // 2. Pin to IPFS for permanent on-chain storage
      const manager = getStorageManager();
      let ipfsCid: string;
      let ipfsUrl: string;

      if (content.contentHash) {
        // Content was uploaded via StorageManager — pin existing hash
        const pinResult = await manager.pinToIPFS(content.contentHash);
        ipfsCid = pinResult.cid;
        ipfsUrl = pinResult.url;
      } else if (content.mediaUrl) {
        // Content has a media URL but no storage hash — upload to IPFS directly
        const manifest = await manager.uploadFromUrl(content.mediaUrl);
        const ipfsUpload = manifest.uploads.find((u) => u.provider === 'ipfs');
        if (ipfsUpload) {
          ipfsCid = ipfsUpload.contentId;
          ipfsUrl = ipfsUpload.url;
        } else {
          // IPFS wasn't in primary chain, pin explicitly
          const pinResult = await manager.pinToIPFS(manifest.contentHash);
          ipfsCid = pinResult.cid;
          ipfsUrl = pinResult.url;
        }
      } else {
        throwApiError('BAD_REQUEST', 'Content has no media to mint');
      }

      // 3. Build NFT metadata URI (points to IPFS)
      const metadataURI = ipfsUrl;

      // 4. Create the NFT listing
      const now = new Date();
      const nftData = {
        contentId: input.contentId,
        universeId: input.universeId || content.universeId || null,
        contentHash: content.contentHash || null,
        ipfsCid,
        ipfsUrl,
        title: content.title,
        description: content.description || '',
        mediaUrl: ipfsUrl, // Permanent IPFS URL
        thumbnailUrl: content.thumbnailUrl || null,
        mediaType: content.mediaType || 'image',
        metadataURI,
        mintPrice: input.mintPrice,
        maxSupply: input.maxSupply,
        royaltyBps: input.royaltyBps,
        creatorUid: ctx.user.uid,
        creatorAddress: ctx.user.address || null,
        minted: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      const nftRef = await episodesCol().add(nftData);

      // 5. Mark the gallery content as minted (media becomes immutable)
      await contentRef.update({
        mintedAsNft: true,
        nftListingId: nftRef.id,
        ipfsCid,
        ipfsUrl,
        mintedAt: now,
        updatedAt: now,
      });

      return {
        ...nftData,
        nftListingId: nftRef.id,
      };
    }),

  // ---- Episode NFTs ----

  createEpisodeListing: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        nodeId: z.number(),
        contentHash: z.string(),
        title: z.string(),
        description: z.string(),
        mediaUrl: z.string(),
        thumbnailUrl: z.string().optional(),
        mintPrice: z.string(), // wei as string
        maxSupply: z.number().default(0), // 0 = unlimited
        royaltyBps: z.number().default(500), // 5% default
        metadataURI: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const episodeData = {
        ...input,
        creatorUid: ctx.user.uid,
        creatorAddress: ctx.user.address || null,
        minted: 0,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await episodesCol().add(episodeData);
      return { id: ref.id, ...episodeData };
    }),

  recordMint: protectedProcedure
    .input(
      z.object({
        episodeId: z.string(),
        tokenId: z.number(),
        txHash: z.string(),
        price: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mintData = {
        ...input,
        buyerUid: ctx.user.uid,
        buyerAddress: ctx.user.address || null,
        mintedAt: new Date(),
      };

      await nftMintsCol().add(mintData);

      // Increment minted count
      const epRef = episodesCol().doc(input.episodeId);
      const epDoc = await epRef.get();
      if (epDoc.exists) {
        await epRef.update({
          minted: (epDoc.data()?.minted || 0) + 1,
          updatedAt: new Date(),
        });
      }

      return { ok: true, mint: mintData };
    }),

  getEpisodesByUniverse: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await episodesCol()
        .where('universeId', '==', input.universeId)
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getEpisode: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const doc = await episodesCol().doc(input.id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  deactivateEpisode: protectedProcedure
    .input(z.object({ episodeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = episodesCol().doc(input.episodeId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Episode not found');
      if (doc.data()?.creatorUid !== ctx.user.uid) throw new Error('Not authorized');

      await ref.update({ active: false, updatedAt: new Date() });
      return { ok: true };
    }),

  // ---- Character NFTs ----

  createCharacterNFT: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        name: z.string(),
        description: z.string(),
        imageUrl: z.string(),
        visualHash: z.string(),
        metadataURI: z.string(),
        traits: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check for duplicate character name in universe
      const existing = await characterNFTsCol()
        .where('universeId', '==', input.universeId)
        .where('name', '==', input.name)
        .get();

      if (!existing.empty) throw new Error('Character already exists in this universe');

      const characterData = {
        ...input,
        creatorUid: ctx.user.uid,
        creatorAddress: ctx.user.address || null,
        appearanceCount: 0,
        accumulatedRoyalties: '0',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await characterNFTsCol().add(characterData);
      return { id: ref.id, ...characterData };
    }),

  recordAppearance: protectedProcedure
    .input(
      z.object({
        characterId: z.string(),
        episodeId: z.string(),
        reward: z.string(), // wei
      })
    )
    .mutation(async ({ input }) => {
      const ref = characterNFTsCol().doc(input.characterId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Character not found');

      const data = doc.data()!;
      await ref.update({
        appearanceCount: (data.appearanceCount || 0) + 1,
        accumulatedRoyalties: (
          BigInt(data.accumulatedRoyalties || '0') + BigInt(input.reward)
        ).toString(),
        updatedAt: new Date(),
      });

      return { ok: true };
    }),

  getCharactersByUniverse: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await characterNFTsCol()
        .where('universeId', '==', input.universeId)
        .where('active', '==', true)
        .orderBy('appearanceCount', 'desc')
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getMyNFTs: protectedProcedure.query(async ({ ctx }) => {
    const [episodes, characters, mints] = await Promise.all([
      episodesCol().where('creatorUid', '==', ctx.user.uid).get(),
      characterNFTsCol().where('creatorUid', '==', ctx.user.uid).get(),
      nftMintsCol().where('buyerUid', '==', ctx.user.uid).get(),
    ]);

    return {
      createdEpisodes: episodes.docs.map((d) => ({ id: d.id, ...d.data() })),
      createdCharacters: characters.docs.map((d) => ({ id: d.id, ...d.data() })),
      mintedEpisodes: mints.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  }),
});
