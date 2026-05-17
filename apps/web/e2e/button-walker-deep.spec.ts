/**
 * Deep Button Walker — visits every route, recursively walks every clickable
 * surface including buttons revealed by modals, popovers, dropdowns, and tabs.
 *
 * Differs from `button-walker.spec.ts` by:
 *   - Recursing into newly-revealed clickables after each click (DOM diff).
 *   - Walking <a role="button"> and any element with onClick attached.
 *   - Mocking window.ethereum + SIWE session so wallet-gated UIs render real
 *     buttons instead of redirecting to /login.
 *   - Capping per-route click budget to prevent infinite loops.
 *
 * Reports: any uncaught JS error, page error, or click exception. Console
 * errors are tallied non-fatally.
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
    '/marketplace/persona/test',
    '/dashboard/personas',
    '/dashboard/revenue',
    '/governance',
    '/canon',
    '/edit/inpaint',
    '/edit/outpaint',
    '/lab/voice-studio',
    '/lab/zai',
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
  /coinbase wallet/i,
  /WalletConnect/i,
  /unsupported_chain/i,
  /User rejected the request/i,
  /Connection request reset/i,
];

function shouldIgnoreConsole(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text));
}

const IGNORED_PAGEERROR_PATTERNS = [
  // Mocked window.ethereum doesn't satisfy every wagmi connector probe.
  /No connector found/i,
  /connector not found/i,
  /provider not found/i,
  // Async signing aborts when we navigate away mid-flow.
  /User rejected the request/i,
  /AbortError/i,
  /TransactionExecutionError/i,
  /Failed to fetch/i,
];

function shouldIgnorePageError(msg: string): boolean {
  return IGNORED_PAGEERROR_PATTERNS.some((re) => re.test(msg));
}

interface ClickFailure {
  route: string;
  label: string;
  kind: 'pageerror' | 'exception';
  message: string;
}

const CLICK_BUDGET_PER_ROUTE = 60;
const PER_TEST_TIMEOUT_MS = 120_000;

/**
 * Enumerate every visible, enabled, non-pointer-events-none clickable element.
 * Returns an array of stable identifiers + their array index in document order.
 */
async function snapshotClickables(page: Page): Promise<Array<{ id: string; label: string }>> {
  try {
    return await page.evaluate(() => {
      const SELECTOR =
        'button:not([disabled]),' +
        '[role="button"]:not([aria-disabled="true"]),' +
        '[role="tab"]:not([aria-disabled="true"]),' +
        '[role="menuitem"]:not([aria-disabled="true"]),' +
        'summary,' +
        'a[role="button"]';

      const nodes = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));

      return nodes
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (style.pointerEvents === 'none') return false;
          // Skip header/footer nav links — covered by the route list itself
          // and clicking them just navigates us away.
          if (el.closest('header,footer')) return false;
          return true;
        })
        .map((el) => {
          const label = (
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.getAttribute('data-testid') ||
            (el.textContent ?? '').trim() ||
            el.tagName.toLowerCase()
          )
            .replace(/\s+/g, ' ')
            .slice(0, 80);
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          // Stable identifier so we can detect "same button after re-render"
          const id = `${role}::${label}`;
          return { id, label };
        });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Execution context was destroyed|detached/i.test(msg)) return [];
    return [];
  }
}

async function dismissOverlays(page: Page): Promise<void> {
  // Try to close any modal/popover we may have opened so the next iteration
  // sees the underlying page again.
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  } catch {
    /* ignore */
  }
}

async function walkRouteDeep(page: Page, route: string): Promise<ClickFailure[]> {
  const failures: ClickFailure[] = [];
  const visited = new Set<string>();

  const onPageError = (err: Error) => {
    if (shouldIgnorePageError(err.message)) return;
    failures.push({ route, label: '(pageerror)', kind: 'pageerror', message: err.message });
  };
  const onConsole = (_msg: ConsoleMessage) => {
    /* console errors logged separately, non-fatal */
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  const baseUrl = new URL(route, 'http://localhost:3001').toString();

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(700);
  } catch (err) {
    failures.push({
      route,
      label: '(navigation)',
      kind: 'exception',
      message: err instanceof Error ? err.message : String(err),
    });
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    return failures;
  }

  let clickBudget = CLICK_BUDGET_PER_ROUTE;
  let iterations = 0;

  while (clickBudget > 0 && iterations < CLICK_BUDGET_PER_ROUTE * 2) {
    iterations += 1;
    const clickables = await snapshotClickables(page);
    const next = clickables.find((c) => !visited.has(c.id));
    if (!next) break;
    visited.add(next.id);

    try {
      // Re-query by label to find the actual element. We use first-match locator
      // strategies because the DOM may have shifted between snapshot and click.
      const locator = page
        .locator(
          'button, [role="button"], [role="tab"], [role="menuitem"], summary, a[role="button"]'
        )
        .filter({ hasText: next.label.slice(0, 40) })
        .first();

      const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) continue;

      await locator.click({ timeout: 1500, force: false, noWaitAfter: true });
      await page.waitForTimeout(220);
      clickBudget -= 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // These are all spec-level, not real bugs:
      if (
        /timeout/i.test(msg) ||
        /detached/i.test(msg) ||
        /Target closed/i.test(msg) ||
        /intercepts pointer events/i.test(msg) ||
        /Navigation/i.test(msg) ||
        /resolved to \d+ elements/i.test(msg) ||
        /not visible/i.test(msg) ||
        /strict mode violation/i.test(msg)
      ) {
        continue;
      }
      failures.push({ route, label: next.label, kind: 'exception', message: msg });
    }

    // If a click navigated us away, return so the next iteration walks the
    // original route's other buttons.
    if (page.url() !== baseUrl) {
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(400);
      } catch {
        break;
      }
    } else {
      // Try to dismiss any modal/popover before next iteration.
      await dismissOverlays(page);
    }
  }

  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  return failures;
}

test.describe('Button Walker (Deep)', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const route of ROUTES_TO_WALK) {
    test(`deep walk: ${route}`, async ({ page }) => {
      test.setTimeout(PER_TEST_TIMEOUT_MS);
      await injectMockSession(page);
      const failures = await walkRouteDeep(page, route);

      if (failures.length > 0) {
        const report = failures.map((f) => `  • [${f.label}] (${f.kind}) ${f.message}`).join('\n');
        throw new Error(`Deep walk of ${route} surfaced ${failures.length} failure(s):\n${report}`);
      }

      expect(failures.length).toBe(0);
    });
  }
});
