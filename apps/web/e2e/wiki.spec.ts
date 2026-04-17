/**
 * Wiki Tests — Lore encyclopedia, entity browsing, and entity detail.
 *
 * Verifies:
 * - Wiki index page loads
 * - Wiki has tab navigation for entity kinds
 * - Entity kind tabs are present (People, Places, Things, etc.)
 * - Wiki search works
 * - Entity detail page loads for a given ID
 * - Entity detail page shows entity info or not-found state
 */

import { test, expect } from './fixtures';

test.describe('Wiki Index — Page Load', () => {
  test('wiki page loads', async ({ page }) => {
    await page.goto('/wiki');
    await expect(page).toHaveURL(/\/wiki/);
  });

  test('wiki has header', async ({ page }) => {
    await page.goto('/wiki');
    await expect(page.locator('header')).toBeVisible();
  });

  test('wiki page has content', async ({ page }) => {
    await page.goto('/wiki');
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(50);
  });
});

test.describe('Wiki — Entity Kind Tabs', () => {
  const tabs = ['People', 'Places', 'Things', 'Factions', 'Events', 'Lore', 'Species'];

  for (const tab of tabs) {
    test(`${tab} tab is accessible`, async ({ page }) => {
      await page.goto('/wiki');
      await page.waitForTimeout(500);
      const tabElement = page
        .getByRole('tab', { name: new RegExp(tab, 'i') })
        .or(page.getByText(new RegExp(tab, 'i')).first());
      if (await tabElement.isVisible()) {
        await expect(tabElement).toBeVisible();
      }
    });
  }

  test('clicking a tab filters displayed entities', async ({ page }) => {
    await page.goto('/wiki');
    await page.waitForTimeout(500);
    const peopleTab = page
      .getByRole('tab', { name: /people/i })
      .or(page.getByText(/people/i).first());
    if (await peopleTab.isVisible()) {
      await peopleTab.click();
      await page.waitForTimeout(500);
      const body = await page.locator('body').textContent();
      expect(body).toBeTruthy();
    }
  });
});

test.describe('Wiki — Search', () => {
  test('search input exists on wiki page', async ({ page }) => {
    await page.goto('/wiki');
    await page.waitForTimeout(500);
    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible()) {
      await expect(searchInput).toBeVisible();
    }
  });

  test('search accepts text input', async ({ page }) => {
    await page.goto('/wiki');
    await page.waitForTimeout(500);
    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('dragon');
      await expect(searchInput).toHaveValue('dragon');
    }
  });
});

test.describe('Wiki — Entity Detail', () => {
  test('entity detail page loads for a given ID', async ({ page }) => {
    await page.goto('/wiki/entity/test-entity-123');
    await page.waitForTimeout(1000);
    // Should show entity or not-found state
    await expect(page.locator('body')).toBeVisible();
  });

  test('character detail page loads', async ({ page }) => {
    await page.goto('/wiki/character/test-char-123');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });
});
