/**
 * Design-token ratchet. Surfaces use theme tokens (bg-card, bg-muted,
 * border-border, text-foreground, text-muted-foreground) so dark and light
 * both work and the warm LOAR palette is consistent. Hard-coded zinc greys
 * bypass that. Remaining uses are mostly text over imagery / black overlays.
 *
 * This number may only go DOWN. If you remove zinc classes, lower it.
 * If you need a neutral, use a token instead of raising it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAX_ZINC_CLASSES = 75;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : tsxFiles(p);
    return name.endsWith('.tsx') ? [p] : [];
  });
}

describe('design tokens', () => {
  it(`hard-coded zinc classes stay at or below ${MAX_ZINC_CLASSES}`, () => {
    const count = tsxFiles(resolve(__dirname, '../..')).reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/(?<![\w-])[a-z:-]*zinc-\d{2,3}/g)?.length ?? 0),
      0
    );
    expect(count).toBeLessThanOrEqual(MAX_ZINC_CLASSES);
  });
});
