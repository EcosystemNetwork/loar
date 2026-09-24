import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  moreGroupsBase,
  needsExactMatch,
  ownerPrimaryLink,
  primaryLinksBase,
  visibleMoreGroups,
} from '../navLinks';

/** Route paths registered in the generated route tree. */
function registeredRoutes(): Set<string> {
  const src = readFileSync(resolve(__dirname, '../../routeTree.gen.ts'), 'utf8');
  const block = src.split('export interface FileRoutesByFullPath {')[1]?.split('}')[0] ?? '';
  return new Set([...block.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
}

const allLinks = () => [
  ...primaryLinksBase,
  ownerPrimaryLink,
  ...visibleMoreGroups(true).flatMap((g) => g.links),
];

describe('header nav links', () => {
  it('every link points at a registered route', () => {
    const routes = registeredRoutes();
    expect(routes.size).toBeGreaterThan(50);
    const missing = allLinks()
      .map((l) => l.to)
      // Index routes are registered without a trailing slash in FileRoutesByFullPath.
      .filter((to) => !routes.has(to) && !routes.has(`${to}/`));
    expect(missing).toEqual([]);
  });

  it('has no duplicate targets or labels across the whole nav', () => {
    const links = allLinks();
    const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dupes(links.map((l) => l.to))).toEqual([]);
    expect(dupes(links.map((l) => l.label))).toEqual([]);
  });

  it('adds Gallery only for universe owners', () => {
    const has = (owner: boolean) =>
      visibleMoreGroups(owner).some((g) => g.links.some((l) => l.to === '/gallery'));
    expect(has(false)).toBe(false);
    expect(has(true)).toBe(true);
  });

  it('never leaves an empty group', () => {
    for (const owner of [false, true]) {
      expect(visibleMoreGroups(owner).every((g) => g.links.length > 0)).toBe(true);
    }
  });

  it('requires exact matching only for links that have a nested sibling', () => {
    const groups = moreGroupsBase;
    expect(needsExactMatch('/agents', groups)).toBe(true);
    expect(needsExactMatch('/marketplace/likeness', groups)).toBe(true);
    expect(needsExactMatch('/agents/discover', groups)).toBe(false);
    expect(needsExactMatch('/market', groups)).toBe(false); // "/market" is not a parent of "/marketplace/…"
    expect(needsExactMatch('/docs', groups)).toBe(false);
  });
});
