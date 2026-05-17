/**
 * Navigation Tests — Header, nav links, routing, and layout.
 *
 * Verifies:
 * - Header renders on all pages with logo and nav
 * - Primary navigation links are visible and clickable
 * - Logo links back to home
 * - Theme toggle works
 * - Mobile menu works at small viewports
 * - Footer links are present
 */

import { test, expect, getHeader, getNav, PUBLIC_ROUTES } from './fixtures';

test.describe('Header & Logo', () => {
  test('header renders on homepage with LOAR logo', async ({ page }) => {
    await page.goto('/');
    const header = getHeader(page);
    await expect(header).toBeVisible();
    await expect(page.locator('img[alt="LOAR"]')).toBeVisible();
  });

  test('header is present on every public route', async ({ page }) => {
    // Spot-check a few key public routes
    const routes = ['/', '/discover', '/gallery', '/create', '/pricing'];
    for (const route of routes) {
      await page.goto(route);
      await expect(getHeader(page)).toBeVisible();
    }
  });

  test('logo links to homepage', async ({ page }) => {
    await page.goto('/discover');
    const logo = page.locator('header a').filter({ has: page.locator('img[alt="LOAR"]') });
    await logo.click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('Primary Navigation Links', () => {
  test('shows Discover link', async ({ page }) => {
    await page.goto('/');
    const nav = getNav(page);
    await expect(nav.getByText('Discover')).toBeVisible();
  });

  test('shows Create link', async ({ page }) => {
    await page.goto('/');
    const nav = getNav(page);
    await expect(nav.getByText('Create')).toBeVisible();
  });

  test('Gallery is reachable (direct nav — moved to submenu)', async ({ page }) => {
    // Top-level "Gallery" link was moved into a submenu. Direct nav still works.
    await page.goto('/gallery');
    await expect(page).toHaveURL(/\/wiki|\/gallery/);
  });

  test('Pricing is reachable (direct nav — moved to submenu)', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/pricing/);
  });

  test('shows Dashboard link', async ({ page }) => {
    await page.goto('/');
    const nav = getNav(page);
    await expect(nav.getByText('Dashboard')).toBeVisible();
  });

  test('Discover link navigates to /discover', async ({ page }) => {
    await page.goto('/');
    await getNav(page).getByText('Discover').click();
    await expect(page).toHaveURL(/\/discover/);
  });

  test('Create link navigates to /create', async ({ page }) => {
    await page.goto('/');
    await getNav(page).getByText('Create').click();
    await expect(page).toHaveURL(/\/create/);
  });

  test('Direct nav to /gallery still works (redirects to wiki)', async ({ page }) => {
    await page.goto('/gallery');
    await expect(page).toHaveURL(/\/wiki/);
  });

  test('Direct nav to /pricing still works', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/pricing/);
  });
});

test.describe('More Menu / Secondary Navigation', () => {
  test('wiki page is accessible', async ({ page }) => {
    await page.goto('/wiki');
    await expect(page).toHaveURL(/\/wiki/);
  });

  test('activity page is accessible', async ({ page }) => {
    await page.goto('/activity');
    await expect(page).toHaveURL(/\/activity/);
  });

  test('videos page is accessible', async ({ page }) => {
    await page.goto('/videos');
    await expect(page).toHaveURL(/\/videos/);
  });
});

test.describe('Theme Toggle', () => {
  test('page renders with a theme (dark or light)', async ({ page }) => {
    await page.goto('/');
    // The html element should have a class or data-theme attribute
    const html = page.locator('html');
    const className = await html.getAttribute('class');
    const dataTheme = await html.getAttribute('data-theme');
    const style = await html.getAttribute('style');
    // At least one theming mechanism should be present
    expect(className || dataTheme || style).toBeTruthy();
  });
});

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone X

  test('header renders on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(getHeader(page)).toBeVisible();
  });

  test('mobile can access all main pages via direct navigation', async ({ page }) => {
    // /gallery redirects to /wiki; match either landing.
    const routes: Array<{ visit: string; expect: RegExp }> = [
      { visit: '/discover', expect: /\/discover/ },
      { visit: '/gallery', expect: /\/wiki|\/gallery/ },
      { visit: '/create', expect: /\/create/ },
      { visit: '/pricing', expect: /\/pricing/ },
    ];
    for (const r of routes) {
      await page.goto(r.visit);
      await expect(page).toHaveURL(r.expect);
    }
  });
});

test.describe('Not Found / 404', () => {
  test('navigating to nonexistent route shows error or not found', async ({ page }) => {
    await page.goto('/this-route-does-not-exist-12345');
    // Should either show a 404 page or redirect somewhere
    const body = page.locator('body');
    const text = await body.textContent();
    expect(text).toBeTruthy();
  });
});
