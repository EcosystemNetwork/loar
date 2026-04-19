#!/usr/bin/env node
/**
 * Bundle size budget check for apps/web.
 *
 * Reads every JS file under apps/web/dist/assets, gzips it in memory, and
 * fails the build when any chunk exceeds its configured budget. Prints a
 * full table so regressions are visible even when the check passes.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs             # checks with defaults
 *   node scripts/check-bundle-size.mjs --report    # table only, no fail
 *
 * Add a per-chunk override when a chunk is legitimately large (e.g. thirdweb's
 * first party wallet UI). Do not raise the default without discussion —
 * the whole point is to catch creeping regressions at 10K user scale.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ASSETS_DIR = path.join(ROOT, 'apps/web/dist/assets');

// Budgets in KB gzipped. Chunks matched by basename prefix (before the hash).
const DEFAULT_BUDGET_KB = 1500;
const OVERRIDES = {
  // Wallet + viem are known-heavy because they carry full chain/crypto code.
  // Keep these as the ceiling — if they creep, code-split by route first.
  'wallet-adapters': 2200,
  viem: 1600,
};

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report');

function budgetFor(name) {
  for (const key of Object.keys(OVERRIDES)) {
    if (name.startsWith(key)) return OVERRIDES[key];
  }
  return DEFAULT_BUDGET_KB;
}

async function main() {
  let entries;
  try {
    entries = await readdir(ASSETS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`[bundle-size] ${ASSETS_DIR} does not exist. Run \`pnpm --filter web build\` first.`);
      process.exit(2);
    }
    throw err;
  }

  const jsFiles = entries.filter((f) => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    console.error('[bundle-size] No .js files in dist/assets.');
    process.exit(2);
  }

  const rows = [];
  let failed = 0;
  for (const file of jsFiles) {
    const full = path.join(ASSETS_DIR, file);
    const [buf, info] = await Promise.all([readFile(full), stat(full)]);
    const gz = gzipSync(buf);
    // chunk name = file up to the first hyphen-hash (e.g. wallet-adapters-abc123.js)
    const chunkName = file.replace(/-[a-zA-Z0-9_-]{8,}\.js$/, '').replace(/\.js$/, '');
    const budget = budgetFor(chunkName);
    const gzKb = gz.length / 1024;
    const overBudget = gzKb > budget;
    if (overBudget) failed++;
    rows.push({
      file,
      chunkName,
      rawKb: info.size / 1024,
      gzKb,
      budget,
      overBudget,
    });
  }

  rows.sort((a, b) => b.gzKb - a.gzKb);

  const nameWidth = Math.max(...rows.map((r) => r.chunkName.length), 10);
  console.log(
    `${'chunk'.padEnd(nameWidth)}  ${'raw KB'.padStart(9)}  ${'gzip KB'.padStart(9)}  ${'budget KB'.padStart(11)}  status`
  );
  console.log('-'.repeat(nameWidth + 44));
  for (const r of rows) {
    const status = r.overBudget ? 'FAIL' : 'ok';
    console.log(
      `${r.chunkName.padEnd(nameWidth)}  ` +
        `${r.rawKb.toFixed(1).padStart(9)}  ` +
        `${r.gzKb.toFixed(1).padStart(9)}  ` +
        `${r.budget.toString().padStart(11)}  ${status}`
    );
  }

  console.log();
  if (failed > 0 && !reportOnly) {
    console.error(`[bundle-size] ${failed} chunk(s) over budget — failing the build.`);
    console.error(
      '  If a regression is justified, raise the override in scripts/check-bundle-size.mjs'
    );
    console.error('  or code-split the offending chunk behind a route lazy-load.');
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`[bundle-size] ${failed} chunk(s) over budget (report-only mode).`);
    process.exit(0);
  }
  console.log(`[bundle-size] All ${rows.length} chunk(s) within budget.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
