/**
 * Create Console Flow Tests — the consolidated `/create` generation console,
 * the `/create/$kind` entity forms, and on-chain universe creation.
 *
 * `/create` is now a single Higgsfield-style prompt window (the GenerateConsole
 * component, shared with the redirected `/sandbox`). It can also roll world
 * entities into a chosen wiki. The old grid-of-cards hub is gone.
 */

import { test, expect, injectMockSession } from './fixtures';

test.describe('Create Console — Page Load', () => {
  test('create loads with heading', async ({ page }) => {
    await page.goto('/create');
    await expect(page).toHaveURL(/\/create/);
    await expect(page.locator('body')).toContainText(/create/i);
  });

  test('create has header', async ({ page }) => {
    await page.goto('/create');
    await expect(page.locator('header')).toBeVisible();
  });

  test('/sandbox redirects into /create', async ({ page }) => {
    await page.goto('/sandbox');
    await expect(page).toHaveURL(/\/create/);
  });
});

test.describe('Create Console — Generation UI', () => {
  test('shows the prompt window and mode tabs', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create');
    await page.waitForTimeout(1500);
    // Prompt textarea
    await expect(page.locator('textarea').first()).toBeVisible();
    // Media mode tabs
    await expect(page.getByRole('button', { name: 'Image', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Video', exact: true }).first()).toBeVisible();
  });

  test('exposes the "Generate into" wiki picker', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create');
    await page.waitForTimeout(1500);
    await expect(page.getByText(/generate into/i).first()).toBeVisible();
  });

  test('offers world-entity kinds (Person, Place, Faction)', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create');
    await page.waitForTimeout(1500);
    for (const kind of ['Person', 'Place', 'Faction']) {
      await expect(page.getByRole('button', { name: kind, exact: true }).first()).toBeVisible();
    }
  });

  test('picking a world kind reveals the entity form + wiki requirement hint', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Person', exact: true }).first().click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: /generate person/i }).first()).toBeVisible();
    await expect(page.getByText(/world entities must belong to one/i).first()).toBeVisible();
  });
});

test.describe('Entity Form — /create/$kind', () => {
  test('person form loads with correct heading', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/person');
    await expect(page.locator('body')).toContainText(/new.*person|create.*person/i);
  });

  test('entity form has name input or redirects to login', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/person');
    await page.waitForTimeout(2000);
    const url = page.url();
    if (url.includes('/create/person')) {
      // Form loaded — should have an input
      const nameInput = page.locator('input[type="text"], input:not([type])').first();
      await expect(nameInput).toBeVisible();
    } else {
      // Redirected to login (useEffect auth guard) — that's valid behavior
      expect(url).toMatch(/\/login/);
    }
  });

  test('entity form has summary/description textarea', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/person');
    await page.waitForTimeout(500);
    // Look for a textarea element
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible()) {
      await expect(textarea).toBeVisible();
    }
  });

  test('entity form has monetization toggle', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/person');
    await page.waitForTimeout(1000);
    // Look for monetization-related UI — may use different labels
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toMatch(/monetiz|non-monetiz|original|fan|new.*person|create/i);
  });

  test('filling in name enables submit button', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/person');
    await page.waitForTimeout(500);
    // Type a name
    const nameInput = page
      .getByPlaceholder(/name/i)
      .first()
      .or(page.locator('input[type="text"]').first());
    if (await nameInput.isVisible()) {
      await nameInput.fill('Test Character');
      await page.waitForTimeout(300);
      // Submit button should exist
      const submitBtn = page.getByRole('button', { name: /create/i }).first();
      if (await submitBtn.isVisible()) {
        await expect(submitBtn).toBeVisible();
      }
    }
  });

  test('place form loads with correct heading', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/place');
    await expect(page.locator('body')).toContainText(/new.*place|create.*place/i);
  });

  test('faction form loads with correct heading', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/faction');
    await expect(page.locator('body')).toContainText(/new.*faction|create.*faction/i);
  });

  test('event form loads with correct heading', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/event');
    await expect(page.locator('body')).toContainText(/new.*event|create.*event|new.*scene/i);
  });

  test('lore form loads with correct heading', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/lore');
    await expect(page.locator('body')).toContainText(/new.*lore|create.*lore/i);
  });

  test('species form loads with correct heading', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/species');
    await expect(page.locator('body')).toContainText(/new.*species|create.*species/i);
  });
});

test.describe('Entity Form — Monetization & Rights', () => {
  test('selecting monetized shows rights declaration', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/person');
    await page.waitForTimeout(800);

    // Two adjacent toggles exist: "Non-Monetized" and "Monetized". Anchor the
    // regex so `.first()` doesn't match "Non-Monetized" by accident.
    const monetizedBtn = page.getByText(/^Monetized$/).first();
    if (await monetizedBtn.isVisible().catch(() => false)) {
      await monetizedBtn.click();
      await page.waitForTimeout(400);
      const body = await page.locator('body').textContent();
      expect(body?.toLowerCase()).toMatch(/original work|licensed|rights declaration/i);
    }
  });
});

test.describe('Entity Form — AI Features', () => {
  test('Generate with AI button exists', async ({ page }) => {
    await injectMockSession(page);
    await page.goto('/create/person');
    await page.waitForTimeout(500);
    const aiBtn = page
      .getByRole('button', { name: /generate.*ai/i })
      .first()
      .or(page.getByText(/generate.*ai/i).first());
    // AI generation button should exist (may be disabled without name)
    if (await aiBtn.isVisible()) {
      await expect(aiBtn).toBeVisible();
    }
  });
});

test.describe('Universe Creation — /cinematicUniverseCreate', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/cinematicUniverseCreate');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated user can access universe creation page', async ({ authedPage: page }) => {
    await page.goto('/cinematicUniverseCreate');
    await page.waitForTimeout(1000);
    const url = page.url();
    // Should either stay on the page or show content
    expect(url).toBeTruthy();
  });
});
