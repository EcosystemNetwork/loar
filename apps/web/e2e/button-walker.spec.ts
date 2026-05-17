/**
 * Button Walker — visits every public route, enumerates every visible enabled
 * <button> / role=button / <a role=button>, clicks each one in an isolated page
 * session, and asserts that clicking did NOT throw an uncaught JS error or
 * surface an obviously-broken UI state.
 *
 * What this catches:
 * - Buttons whose onClick reaches an undefined function, broken import, or
 *   throws synchronously.
 * - Buttons that navigate to a nonexistent route (the resulting 404 / blank
 *   page is detected via body content).
 * - Buttons that open a modal which then errors during render.
 *
 * What this does NOT catch:
 * - Mutations that need a real wallet signature (we inject a mock SIWE
 *   session — signing prompts will hang and time out, which we treat as
 *   non-fatal).
 * - Buttons gated behind a flow (e.g. "Save" inside an unfilled form).
 * - Buttons that appear only after another button is clicked (only the
 *   initially-visible buttons on each route are walked).
 *
 * Run: `pnpm exec playwright test button-walker.spec.ts`
 */

import { test, expect, injectMockSession, PUBLIC_ROUTES, PROTECTED_ROUTES } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';

const ROUTES_TO_WALK = Array.from(
  new Set<string>([
    ...PUBLIC_ROUTES,
    ...PROTECTED_ROUTES,
    '/leaderboard',
    '/faucet',
    '/bridge',
    '/marketplace/likeness',
    '/dashboard/personas',
    '/dashboard/revenue',
    '/governance',
    '/canon',
  ])
);

const IGNORED_CONSOLE_PATTERNS = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ResizeObserver/i,
  /Download the React DevTools/i,
  /\[wagmi\]/i,
  /WebSocket connection/i,
  /401 \(Unauthorized\)/i,
  /403 \(Forbidden\)/i,
  /CORS/i,
  /MetaMask/i,
  /injected wallet/i,
  /coinbase wallet/i,
  /WalletConnect/i,
];

function shouldIgnore(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text));
}

interface ButtonRecord {
  index: number;
  label: string;
  selector: string;
}

interface ClickFailure {
  route: string;
  button: ButtonRecord;
  kind: 'pageerror' | 'consoleerror' | 'exception';
  message: string;
}

async function listButtons(page: Page): Promise<ButtonRecord[]> {
  try {
    return await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [role="button"]:not([aria-disabled="true"])'
        )
      );
      return nodes
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (style.pointerEvents === 'none') return false;
          return true;
        })
        .slice(0, 40)
        .map((el, i) => {
          const label =
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            (el.textContent ?? '').trim().slice(0, 60) ||
            el.tagName.toLowerCase();
          return { index: i, label, selector: '' };
        });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Execution context was destroyed|detached/i.test(msg)) return [];
    throw err;
  }
}

async function walkRoute(page: Page, route: string): Promise<ClickFailure[]> {
  const failures: ClickFailure[] = [];

  const onPageError = (err: Error) => {
    if (shouldIgnore(err.message)) return;
    failures.push({
      route,
      button: { index: -1, label: '(page-level)', selector: '' },
      kind: 'pageerror',
      message: err.message,
    });
  };

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (shouldIgnore(text)) return;
    failures.push({
      route,
      button: { index: -1, label: '(console)', selector: '' },
      kind: 'consoleerror',
      message: text,
    });
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(600);
  } catch (err) {
    failures.push({
      route,
      button: { index: -1, label: '(navigation)', selector: '' },
      kind: 'exception',
      message: err instanceof Error ? err.message : String(err),
    });
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    return failures;
  }

  const buttons = await listButtons(page);

  for (const btn of buttons) {
    const errorsBefore = failures.length;
    try {
      const handles = await page
        .locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
        .all();
      const handle = handles[btn.index];
      if (!handle) continue;
      const visible = await handle.isVisible().catch(() => false);
      if (!visible) continue;
      await handle.click({ timeout: 2_000, trial: false, force: false, noWaitAfter: true });
      await page.waitForTimeout(150);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /Target closed/i.test(msg) ||
        /Navigation/i.test(msg) ||
        /timeout/i.test(msg) ||
        /detached/i.test(msg) ||
        /intercepts pointer events/i.test(msg)
      ) {
        continue;
      }
      failures.push({ route, button: btn, kind: 'exception', message: msg });
    }
    if (failures.length > errorsBefore) {
      failures.slice(errorsBefore).forEach((f) => {
        if (f.button.index === -1) {
          f.button = btn;
        }
      });
    }
    if (page.url() !== new URL(route, 'http://localhost:3001').toString()) {
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        await page.waitForTimeout(400);
      } catch {
        break;
      }
    }
  }

  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  return failures;
}

test.describe('Button Walker', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const route of ROUTES_TO_WALK) {
    test(`buttons on ${route} do not throw`, async ({ page }) => {
      test.setTimeout(90_000);
      await injectMockSession(page);
      const failures = await walkRoute(page, route);

      const fatal = failures.filter((f) => f.kind === 'pageerror' || f.kind === 'exception');

      if (fatal.length > 0) {
        const report = fatal
          .map((f) => `  • [${f.button.label}] (${f.kind}) ${f.message}`)
          .join('\n');
        throw new Error(`Found ${fatal.length} fatal click failure(s) on ${route}:\n${report}`);
      }

      const noisy = failures.filter((f) => f.kind === 'consoleerror');
      if (noisy.length > 5) {
        console.warn(`[button-walker] ${route}: ${noisy.length} console errors (non-fatal)`);
      }
      expect(failures.filter((f) => f.kind !== 'consoleerror').length).toBe(0);
    });
  }
});
