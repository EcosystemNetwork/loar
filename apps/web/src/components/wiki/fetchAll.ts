import { trpcClient } from '@/utils/trpc';
import type { EntityKind, WikiEntity } from './types';

const PAGE_SIZE = 200;
const MAX_PAGES = 10;

/**
 * Query key for the "everything of this kind" fetch used by the aggregate
 * tabs (Stats, A–Z, Map, Timeline, Graph, Creators, Random).
 *
 * Deliberately NOT `['entities', 'list', …]`: the hub's paginated
 * `useInfiniteQuery` owns that key and caches `{pages, pageParams}`, so sharing
 * it made the aggregate tabs read a differently-shaped cache entry.
 */
export function allEntitiesKey(kind: EntityKind, universeAddress?: string) {
  return ['wiki', 'all-entities', universeAddress ?? 'global', kind] as const;
}

/**
 * Pages through `entities.list` / `listByKind` (200 at a time, up to
 * MAX_PAGES) so aggregate views aren't silently capped at the server's default
 * page of 100.
 */
export async function fetchAllEntities(
  kind: EntityKind,
  universeAddress?: string
): Promise<{ entities: WikiEntity[]; truncated: boolean }> {
  const entities: WikiEntity[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = universeAddress
      ? await trpcClient.entities.list.query({ universeAddress, kind, limit: PAGE_SIZE, cursor })
      : await trpcClient.entities.listByKind.query({ kind, limit: PAGE_SIZE, cursor });
    entities.push(...(res.entities as WikiEntity[]));
    if (!res.nextCursor) return { entities, truncated: false };
    cursor = res.nextCursor;
  }
  return { entities, truncated: true };
}
