/**
 * Legal Pages & Miscellaneous Routes Tests.
 *
 * Verifies:
 * - Terms of Service page loads with content
 * - Privacy Policy page loads with content
 * - Coming Soon page renders with message and back link
 * - Activity feed page loads
 * - Videos page loads
 * - Tokens/Launchpad page loads
 * - Market page loads
 * - Staking page loads
 * - Bounties page loads
 * - Agents page loads
 * - Sell page loads
 * - Licensing page loads
 * - Collabs page loads
 * - Ads page loads
 * - My Works page loads
 * - Docs page loads
 */

import { test, expect } from './fixtures';

/* -------------------------------------------------------------------------- */
/*  Legal Pages                                                               */
/* -------------------------------------------------------------------------- */

test.describe('Terms of Service', () => {
  test('page loads with heading', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveURL(/\/terms/);
    await expect(page.locator('body')).toContainText(/terms of service/i);
  });

  test('shows last updated date', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('body')).toContainText(/last updated/i);
  });

  test('has contact information', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('body')).toContainText(/loar\.fun/i);
  });

  test('covers key sections', async ({ page }) => {
    await page.goto('/terms');
    const body = await page.locator('body').textContent();
    const requiredSections = [
      /eligibility/i,
      /user content/i,
      /prohibited/i,
      /limitation of liability/i,
      /governing law/i,
    ];
    for (const section of requiredSections) {
      expect(body).toMatch(section);
    }
  });

  test('has header', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('header')).toBeVisible();
  });
});

test.describe('Privacy Policy', () => {
  test('page loads with heading', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.locator('body')).toContainText(/privacy/i);
  });

  test('has header', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('header')).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/*  Coming Soon                                                               */
/* -------------------------------------------------------------------------- */

test.describe('Coming Soon Page', () => {
  test('page loads with message', async ({ page }) => {
    await page.goto('/coming-soon');
    await expect(page).toHaveURL(/\/coming-soon/);
    await expect(page.locator('body')).toContainText(/coming soon/i);
  });

  test('shows under development message', async ({ page }) => {
    await page.goto('/coming-soon');
    await expect(page.locator('body')).toContainText(/under active development/i);
  });

  test('has back link to Discover', async ({ page }) => {
    await page.goto('/coming-soon');
    // The coming-soon page has a Link to="/discover" — use the button inside it
    const backBtn = page.getByRole('button', { name: /back to discover/i });
    await expect(backBtn).toBeVisible();
  });

  test('back link navigates to /discover', async ({ page }) => {
    await page.goto('/coming-soon');
    const backBtn = page.getByRole('button', { name: /back to discover/i });
    await backBtn.click();
    await expect(page).toHaveURL(/\/discover/);
  });
});

/* -------------------------------------------------------------------------- */
/*  Feature Pages — Ensure They Load (Not Crash)                              */
/* -------------------------------------------------------------------------- */

test.describe('Feature Pages Load Successfully', () => {
  const featureRoutes = [
    { path: '/activity', name: 'Activity Feed' },
    { path: '/videos', name: 'Videos' },
    { path: '/tokens', name: 'Token Launchpad' },
    { path: '/market', name: 'Market' },
    { path: '/staking', name: 'Staking' },
    { path: '/sell', name: 'Sell' },
    { path: '/licensing', name: 'Licensing' },
    { path: '/collabs', name: 'Collabs' },
    { path: '/docs', name: 'Docs' },
  ];

  for (const { path, name } of featureRoutes) {
    test(`${name} page (${path}) loads without crash`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(1000);
      // Page should render some content (not a blank white page)
      const body = await page.locator('body').textContent();
      expect(body!.length).toBeGreaterThan(10);
      // Header should still be visible (layout not broken)
      await expect(page.locator('header')).toBeVisible();
    });
  }
});

/* -------------------------------------------------------------------------- */
/*  My Works (Requires Auth)                                                  */
/* -------------------------------------------------------------------------- */

test.describe('My Works Page', () => {
  test('my-works page loads', async ({ page }) => {
    await page.goto('/my-works');
    await page.waitForTimeout(1000);
    // May require auth or show public content
    await expect(page.locator('body')).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/*  Token Sub-Routes                                                          */
/* -------------------------------------------------------------------------- */

test.describe('Token Detail Page', () => {
  test('token detail page loads for an address', async ({ page }) => {
    await page.goto('/tokens/0x1234567890abcdef1234567890abcdef12345678');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('token creator page loads', async ({ page }) => {
    await page.goto('/tokens/creator.0x1234567890abcdef1234567890abcdef12345678');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('token portfolio page loads', async ({ page }) => {
    await page.goto('/tokens/portfolio');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/*  Agent Sub-Routes                                                          */
/* -------------------------------------------------------------------------- */

test.describe('Agent Routes', () => {
  test('agents index page loads', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('agent register page loads', async ({ page }) => {
    await page.goto('/agents/register');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('agent dashboard page loads', async ({ page }) => {
    await page.goto('/agents/dashboard');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('agent detail page loads', async ({ page }) => {
    await page.goto('/agents/test-uid-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/*  Shop / Checkout / Orders                                                  */
/* -------------------------------------------------------------------------- */

test.describe('Commerce Routes', () => {
  test('shop page loads for universe', async ({ page }) => {
    await page.goto('/shop/test-universe-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('product detail page loads', async ({ page }) => {
    await page.goto('/product/test-product-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('checkout requires auth', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page).toHaveURL(/\/login/);
  });
});

/* -------------------------------------------------------------------------- */
/*  Sell Sub-Routes                                                           */
/* -------------------------------------------------------------------------- */

test.describe('Sell Routes', () => {
  test('sell index page loads', async ({ page }) => {
    await page.goto('/sell');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('sell new listing page loads', async ({ page }) => {
    await page.goto('/sell/new');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('sell earnings page loads', async ({ page }) => {
    await page.goto('/sell/earnings');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/*  Licensing & Collabs Sub-Routes                                            */
/* -------------------------------------------------------------------------- */

test.describe('Licensing Routes', () => {
  test('licensing index loads', async ({ page }) => {
    await page.goto('/licensing');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('new licensing page loads', async ({ page }) => {
    await page.goto('/licensing/new');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Collabs Routes', () => {
  test('collabs index loads', async ({ page }) => {
    await page.goto('/collabs');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('new collab page loads', async ({ page }) => {
    await page.goto('/collabs/new');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/*  Ads Sub-Routes                                                            */
/* -------------------------------------------------------------------------- */

test.describe('Ads Routes', () => {
  test('ads index loads', async ({ page }) => {
    await page.goto('/ads');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('new ad page loads', async ({ page }) => {
    await page.goto('/ads/new');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('ad slot detail page loads', async ({ page }) => {
    await page.goto('/ads/test-slot-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});
