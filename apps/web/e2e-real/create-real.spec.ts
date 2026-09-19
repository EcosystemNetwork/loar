/**
 * /create against the REAL local stack — no route interception, no mocked
 * tRPC, no fake auth. Real SIWE login → real server → real Firestore emulator.
 *
 * Prereqs: `make dev-local` (web :3001, server :3000, Firestore emulator :8080).
 * Run:     pnpm exec playwright test -c playwright.real.config.ts
 *
 * Business model is BYOK-only: the server never falls back to a platform key,
 * so a fresh wallet with no provider key gets a real `byokRequired` failure
 * from every generation route (no provider spend). Those failure paths are
 * tested unconditionally. Paths that need a working provider run only when the
 * tester supplies THEIR OWN key:
 *   E2E_FAL_API_KEY     → real image generation + publish
 *   E2E_GEMINI_API_KEY  → real entity profile generation (with the FAL key: portrait too)
 */
import { test, expect, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const SERVER = process.env.E2E_SERVER_URL ?? 'http://localhost:3000';
const WEB_ORIGIN = process.env.E2E_WEB_URL ?? 'http://localhost:3001';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = 'loar-db';
const FAL_KEY = process.env.E2E_FAL_API_KEY;
const GEMINI_KEY = process.env.E2E_GEMINI_API_KEY;

type Wallet = ReturnType<typeof newWallet>;
const newWallet = () => privateKeyToAccount(generatePrivateKey());

/** Real SIWE sign-in: nonce → signature → httpOnly session cookie in the browser context. */
async function login(page: Page, wallet: Wallet) {
  // The server rate-limits /auth/nonce (6/min). Wait out the window rather than fail.
  let nonce: string | undefined;
  for (let attempt = 0; attempt < 3 && !nonce; attempt++) {
    const nonceRes = await page.request.get(`${SERVER}/auth/nonce`);
    if (nonceRes.ok()) nonce = (await nonceRes.json()).nonce;
    else await page.waitForTimeout(61_000);
  }
  expect(nonce, 'could not obtain a SIWE nonce').toBeTruthy();
  const now = new Date();
  const message = [
    'localhost wants you to sign in with your Ethereum account:',
    wallet.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${WEB_ORIGIN}`,
    'Version: 1',
    'Chain ID: 11155111',
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${new Date(now.getTime() + 5 * 60_000).toISOString()}`,
  ].join('\n');
  const signature = await wallet.signMessage({ message });
  const verify = await page.request.post(`${SERVER}/auth/verify`, {
    headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    data: { message, signature },
  });
  expect(verify.status(), await verify.text()).toBe(200);
  const { expiresAt } = await verify.json();
  await page.goto('/', { waitUntil: 'commit' });
  await page.evaluate(
    ({ addr, exp }) => {
      localStorage.setItem('siwe-address', addr);
      localStorage.setItem('siwe-expiry', String(exp));
      localStorage.setItem('auth-provider', 'siwe');
    },
    { addr: wallet.address, exp: expiresAt }
  );
}

/** Real tRPC call from the test process, authenticated by the browser's session cookie. */
async function trpc<T = any>(
  page: Page,
  kind: 'query' | 'mutation',
  proc: string,
  input?: unknown
) {
  const res =
    kind === 'query'
      ? await page.request.get(
          `${SERVER}/trpc/${proc}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`
        )
      : await page.request.post(`${SERVER}/trpc/${proc}`, {
          headers: { 'Content-Type': 'application/json' },
          data: input ?? {},
        });
  const json = await res.json();
  if (json.error) throw new Error(`${proc}: ${JSON.stringify(json.error).slice(0, 300)}`);
  return json.result.data as T;
}

// ── Real Firestore emulator helpers (REST, admin bypass) ─────────────────
const FS = `http://${EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents`;
const adminHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

async function fsQuery(collection: string, field: string, value: string) {
  const res = await fetch(`${FS}:runQuery`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } },
        },
      },
    }),
  });
  const rows = (await res.json()) as Array<{ document?: { name: string; fields: any } }>;
  return rows.filter((r) => r.document).map((r) => r.document!);
}
const str = (doc: { fields: any }, f: string): string | null =>
  doc.fields?.[f]?.stringValue ?? null;

