#!/usr/bin/env tsx
/**
 * Visual QA of the web frontend using Playwright + Claude VLM.
 *
 * Usage:
 *   pnpm qa:visual                       # screenshot default route set, both viewports
 *   pnpm qa:visual --routes /,/pricing   # subset of routes
 *   pnpm qa:visual --viewport desktop    # one viewport
 *   pnpm qa:visual --no-review           # screenshots only, skip VLM
 *
 * Requires:
 *   - dev server running at BASE_URL (default http://localhost:3001)
 *   - ANTHROPIC_API_KEY in env (unless --no-review)
 */

import { chromium, type Browser, type Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { ROUTES, VIEWPORTS, type RouteSpec, type Viewport } from './routes';
import { QA_RUBRIC } from './rubric';

loadEnv({ path: resolve(process.cwd(), '.env') });

const BASE_URL = process.env.QA_VISUAL_BASE_URL || 'http://localhost:3001';
const MODEL = process.env.QA_VISUAL_MODEL || 'claude-opus-4-7';

type Args = {
  routes?: string[];
  viewport?: string;
  noReview: boolean;
  outDir: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { noReview: false, outDir: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--routes') args.routes = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--viewport') args.viewport = argv[++i];
    else if (a === '--no-review') args.noReview = true;
    else if (a === '--out') args.outDir = argv[++i];
  }
  if (!args.outDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    args.outDir = resolve(process.cwd(), `docs/qa/visual-${stamp}`);
  }
  return args;
}

type Shot = {
  route: RouteSpec;
  viewport: Viewport;
  file: string;
  url: string;
  consoleErrors: string[];
  loadError?: string;
};

async function screenshotRoute(
  browser: Browser,
  route: RouteSpec,
  viewport: Viewport,
  outDir: string
): Promise<Shot> {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page: Page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message.slice(0, 500)}`));

  const url = `${BASE_URL}${route.path}`;
  const file = join(outDir, `${route.name}.${viewport.name}.png`);
  let loadError: string | undefined;

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    if (route.waitFor) await page.waitForSelector(route.waitFor, { timeout: 5_000 });
    await page.waitForTimeout(800);
    if (route.scroll) {
      await page.evaluate(async () => {
        await new Promise<void>((r) => {
          let y = 0;
          const step = 400;
          const id = setInterval(() => {
            window.scrollBy(0, step);
            y += step;
            if (y >= document.body.scrollHeight) {
              clearInterval(id);
              window.scrollTo(0, 0);
              r();
            }
          }, 60);
        });
      });
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    try {
      await page.screenshot({ path: file, fullPage: false });
    } catch {
      // leave file missing
    }
  } finally {
    await ctx.close();
  }
  return { route, viewport, file, url, consoleErrors, loadError };
}

type Issue = {
  category: string;
  severity: 'minor' | 'major' | 'broken';
  description: string;
  location: string;
  fix: string;
};
type Review = { summary: string; severity: 'pass' | 'minor' | 'major' | 'broken'; issues: Issue[] };

async function reviewShot(anthropic: Anthropic, shot: Shot): Promise<Review | { error: string }> {
  if (!existsSync(shot.file)) return { error: shot.loadError ?? 'no screenshot captured' };
  const b64 = readFileSync(shot.file).toString('base64');
  const contextBits: string[] = [
    `Route: ${shot.route.path} (${shot.viewport.name} ${shot.viewport.width}x${shot.viewport.height})`,
  ];
  if (shot.loadError) contextBits.push(`Navigation error: ${shot.loadError}`);
  if (shot.consoleErrors.length)
    contextBits.push(`Console errors:\n- ${shot.consoleErrors.slice(0, 5).join('\n- ')}`);

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [{ type: 'text', text: QA_RUBRIC, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: contextBits.join('\n\n') + '\n\nReturn only the JSON object.' },
        ],
      },
    ],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { error: `no JSON in response: ${text.slice(0, 200)}` };
  try {
    return JSON.parse(match[0]) as Review;
  } catch (e) {
    return { error: `invalid JSON: ${(e as Error).message}` };
  }
}

function renderReport(shots: Shot[], reviews: Map<string, Review | { error: string }>): string {
  const lines: string[] = [
    `# Visual QA Report`,
    ``,
    `- Base URL: \`${BASE_URL}\``,
    `- Model: \`${MODEL}\``,
    `- Generated: ${new Date().toISOString()}`,
    `- Shots: ${shots.length}`,
    ``,
  ];

  const buckets: Record<string, Shot[]> = {
    broken: [],
    major: [],
    minor: [],
    pass: [],
    error: [],
    'no-review': [],
  };
  for (const s of shots) {
    const key = `${s.route.name}.${s.viewport.name}`;
    const r = reviews.get(key);
    if (!r) buckets['no-review'].push(s);
    else if ('error' in r) buckets.error.push(s);
    else buckets[r.severity].push(s);
  }
  lines.push(`## Summary`);
  const summaryParts = [
    `Broken: ${buckets.broken.length}`,
    `Major: ${buckets.major.length}`,
    `Minor: ${buckets.minor.length}`,
    `Pass: ${buckets.pass.length}`,
    `Errors: ${buckets.error.length}`,
  ];
  if (buckets['no-review'].length) summaryParts.push(`No-review: ${buckets['no-review'].length}`);
  lines.push(`- ${summaryParts.join('  |  ')}`);
  lines.push(``);

  const order = ['broken', 'major', 'minor', 'pass', 'error', 'no-review'] as const;
  for (const sev of order) {
    const list = buckets[sev];
    if (!list.length) continue;
    lines.push(`## ${sev.toUpperCase()} (${list.length})`);
    lines.push(``);
    for (const s of list) {
      const key = `${s.route.name}.${s.viewport.name}`;
      const r = reviews.get(key);
      lines.push(`### ${s.route.path} — ${s.viewport.name}`);
      lines.push(`- URL: ${s.url}`);
      lines.push(`- Screenshot: \`${s.file}\``);
      if (s.consoleErrors.length) lines.push(`- Console errors: ${s.consoleErrors.length}`);
      if (!r) {
        lines.push(`- _no review_`);
      } else if ('error' in r) {
        lines.push(`- Review error: ${r.error}`);
      } else {
        lines.push(`- Summary: ${r.summary}`);
        if (r.issues.length) {
          lines.push(`- Issues:`);
          for (const i of r.issues) {
            lines.push(
              `  - **[${i.severity}/${i.category}]** ${i.description} _(${i.location})_ — ${i.fix}`
            );
          }
        }
      }
      lines.push(``);
    }
  }
  return lines.join('\n');
}

