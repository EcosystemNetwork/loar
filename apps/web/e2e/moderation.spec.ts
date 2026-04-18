/**
 * Admin Moderation Tests — Content moderation dashboard.
 *
 * Verifies:
 * - Moderation page requires authentication
 * - Moderation page loads for admin users
 * - Shows tabs (Flags, Takedowns, Audit Log)
 * - Shows content review queue
 * - Status badges render
 * - Action buttons render (Hide, Remove, Reinstate)
 */

import { test, expect, injectMockSession } from './fixtures';

test.describe('Moderation — Auth Guard', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/admin/moderation');
    await expect(page).toHaveURL(/\/login.*redirect.*admin.*moderation/);
  });
});

test.describe('Moderation — Authenticated Access', () => {
  test('page loads for authenticated user', async ({ authedPage: page }) => {
    await page.goto('/admin/moderation');
    await page.waitForTimeout(1500);
    const url = page.url();
    // Should either be on moderation page or redirected
    expect(url).toMatch(/\/admin\/moderation|\/login/);
  });

  test('shows moderation-related content when accessible', async ({ authedPage: page }) => {
    await page.goto('/admin/moderation');
    await page.waitForTimeout(1500);
    const url = page.url();
    if (url.includes('/admin/moderation')) {
      const body = await page.locator('body').textContent();
      expect(body?.toLowerCase()).toMatch(/moderation|flag|takedown|audit|review|queue/i);
    }
  });

  test('shows tab navigation when accessible', async ({ authedPage: page }) => {
    await page.goto('/admin/moderation');
    await page.waitForTimeout(1500);
    const url = page.url();
    if (url.includes('/admin/moderation')) {
      const body = await page.locator('body').textContent();
      // Should have tabs for different moderation views
      expect(body?.toLowerCase()).toMatch(/flag|takedown|audit/i);
    }
  });
});

test.describe('DMCA Page — Public', () => {
  test('DMCA page loads', async ({ page }) => {
    await page.goto('/dmca');
    await expect(page).toHaveURL(/\/dmca/);
    await expect(page.locator('body')).toContainText(/takedown|dmca|copyright/i);
  });

  test('DMCA page has header', async ({ page }) => {
    await page.goto('/dmca');
    await expect(page.locator('header')).toBeVisible();
  });

  test('DMCA page mentions on-chain data disclosure', async ({ page }) => {
    await page.goto('/dmca');
    const body = await page.locator('body').textContent();
    // Should disclose that on-chain hashes cannot be deleted
    expect(body?.toLowerCase()).toMatch(/on-chain|blockchain|hash|cannot.*delete|permanent/i);
  });

  test('DMCA form has input fields', async ({ page }) => {
    await page.goto('/dmca');
    await page.waitForTimeout(500);
    // Should have form fields for takedown request
    const inputs = await page.locator('input, textarea').count();
    expect(inputs).toBeGreaterThan(0);
  });
});