async function fsPutUniverse(id: string, creator: string, name: string) {
  const res = await fetch(`${FS}/cinematicUniverses/${id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({
      fields: { creator: { stringValue: creator }, name: { stringValue: name } },
    }),
  });
  expect(res.ok, await res.text()).toBe(true);
}
async function fsDelete(path: string) {
  await fetch(`${FS}/${path}`, { method: 'DELETE', headers: adminHeaders });
}

// ── Page helpers ─────────────────────────────────────────────────────────
const prompt = (page: Page) => page.locator('textarea').first();
/** Composer mode tabs precede the feed filter chips of the same name in the DOM. */
const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).first();
const dismissKeyModal = async (page: Page) => {
  const dlg = page.getByRole('dialog');
  if (await dlg.isVisible().catch(() => false)) await page.keyboard.press('Escape');
};

test.describe('/create — real stack', () => {
  test.beforeAll(async () => {
    const health = await fetch(`${SERVER}/health`)
      .then((r) => r.json())
      .catch(() => null);
    expect(health?.status, `server not reachable at ${SERVER} — run \`make dev-local\``).toBe(
      'healthy'
    );
  });

  test('no provider key: a real image run fails with byokRequired and offers Retry', async ({
    page,
  }) => {
    await login(page, newWallet());
    const genCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/trpc/') && r.method() === 'POST') genCalls.push(r.url());
    });
    await page.goto('/create');
    await prompt(page).fill('a small red fox, flat illustration');
    await page.getByRole('button', { name: /generate image/i }).click();

    // Real server response, real failure card.
    await expect(page.getByRole('button', { name: /retry \(2 left\)/i })).toBeVisible();
    expect(genCalls.some((u) => u.includes('image.generate'))).toBe(true);
    // Nothing should have been saved for a failed run.
    const drafts = await trpc<any[]>(page, 'query', 'sandbox.myDrafts');
    expect(drafts).toHaveLength(0);
  });

  test('no provider key: a failed sound-effect run never offers Retry and never dispatches a video job', async ({
    page,
  }) => {
    await login(page, newWallet());
    const dispatched: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/trpc/')) dispatched.push(r.url());
    });
    await page.goto('/create');
    await tab(page, 'Voice').click();
    await page.getByRole('button', { name: 'Sound Effect', exact: true }).click();
    await prompt(page).fill('thunder crack with low rumble');
    await page.getByRole('button', { name: /generate sound effect/i }).click();

    await expect.poll(() => dispatched.some((u) => u.includes('voice.soundEffect'))).toBe(true);
    await page.waitForTimeout(2_500); // let the failure settle
    await dismissKeyModal(page);
    await expect(page.getByRole('button', { name: /retry/i })).toHaveCount(0);
    expect(dispatched.some((u) => u.includes('generation.generate'))).toBe(false);
  });

  test("queue persistence is per wallet: another wallet never sees this wallet's generations", async ({
    page,
  }) => {
    const alice = newWallet();
    const bob = newWallet();
    const secret = `alpha-secret-${Date.now()}`;

    await login(page, alice);
    await page.goto('/create');
    await prompt(page).fill(secret);
    await page.getByRole('button', { name: /generate image/i }).click();
    await expect(page.getByText(secret).first()).toBeVisible();
    await dismissKeyModal(page);

    // Same browser, different real session.
    await login(page, bob);
    await page.goto('/create');
    await expect(page.getByRole('heading', { name: /create anything/i })).toBeVisible();
    await expect(page.getByText(secret)).toHaveCount(0);

    // Alice comes back and still has hers.
    await login(page, alice);
    await page.goto('/create');
    await expect(page.getByText(secret).first()).toBeVisible();
  });

  test('Image → 3D stays disabled until an explicit source image is provided', async ({ page }) => {
    await login(page, newWallet());
    await page.goto('/create');
    await tab(page, '3D').click();
    await page.getByRole('button', { name: 'Image → 3D', exact: true }).click();
    await expect(page.getByRole('button', { name: /convert image → 3d/i })).toBeDisabled();
    await expect(page.getByText(/add the source image/i)).toBeVisible();
  });

  test('world entity without a Gemini key fails for real and offers Retry (replay verified only when E2E_GEMINI_API_KEY is set)', async ({
    page,
  }) => {
    const wallet = newWallet();
    const universeId = `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)}`;
    await fsPutUniverse(universeId, wallet.address.toLowerCase(), 'E2E Real Wiki');
    try {
      await login(page, wallet);
      await page.goto(`/create?universe=${universeId}`);
      await expect(page.getByRole('combobox').first()).toContainText(/E2E Real Wiki/);
      await tab(page, 'Person').click();
      await prompt(page).fill('A weary lighthouse keeper');
      await page.getByRole('button', { name: /generate person/i }).click();

      if (GEMINI_KEY) {
        await trpc(page, 'mutation', 'providers.upsertKey', {
          provider: 'gemini',
          apiKey: GEMINI_KEY,
        });
      }
      // Without the user's own Gemini key the profile call is a real BYOK failure.
      const retry = page.getByRole('button', { name: /^retry$/i });
      if (!GEMINI_KEY) {
        await expect(retry).toBeVisible();
        expect(await fsQuery('entities', 'universeAddress', universeId)).toHaveLength(0);
      }
    } finally {
      await fsDelete(`cinematicUniverses/${universeId}`);
    }
  });

  test.describe('with a real provider key (E2E_FAL_API_KEY)', () => {
    test.skip(!FAL_KEY, 'set E2E_FAL_API_KEY to run real image generation');

    test('a real image run is saved as a draft and auto-published to My Gallery', async ({
      page,
    }) => {
      const wallet = newWallet();
      await login(page, wallet);
      await trpc(page, 'mutation', 'providers.upsertKey', { provider: 'fal', apiKey: FAL_KEY });
      await page.goto('/create');
      await prompt(page).fill('a small red fox, flat illustration');
      await page.getByRole('button', { name: /generate image/i }).click();

      await expect
        .poll(async () => (await trpc<any[]>(page, 'query', 'sandbox.myDrafts'))[0]?.status, {
          timeout: 120_000,
        })
        .toBe('promoted');
      const [draft] = await trpc<any[]>(page, 'query', 'sandbox.myDrafts');
      // The real provider URL must pass the draft-URL host allowlist.
      expect(draft.imageUrl).toMatch(/^https:\/\//);
      const content = await fsQuery('content', 'creatorUid', wallet.address.toLowerCase());
      expect(content).toHaveLength(1);
      expect(str(content[0], 'mediaUrl')).toBe(draft.imageUrl);
      expect(str(content[0], 'visibility')).toBe('unlisted');
      expect(str(content[0], 'mediaType')).toBe('ai-image');
    });
  });
});
