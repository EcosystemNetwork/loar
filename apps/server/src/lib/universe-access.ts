/**
 * Read-access gate for universe-scoped content.
 *
 * Privacy (`isPrivate`) and admin soft-delete (`isHidden`) are enforced per
 * read surface through `getExcludedUniverseIds`. Surfaces that serve a single
 * universe's content by id must call this before reading — two missed it
 * (offChainNodes.list/get, director.getContext; audit R4-3), leaking a private
 * universe's whole story graph to anyone holding its (on-chain, enumerable) id.
 *
 * Collaborators keep access to a private universe — the editor reads its nodes
 * through these same endpoints — so an excluded universe falls back to an
 * `isUniverseCollaborator` check before answering NOT_FOUND.
 */

import { TRPCError } from '@trpc/server';
import { getExcludedUniverseIds } from '../routers/universes/universes.handlers';
import { isUniverseCollaborator } from './safe-admin';
import { isUniverseExcluded } from './universe-id';

export async function canReadUniverse(
  universeId: string,
  viewer: { uid?: string | null; address?: string | null } | null | undefined
): Promise<boolean> {
  const viewerAddress = viewer?.address ?? undefined;
  const excluded = await getExcludedUniverseIds({ viewerAddress });
  if (!isUniverseExcluded(excluded, universeId)) return true;
  const caller = viewer?.address ?? viewer?.uid ?? undefined;
  return isUniverseCollaborator(universeId, caller);
}

/** Throws NOT_FOUND (not FORBIDDEN, so private ids aren't confirmed) when unreadable. */
export async function assertUniverseReadable(
  universeId: string,
  viewer: { uid?: string | null; address?: string | null } | null | undefined
): Promise<void> {
  if (!(await canReadUniverse(universeId, viewer))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
  }
}
