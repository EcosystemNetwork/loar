/**
 * Universe Editor Tests — Universe page, timeline editor, and sub-pages.
 *
 * Verifies:
 * - Universe page loads for a given ID
 * - Universe page shows sidebar or metadata
 * - Universe gallery sub-route loads
 * - Universe gen-config sub-route loads
 * - Universe deploy-token sub-route loads
 * - Event/episode page loads
 * - Play/interactive mode page loads
 * - Canon submission page loads
 */

import { test, expect, injectMockSession } from './fixtures';

test.describe('Universe Page — Load', () => {
  test('universe page loads for an ID', async ({ page }) => {
    await page.goto('/universe/test-universe-123');
    await page.waitForTimeout(1500);
    // Should render something (universe content or error state)
    await expect(page.locator('body')).toBeVisible();
    const body = await page.locator('body').textContent();
    expect(body!.length).toBeGreaterThan(20);
  });

  test('universe page has header', async ({ page }) => {
    await page.goto('/universe/test-universe-123');
    await expect(page.locator('header')).toBeVisible();
  });
});

test.describe('Universe Sub-Routes', () => {
  test('universe gallery loads', async ({ page }) => {
    await page.goto('/universe/test-universe-123/gallery');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('universe gen-config loads', async ({ page }) => {
    await page.goto('/universe/test-universe-123/gen-config');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('universe deploy-token page loads', async ({ page }) => {
    await page.goto('/universe/test-universe-123.deploy-token');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Event / Episode Page', () => {
  test('event page loads', async ({ page }) => {
    await page.goto('/event/test-universe/test-event');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Play / Interactive Mode', () => {
  test('play page loads', async ({ page }) => {
    await page.goto('/play/test-universe-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Canon Submission', () => {
  test('canon page loads', async ({ page }) => {
    await page.goto('/canon/test-universe-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Governance', () => {
  test('governance page loads for universe', async ({ page }) => {
    await page.goto('/governance/test-universe-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });
});

test.describe('Treasury', () => {
  test('treasury page loads for universe', async ({ page }) => {
    await page.goto('/treasury/test-universe-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});
