/**
 * Smoke e2e tests — critical paths for beta launch.
 *
 * These verify that pages load, key UI renders, navigation works, and
 * partial-feature routes correctly redirect to "Coming Soon".
 *
 * Full wallet-auth flows require a mock SIWE provider and are out of
 * scope for this initial suite.
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// 1. Landing / Discovery
// ---------------------------------------------------------------------------

test.describe('Landing & Discovery', () => {
  test('homepage loads with header and hero', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('img[alt="LOAR Logo"]')).toBeVisible();
  });

  test('discover page renders', async ({ page }) => {
    await page.goto('/discover');
    await expect(page).toHaveURL(/\/discover/);
    await expect(page.locator('header')).toBeVisible();
  });

  test('gallery page renders', async ({ page }) => {
    await page.goto('/gallery');
    await expect(page).toHaveURL(/\/gallery/);
  });
});

// ---------------------------------------------------------------------------
// 2. Auth guard — unauthenticated users
// ---------------------------------------------------------------------------

test.describe('Auth guards', () => {
  test('dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page renders wallet connect', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);
    // The page should contain some sign-in prompt
    await expect(page.locator('body')).toContainText(/sign|connect|wallet/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Universe creation flow (UI loads, form renders)
// ---------------------------------------------------------------------------

test.describe('Create flow', () => {
  test('create hub page loads', async ({ page }) => {
    await page.goto('/create');
    await expect(page).toHaveURL(/\/create/);
    await expect(page.locator('body')).toContainText(/create/i);
  });
});

// ---------------------------------------------------------------------------
// 4. AI generation page (sandbox loads)
// ---------------------------------------------------------------------------

test.describe('AI Generation', () => {
  test('sandbox page loads', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page).toHaveURL(/\/sandbox/);
  });
});

// ---------------------------------------------------------------------------
// 5. Credits / Pricing
// ---------------------------------------------------------------------------

test.describe('Credits & Pricing', () => {
  test('pricing page renders', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/pricing/);
    await expect(page.locator('body')).toContainText(/credit|price|plan/i);
  });

  test('faucet page renders', async ({ page }) => {
    await page.goto('/credits');
    await expect(page).toHaveURL(/\/credits/);
  });
});

// ---------------------------------------------------------------------------
// 6. Moderation & Legal
// ---------------------------------------------------------------------------

test.describe('Moderation & Legal', () => {
  test('DMCA page renders', async ({ page }) => {
    await page.goto('/dmca');
    await expect(page).toHaveURL(/\/dmca/);
    await expect(page.locator('body')).toContainText(/takedown|dmca|copyright/i);
  });

  test('terms page renders', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveURL(/\/terms/);
    await expect(page.locator('body')).toContainText(/terms of service/i);
  });

  test('privacy page renders', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.locator('body')).toContainText(/privacy/i);
  });
});

// ---------------------------------------------------------------------------
// 7. Partial-feature routes redirect to Coming Soon
// ---------------------------------------------------------------------------

test.describe('Partial features redirect to Coming Soon', () => {
  const partialRoutes = [
    '/tokens',
    '/licensing',
    '/collabs',
    '/ads',
    '/market',
    '/sell',
    '/staking',
    '/bounties',
  ];

  for (const route of partialRoutes) {
    test(`${route} redirects to coming-soon`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/coming-soon/);
      await expect(page.locator('body')).toContainText(/coming soon/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Navigation structure
// ---------------------------------------------------------------------------

test.describe('Navigation', () => {
  test('header shows expected primary links', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('header nav').first();
    await expect(nav.getByText('Discover')).toBeVisible();
    await expect(nav.getByText('Create')).toBeVisible();
    await expect(nav.getByText('Gallery')).toBeVisible();
    await expect(nav.getByText('Pricing')).toBeVisible();
    await expect(nav.getByText('Dashboard')).toBeVisible();
  });

  test('header does NOT show hidden partial-feature links', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header');
    // These should not appear as direct nav items
    await expect(header.getByRole('link', { name: 'Launchpad' })).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Licensing' })).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Collabs' })).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Ads' })).toHaveCount(0);
  });

  test('wiki page is accessible from More menu', async ({ page }) => {
    await page.goto('/wiki');
    await expect(page).toHaveURL(/\/wiki/);
  });
});
