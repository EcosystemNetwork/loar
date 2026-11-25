import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accountGroups,
  allNavLinks,
  exploreLinks,
  mobileTabs,
  needsExactMatch,
  primaryLinks,
  signedInLinks,
  signedOutLinks,
  studioToolGroups,
  visibleAccountGroups,
  visibleExploreLinks,
  visibleStudioToolGroups,
  type NavLink,
} from '../navLinks';

/** Route paths registered in the generated route tree. */
function registeredRoutes(): Set<string> {
  const src = readFileSync(resolve(__dirname, '../../routeTree.gen.ts'), 'utf8');
  const block = src.split('export interface FileRoutesByFullPath {')[1]?.split('}')[0] ?? '';
  return new Set([...block.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
}

const isRoute = (routes: Set<string>, to: string) => routes.has(to) || routes.has(`${to}/`);
const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

/** Everything a signed-in user can reach from global chrome + the Studio hub. */
const signedInSurface = (): NavLink[] => [
  ...signedInLinks,
  ...exploreLinks,
  ...accountGroups.flatMap((g) => g.links),
  ...studioToolGroups.flatMap((g) => g.tools),
];

describe('navigation IA', () => {
  it('every link points at a registered route', () => {
    const routes = registeredRoutes();
    expect(routes.size).toBeGreaterThan(50);
    const missing = allNavLinks()
      .map((l) => l.to)
      .filter((to) => !isRoute(routes, to));
    expect(missing).toEqual([]);
  });

  it('each destination has exactly one home in the signed-in surface', () => {
    const links = signedInSurface();
    expect(dupes(links.map((l) => l.to))).toEqual([]);
    expect(dupes(links.map((l) => l.label))).toEqual([]);
  });

  it('keeps global nav short', () => {
    expect(signedOutLinks.length).toBeLessThanOrEqual(4);
    expect(signedInLinks.length).toBeLessThanOrEqual(5);
    expect(exploreLinks.length).toBeLessThanOrEqual(10);
  });

  it('signed-out visitors see no account-only rooms', () => {
    const tos = primaryLinks(false).map((l) => l.to);
    expect(tos).not.toContain('/dashboard');
    expect(tos).not.toContain('/studio');
    expect(visibleExploreLinks(false)).toEqual([]);
  });

  it('Studio is primary for every signed-in user', () => {
    expect(primaryLinks(true).map((l) => l.to)).toContain('/studio');
  });

  it('pro tools live in the Studio hub, not in global nav', () => {
    const global = new Set([...signedInLinks, ...exploreLinks].map((l) => l.to));
    const leaked = studioToolGroups.flatMap((g) => g.tools).filter((t) => global.has(t.to));
    expect(leaked).toEqual([]);
    for (const g of studioToolGroups) {
      for (const t of g.tools) expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('beta labels never appear in global nav', () => {
    expect([...signedInLinks, ...exploreLinks].some((l) => 'beta' in l && l.beta)).toBe(false);
  });

  it('mobile tabs are Home + the desktop primary order', () => {
    for (const signedIn of [false, true]) {
      const tabs = mobileTabs(signedIn);
      expect(tabs.length).toBeLessThanOrEqual(5);
      expect(tabs[0].to).toBe('/');
      expect(tabs.slice(1).map((t) => t.to)).toEqual(
        primaryLinks(signedIn)
          .slice(0, 4)
          .map((l) => l.to)
      );
    }
  });

  it('never leaves an empty group', () => {
    expect(visibleAccountGroups().every((g) => g.links.length > 0)).toBe(true);
    expect(visibleStudioToolGroups().every((g) => g.tools.length > 0)).toBe(true);
  });

  it('requires exact matching only for links that have a nested sibling', () => {
    const account = accountGroups.flatMap((g) => g.links);
    expect(needsExactMatch('/dashboard', account)).toBe(true);
    expect(needsExactMatch('/dashboard/personas', account)).toBe(false);
    expect(needsExactMatch('/marketplace/likeness', exploreLinks)).toBe(false);
    expect(needsExactMatch('/market', exploreLinks)).toBe(false); // "/market" is not a parent of "/marketplace/…"
  });
});
