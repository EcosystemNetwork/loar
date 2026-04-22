import type { WikiEntity, WikiSort } from './types';

export function sortEntities(entities: WikiEntity[], sort: WikiSort): WikiEntity[] {
  const copy = [...entities];
  const ts = (e: WikiEntity) => {
    const v = e.createdAt as unknown;
    if (!v) return 0;
    // Firestore Timestamps cross tRPC as {_seconds, _nanoseconds} — no superjson transformer.
    if (typeof v === 'object' && v !== null && '_seconds' in v) {
      const secs = (v as { _seconds?: number })._seconds;
      return typeof secs === 'number' ? secs * 1000 : 0;
    }
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string' || typeof v === 'number') {
      const t = new Date(v).getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    return 0;
  };
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => ts(b) - ts(a));
    case 'oldest':
      return copy.sort((a, b) => ts(a) - ts(b));
    case 'a-z':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'z-a':
      return copy.sort((a, b) => b.name.localeCompare(a.name));
  }
}

export function pickRandom<T>(items: T[]): T | null {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}
