import type { WikiEntity, WikiSort } from './types';

export function sortEntities(entities: WikiEntity[], sort: WikiSort): WikiEntity[] {
  const copy = [...entities];
  const ts = (e: WikiEntity) => {
    const v = e.createdAt;
    if (!v) return 0;
    const d = typeof v === 'string' ? new Date(v) : v;
    return d.getTime();
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
