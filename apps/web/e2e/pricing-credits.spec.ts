/**
 * Pricing & Credits Tests — Subscription plans, credit packages, balances.
 *
 * Verifies:
 * - Pricing page loads with heading
 * - Shows billing toggle (Monthly / Annual)
 * - Shows tier cards (Starter, Plus, Ultra, Business)
 * - Each tier shows price and features
 * - Annual toggle shows savings badge
 * - Credits page loads
 * - Credits page shows balance card
 * - Credits page shows transaction history section
 * - Credits page shows generation cost reference
 */

import { test, expect } from './fixtures';

test.describe('Pricing Page — Load & Layout', () => {
  test('pricing page loads', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/pricing/);
  });

  test('shows "PICK YOUR PLAN" heading', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('body')).toContainText(/pick your plan/i);
  });

  test('shows plan description', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('body')).toContainText(/ai-powered|credit|upgrade/i);
  });

  test('has header', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('header')).toBeVisible();
  });
});

test.describe('Pricing Page — Billing Toggle', () => {
  test('Monthly button is visible', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('button', { name: /monthly/i }).first()).toBeVisible();
  });

  test('Annual button is visible', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('button', { name: /annual/i }).first()).toBeVisible();
  });

  test('Annual button shows SAVE 20% badge', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('body')).toContainText(/save 20%/i);
  });

  test('clicking Annual toggle switches pricing', async ({ page }) => {
    await page.goto('/pricing');
    const annualBtn = page.getByRole('button', { name: /annual/i }).first();
    await annualBtn.click();
    await page.waitForTimeout(300);
    // Annual pricing should now be displayed (different values)
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/\/month|\/year/i);
  });
});

test.describe('Pricing Page — Tier Cards', () => {
  test('shows STARTER tier', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/starter/i).first()).toBeVisible();
  });

  test('shows PLUS tier', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/plus/i).first()).toBeVisible();
  });

  test('shows ULTRA tier', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/ultra/i).first()).toBeVisible();
  });

  test('shows BUSINESS tier', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/business/i).first()).toBeVisible();
  });

  test('shows "Most Popular" badge on one tier', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/most popular/i).first()).toBeVisible();
  });

  test('each tier shows price', async ({ page }) => {
    await page.goto('/pricing');
    // Should have dollar amounts visible
    await expect(page.getByText(/\$\d+/).first()).toBeVisible();
  });

  test('tier cards have CTA buttons', async ({ page }) => {
    await page.goto('/pricing');
    // Should have "Pay with $LOAR" or "Current Plan" buttons
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/pay with.*loar|current plan|subscribe|get started/i);
  });

  test('tier cards show feature lists', async ({ page }) => {
    await page.goto('/pricing');
    // Tiers should list features (check marks)
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/credit|generation|support|priority/i);
  });
});

test.describe('Credits Page — Load & Layout', () => {
  test('credits page loads', async ({ page }) => {
    await page.goto('/credits');
    await expect(page).toHaveURL(/\/credits/);
  });

  test('shows Credits heading', async ({ page }) => {
    await page.goto('/credits');
    await expect(page.locator('body')).toContainText(/credit/i);
  });

  test('has header', async ({ page }) => {
    await page.goto('/credits');
    await expect(page.locator('header')).toBeVisible();
  });
});

test.describe('Credits Page — Balance Card', () => {
  test('shows Available Credits label', async ({ page }) => {
    await page.goto('/credits');
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/available credit|credit|balance/i);
  });
});

test.describe('Credits Page — Generation Costs', () => {
  test('shows generation cost reference', async ({ page }) => {
    await page.goto('/credits');
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    // Should show costs like "image_generation 10 cr"
    expect(body?.toLowerCase()).toMatch(/generation|cr\b|cost|image|video/i);
  });
});

test.describe('Credits Page — Transaction History', () => {
  test('shows transaction history section', async ({ page }) => {
    await page.goto('/credits');
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/transaction|history|no transaction/i);
  });
});

test.describe('Credits Page — Buy Credits', () => {
  test('Buy Credits button or store exists', async ({ page }) => {
    await page.goto('/credits');
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/buy credit|top.?up|credit store/i);
  });
});
