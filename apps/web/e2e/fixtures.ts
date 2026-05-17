/**
 * Shared Playwright fixtures and helpers for LOAR E2E tests.
 *
 * Provides:
 * - Mock auth session injection (SIWE cookie + localStorage)
 * - Common page-object helpers for repeated UI patterns
 * - Test data constants
 */

import { test as base, expect, type Page, type Locator } from '@playwright/test';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

export const TEST_WALLET = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
export const TEST_WALLET_SHORT = '0xDead…beeF';
export const TEST_ADMIN_WALLET = '0xAdm1Nadm1Nadm1Nadm1Nadm1Nadm1Nadm1Nadm1N';

/**
 * Routes that require wallet authentication.
 * Visiting these while unauthenticated should redirect to /login.
 */
export const PROTECTED_ROUTES = [
  '/dashboard',
  '/upload',
  '/profile/edit',
  '/admin/moderation',
  '/cinematicUniverseCreate',
  '/checkout',
] as const;

/**
 * All public routes that should load without auth.
 */
export const PUBLIC_ROUTES = [
  '/',
  '/discover',
  '/gallery',
  '/login',
  '/create',
  '/sandbox',
  '/pricing',
  '/credits',
  '/wiki',
  '/dmca',
  '/terms',
  '/privacy',
  '/coming-soon',
  '/activity',
  '/videos',
  '/tokens',
  '/market',
  '/staking',
  '/bounties',
  '/agents',
  '/sell',
  '/licensing',
  '/collabs',
  '/ads',
] as const;

/* -------------------------------------------------------------------------- */
/*  Auth helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Inject a mock SIWE session so the app thinks a wallet is connected.
 * This sets the localStorage keys that wallet-auth.ts checks.
 *
 * Call BEFORE page.goto() in tests that need authentication.
 */
export async function injectMockSession(page: Page, address = TEST_WALLET) {
  // Without these intercepts the app's /auth/me probe returns
  // {authenticated:false}, which triggers clearSiweSession() and wipes the
  // localStorage we set below — every authed test falls back to the
  // signed-out shell. These two routes keep the test session alive.
  await page.route('**/auth/me**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        address,
        provider: 'siwe',
        expiresAt: Date.now() + 86_400_000,
      }),
    })
  );
  await page.route('**/auth/refresh**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, expiresAt: Date.now() + 86_400_000 }),
    })
  );

  await page.goto('/', { waitUntil: 'commit' });

  await page.evaluate(
    ({ addr }) => {
      // Keys must match apps/web/src/lib/wallet-auth.ts ADDRESS_KEY / EXPIRY_KEY.
      localStorage.setItem('siwe-address', addr);
      localStorage.setItem('siwe-expiry', String(Date.now() + 86_400_000));
      localStorage.setItem('auth-provider', 'siwe');
    },
    { addr: address }
  );
}

/**
 * Clear mock session state.
 */
export async function clearMockSession(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('siwe-address');
    localStorage.removeItem('siwe-expiry');
    localStorage.removeItem('auth-provider');
  });
}

/* -------------------------------------------------------------------------- */
/*  Page helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Wait for the page to finish loading (no skeleton spinners visible). */
export async function waitForPageReady(page: Page) {
  // Wait for any loading spinners to disappear
  await page.waitForLoadState('domcontentloaded');
  // Give React a moment to hydrate
  await page.waitForTimeout(500);
}

/** Get the main header element. */
export function getHeader(page: Page): Locator {
  return page.locator('header').first();
}

/** Get the primary nav inside the header. */
export function getNav(page: Page): Locator {
  return page.locator('header nav').first();
}

/** Assert page has no console errors (ignoring expected warnings). */
export async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known harmless errors
      if (
        text.includes('Failed to load resource') || // expected for missing API
        text.includes('net::ERR_') || // network errors in test
        text.includes('ResizeObserver') // browser quirk
      )
        return;
      errors.push(text);
    }
  });
  return errors;
}

/* -------------------------------------------------------------------------- */
/*  Extended test fixture with auth                                           */
/* -------------------------------------------------------------------------- */

type TestFixtures = {
  authedPage: Page;
};

/**
 * Extended test fixture that provides an `authedPage` — a page with a mock
 * SIWE session pre-injected so protected routes are accessible.
 */
export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line react-hooks/rules-of-hooks -- `use` here is the Playwright fixture callback, not React's `use` hook
  authedPage: async ({ page }, use) => {
    await injectMockSession(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect };
