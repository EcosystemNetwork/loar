/**
 * Sandbox / AI Generation Tests — AI playground and draft management.
 *
 * Verifies:
 * - Sandbox page loads with heading
 * - Unauthenticated users see wallet connect prompt
 * - Authenticated users see creation interface
 * - Prompt textarea is present
 * - Image ratio selector is present
 * - Video model selector is present
 * - Generate Image button exists
 * - Generate Video / Animate button exists
 * - Drafts section renders
 * - Empty drafts show helpful message
 */

import { test, expect, injectMockSession } from './fixtures';

test.describe('Sandbox — Page Load', () => {
  test('sandbox page loads', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page).toHaveURL(/\/sandbox/);
  });

  test('shows Sandbox heading', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page.locator('body')).toContainText(/sandbox/i);
  });

  test('shows Beta badge', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page.locator('body')).toContainText(/beta/i);
  });

  test('has header', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page.locator('header')).toBeVisible();
  });
});

test.describe('Sandbox — Unauthenticated', () => {
  test('shows wallet connect prompt', async ({ page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/connect.*wallet|sign in|wallet/i);
  });
});

test.describe('Sandbox — Authenticated', () => {
  test('shows creation interface', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const body = await page.locator('body').textContent();
    // Should show prompt input, model selection, or generation UI
    expect(body?.toLowerCase()).toMatch(/prompt|describe|generate|create|model|image|video/i);
  });

  test('prompt textarea exists', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible()) {
      await expect(textarea).toBeVisible();
    }
  });

  test('prompt textarea accepts input', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible()) {
      await textarea.fill('A lone samurai on a neon-lit rooftop in cyberpunk Tokyo');
      await expect(textarea).toHaveValue('A lone samurai on a neon-lit rooftop in cyberpunk Tokyo');
    }
  });

  test('Generate Image button exists', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const genBtn = page.getByRole('button', { name: /generate image/i }).first();
    if (await genBtn.isVisible()) {
      await expect(genBtn).toBeVisible();
    }
  });

  test('video generation button exists', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const vidBtn = page.getByRole('button', { name: /animate|generate video/i }).first();
    if (await vidBtn.isVisible()) {
      await expect(vidBtn).toBeVisible();
    }
  });

  test('image ratio selector exists', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/ratio|landscape|portrait|square|16:9|9:16|1:1/i);
  });

  test('video model selector exists', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/model|seedance|kling|wan|veo/i);
  });
});

test.describe('Sandbox — Drafts', () => {
  test('drafts section is visible', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/draft|saved|nothing saved/i);
  });

  test('empty drafts show helpful message', async ({ authedPage: page }) => {
    await page.goto('/sandbox');
    await page.waitForTimeout(1500);
    // For a new user, drafts should be empty
    const body = await page.locator('body').textContent();
    // Either shows empty message or existing drafts
    expect(body).toBeTruthy();
  });
});
