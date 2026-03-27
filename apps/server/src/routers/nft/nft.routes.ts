/**
 * NFT Router — Episode and Character NFT management
 * Handles minting, listing, and querying NFTs
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';

const episodesCol = db.collection('episodeNFTs');
const characterNFTsCol = db.collection('characterNFTs');
const nftMintsCol = db.collection('nftMints');

export const nftRouter = router({
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

      const ref = await episodesCol.add(episodeData);
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

      await nftMintsCol.add(mintData);

      // Increment minted count
      const epRef = episodesCol.doc(input.episodeId);
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
      const snapshot = await episodesCol
        .where('universeId', '==', input.universeId)
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getEpisode: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const doc = await episodesCol.doc(input.id).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }),

  deactivateEpisode: protectedProcedure
    .input(z.object({ episodeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = episodesCol.doc(input.episodeId);
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
        traits: z.record(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check for duplicate character name in universe
      const existing = await characterNFTsCol
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

      const ref = await characterNFTsCol.add(characterData);
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
      const ref = characterNFTsCol.doc(input.characterId);
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
      const snapshot = await characterNFTsCol
        .where('universeId', '==', input.universeId)
        .where('active', '==', true)
        .orderBy('appearanceCount', 'desc')
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getMyNFTs: protectedProcedure.query(async ({ ctx }) => {
    const [episodes, characters, mints] = await Promise.all([
      episodesCol.where('creatorUid', '==', ctx.user.uid).get(),
      characterNFTsCol.where('creatorUid', '==', ctx.user.uid).get(),
      nftMintsCol.where('buyerUid', '==', ctx.user.uid).get(),
    ]);

    return {
      createdEpisodes: episodes.docs.map((d) => ({ id: d.id, ...d.data() })),
      createdCharacters: characters.docs.map((d) => ({ id: d.id, ...d.data() })),
      mintedEpisodes: mints.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  }),
});