async function waitForBaseUrl(): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const args = parseArgs();
  const routes = args.routes
    ? ROUTES.filter((r) => args.routes!.includes(r.path))
    : ROUTES.filter((r) => !r.skip);
  const viewports = args.viewport ? VIEWPORTS.filter((v) => v.name === args.viewport) : VIEWPORTS;
  if (!routes.length) throw new Error('no routes matched');
  if (!viewports.length) throw new Error('no viewports matched');

  mkdirSync(args.outDir, { recursive: true });

  console.log(`[qa-visual] base=${BASE_URL}`);
  console.log(`[qa-visual] out=${args.outDir}`);
  console.log(`[qa-visual] routes=${routes.length} viewports=${viewports.length}`);

  const up = await waitForBaseUrl();
  if (!up) {
    console.error(
      `[qa-visual] ${BASE_URL} is not reachable. Start the dev server first (pnpm dev:web).`
    );
    process.exit(1);
  }

  const browser = await chromium.launch();
  const shots: Shot[] = [];
  try {
    for (const route of routes) {
      for (const vp of viewports) {
        process.stdout.write(`[qa-visual] shooting ${route.path} @ ${vp.name}... `);
        const s = await screenshotRoute(browser, route, vp, args.outDir);
        shots.push(s);
        console.log(s.loadError ? `error (${s.loadError.slice(0, 60)})` : 'ok');
      }
    }
  } finally {
    await browser.close();
  }

  const reviews = new Map<string, Review | { error: string }>();
  if (args.noReview) {
    console.log(`[qa-visual] skipping VLM review (--no-review)`);
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(
        `[qa-visual] ANTHROPIC_API_KEY not set. Re-run with --no-review or export the key.`
      );
      process.exit(2);
    }
    const anthropic = new Anthropic({ apiKey });
    const concurrency = 4;
    let idx = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (idx < shots.length) {
        const s = shots[idx++];
        const key = `${s.route.name}.${s.viewport.name}`;
        process.stdout.write(`[qa-visual] review ${key}... `);
        try {
          const r = await reviewShot(anthropic, s);
          reviews.set(key, r);
          const sev = 'error' in r ? 'ERR' : r.severity;
          console.log(sev);
        } catch (e) {
          reviews.set(key, { error: (e as Error).message });
          console.log(`err: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    });
    await Promise.all(workers);
  }

  const report = renderReport(shots, reviews);
  const reportPath = join(args.outDir, 'report.md');
  writeFileSync(reportPath, report);
  writeFileSync(
    join(args.outDir, 'raw.json'),
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        model: MODEL,
        generatedAt: new Date().toISOString(),
        shots: shots.map((s) => ({
          route: s.route.path,
          viewport: s.viewport.name,
          file: s.file,
          url: s.url,
          consoleErrors: s.consoleErrors,
          loadError: s.loadError,
        })),
        reviews: Object.fromEntries(reviews),
      },
      null,
      2
    )
  );
  console.log(`[qa-visual] wrote ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
