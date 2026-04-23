/**
 * Notebook tRPC router — private creator scratch entries with promote-to-entity.
 *
 * Every route is `protectedProcedure`. Entries are only ever visible to their
 * creator. Promotion spawns a real `entities` doc and records the linkage.
 */
import { z } from 'zod';
import { protectedProcedure, router } from '../../lib/trpc';
import { ENTITY_KINDS } from '../entities/entities.types';
import {
  createNotebookEntry,
  getNotebookEntry,
  listNotebookEntriesByCreator,
  updateNotebookEntry,
  deleteNotebookEntry,
  promoteNotebookEntry,
} from './notebook.handlers';

const ethereumAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');
const entityKindSchema = z.enum(ENTITY_KINDS);

async function assertOwner(entryId: string, caller?: string) {
  const entry = await getNotebookEntry(entryId);
  if (!entry) throw new Error('Notebook entry not found');
  if (!caller || entry.creator.toLowerCase() !== caller.toLowerCase()) {
    throw new Error('Forbidden: notebook entries are private to their author');
  }
  return entry;
}

export const notebookRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(20_000).default(''),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        universeAddress: ethereumAddress.nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) throw new Error('Wallet address required');
      const entry = await createNotebookEntry(
        {
          title: input.title,
          body: input.body,
          tags: input.tags,
          universeAddress: input.universeAddress ?? null,
        },
        ctx.user.address
      );
      return { success: true, entry };
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          universeAddress: ethereumAddress.nullish(),
          onlyPromoted: z.boolean().optional(),
          limit: z.number().int().positive().max(200).default(100),
        })
        .default({ limit: 100 })
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.user.address) return { entries: [], total: 0 };
      const entries = await listNotebookEntriesByCreator(ctx.user.address, {
        // `undefined` = no filter on universeAddress; `null` = explicitly
        // unattached entries. Distinguish with hasOwnProperty.
        universeAddress:
          input.universeAddress === undefined ? undefined : (input.universeAddress ?? null),
        onlyPromoted: input.onlyPromoted,
        limit: input.limit,
      });
      return { entries, total: entries.length };
    }),

  get: protectedProcedure
    .input(z.object({ entryId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const entry = await assertOwner(input.entryId, ctx.user.address);
      return { entry };
    }),

  update: protectedProcedure
    .input(
      z.object({
        entryId: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        body: z.string().max(20_000).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        universeAddress: ethereumAddress.nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertOwner(input.entryId, ctx.user.address);
      const { entryId, ...updates } = input;
      const entry = await updateNotebookEntry(entryId, updates);
      return { success: true, entry };
    }),

  delete: protectedProcedure
    .input(z.object({ entryId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await assertOwner(input.entryId, ctx.user.address);
      await deleteNotebookEntry(input.entryId);
      return { success: true };
    }),

  /** Promote the entry into a canonical Entity (person, place, lore, etc.). */
  promote: protectedProcedure
    .input(
      z.object({
        entryId: z.string().min(1),
        kind: entityKindSchema,
        universeAddress: ethereumAddress.nullish(),
        imageUrl: z.string().url().nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) throw new Error('Wallet address required');
      const { entityId } = await promoteNotebookEntry(input.entryId, input.kind, ctx.user.address, {
        universeAddress:
          input.universeAddress === undefined ? undefined : (input.universeAddress ?? null),
        imageUrl: input.imageUrl ?? null,
      });
      return { success: true, entityId };
    }),
});

export type NotebookRouter = typeof notebookRouter;
