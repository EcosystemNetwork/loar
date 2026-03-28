/**
 * User Profiles Router
 *
 * CRUD operations for user profiles with customizable layout,
 * privacy controls (public/private), and portfolio settings.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

const profilesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('profiles');
};

const profileLayoutSchema = z.object({
  theme: z.enum(['default', 'minimal', 'cinematic', 'neon', 'retro']).default('default'),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#8b5cf6'),
  bannerUrl: z.string().url().optional(),
  showStats: z.boolean().default(true),
  gridColumns: z.enum(['2', '3', '4']).default('3'),
  featuredContentIds: z.array(z.string()).max(6).default([]),
});

const profileSchema = z.object({
  displayName: z.string().min(1).max(50),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Username can only contain letters, numbers, hyphens, and underscores'
    ),
  bio: z.string().max(500).default(''),
  avatarUrl: z.string().url().optional(),
  visibility: z.enum(['public', 'private']).default('private'),
  tags: z.array(z.string().max(20)).max(10).default([]),
  socialLinks: z
    .object({
      website: z.string().url().optional(),
      twitter: z.string().max(50).optional(),
      youtube: z.string().max(100).optional(),
      discord: z.string().max(50).optional(),
    })
    .default({}),
  layout: profileLayoutSchema.optional(),
});

export const profilesRouter = router({
  /** Get the current user's profile */
  me: protectedProcedure.query(async ({ ctx }) => {
    const doc = await profilesCol().doc(ctx.user.uid).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  /** Get a profile by username (public) */
  getByUsername: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await profilesCol
        .where('username', '==', input.username.toLowerCase())
        .limit(1)
        .get();

      if (snapshot.empty) return null;

      const doc = snapshot.docs[0];
      const data = doc.data()!;

      // If private, only return minimal info
      if (data.visibility === 'private') {
        return {
          id: doc.id,
          displayName: data.displayName,
          username: data.username,
          avatarUrl: data.avatarUrl || null,
          visibility: 'private' as const,
        };
      }

      return { id: doc.id, ...data };
    }),

  /** Get a profile by uid (public, respects privacy) */
  getByUid: publicProcedure.input(z.object({ uid: z.string() })).query(async ({ input }) => {
    const doc = await profilesCol().doc(input.uid).get();
    if (!doc.exists) return null;

    const data = doc.data()!;
    if (data.visibility === 'private') {
      return {
        id: doc.id,
        displayName: data.displayName,
        username: data.username,
        avatarUrl: data.avatarUrl || null,
        visibility: 'private' as const,
      };
    }
    return { id: doc.id, ...data };
  }),

  /** Create or update the current user's profile */
  upsert: protectedProcedure.input(profileSchema).mutation(async ({ ctx, input }) => {
    const usernameLower = input.username.toLowerCase();

    // Check username uniqueness (excluding current user)
    const existing = await profilesCol().where('username', '==', usernameLower).limit(1).get();

    if (!existing.empty && existing.docs[0].id !== ctx.user.uid) {
      throw new Error('Username is already taken');
    }

    const now = new Date();
    const ref = profilesCol().doc(ctx.user.uid);
    const doc = await ref.get();

    const profileData = {
      ...input,
      username: usernameLower,
      uid: ctx.user.uid,
      updatedAt: now,
      ...(doc.exists ? {} : { createdAt: now }),
    };

    await ref.set(profileData, { merge: true });
    return { id: ctx.user.uid, ...profileData };
  }),

  /** Update just the layout/theme settings */
  updateLayout: protectedProcedure.input(profileLayoutSchema).mutation(async ({ ctx, input }) => {
    const ref = profilesCol().doc(ctx.user.uid);
    await ref.update({ layout: input, updatedAt: new Date() });
    return { ok: true };
  }),

  /** Toggle visibility between public and private */
  setVisibility: protectedProcedure
    .input(z.object({ visibility: z.enum(['public', 'private']) }))
    .mutation(async ({ ctx, input }) => {
      await profilesCol().doc(ctx.user.uid).update({
        visibility: input.visibility,
        updatedAt: new Date(),
      });
      return { ok: true, visibility: input.visibility };
    }),

  /** Check if a username is available */
  checkUsername: publicProcedure
    .input(z.object({ username: z.string().min(3).max(30) }))
    .query(async ({ input }) => {
      const snapshot = await profilesCol
        .where('username', '==', input.username.toLowerCase())
        .limit(1)
        .get();
      return { available: snapshot.empty };
    }),

  /** Browse public profiles with optional search */
  discover: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = profilesCol
        .where('visibility', '==', 'public')
        .orderBy('createdAt', 'desc')
        .limit(input.limit + 1);

      if (input.cursor) {
        const cursorDoc = await profilesCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const docs = snapshot.docs;
      const hasMore = docs.length > input.limit;
      const profiles = docs.slice(0, input.limit).map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          displayName: data.displayName,
          username: data.username,
          bio: data.bio || '',
          avatarUrl: data.avatarUrl || null,
          tags: data.tags || [],
          layout: {
            theme: data.layout?.theme || 'default',
            accentColor: data.layout?.accentColor || '#8b5cf6',
          },
          contentCount: data.contentCount || 0,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      });

      // Client-side search filter (Firestore doesn't support full-text search)
      let filtered = profiles;
      if (input.search) {
        const s = input.search.toLowerCase();
        filtered = profiles.filter(
          (p) =>
            p.displayName.toLowerCase().includes(s) ||
            p.username.toLowerCase().includes(s) ||
            p.bio.toLowerCase().includes(s) ||
            p.tags.some((t: string) => t.toLowerCase().includes(s))
        );
      }

      if (input.tags && input.tags.length > 0) {
        const filterTags = input.tags.map((t) => t.toLowerCase());
        filtered = filtered.filter((p) =>
          p.tags.some((t: string) => filterTags.includes(t.toLowerCase()))
        );
      }

      return {
        profiles: filtered,
        nextCursor: hasMore ? docs[input.limit - 1]?.id : null,
      };
    }),
});

export type ProfilesRouter = typeof profilesRouter;
