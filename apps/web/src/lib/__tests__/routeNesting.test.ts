import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES_DIR = resolve(__dirname, '../../routes');

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * TanStack file-based routing nests `a.b.tsx` under `a.tsx` (and `a/b.tsx`
 * under `a.tsx`). A parent that doesn't render an `<Outlet />` swallows every
 * child URL: `/canvas/$id` silently shows the `/canvas` list page. Parents
 * that are really just pages must be `a.index.tsx` so children are siblings.
 */
describe('route nesting', () => {
  const files = routeFiles(ROUTES_DIR);
  const set = new Set(files);

  const parents = files.filter((f) => {
    const base = f.slice(0, -'.tsx'.length);
    const name = base.split('/').pop()!;
    if (name === '__root' || name === 'index' || name.endsWith('.index')) return false;
    if (name.startsWith('_') || /(^|\.)(route|lazy)$/.test(name)) return false;
    const dirChildren = (() => {
      try {
        return readdirSync(base).length > 0;
      } catch {
        return false;
      }
    })();
    const siblingChildren = files.some((o) => o !== f && o.startsWith(`${base}.`));
    return dirChildren || siblingChildren;
  });

  it('finds the route tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(set.size).toBe(files.length);
  });

  it('every route with child routes renders an <Outlet />', () => {
    const offenders = parents
      .filter((f) => !/\bOutlet\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROUTES_DIR.length + 1));
    expect(offenders).toEqual([]);
  });
});
