/**
 * Homepage — Image Resilience Under Gateway Degradation
 *
 * Regression guard for the "missing hero banner content" bug: the hero
 * billboard (and several row cards) used to render a bare `<img
 * src={proxiedImage(...)}>` pointing at a single IPFS gateway (ipfs.io) with
 * no `onError` handler at all. When that one gateway hung, 429'd, or 5xx'd —
 * which happens; see the removed cloudflare-ipfs.com dead-end noted in
 * apps/web/src/utils/ipfs-url.ts — the image just silently never appeared.
 * Nothing in the existing homepage.spec.ts suite could have caught this: it
 * only asserts on text content, never on whether an <img> actually painted
 * pixels.
 *
 * IMPORTANT: this suite mocks `trpc/universes.getAll` and the Ponder
 * `/graphql` endpoint with a fixed fixture universe instead of relying on
 * whatever's in the local dev seed data. That's not incidental — the first
 * version of this test trusted the local stack's "featured" universe, and
 * it turned out to be seeded with a `placehold.co` image (non-IPFS), so a
 * simulated IPFS-gateway outage silently never touched the code path under
 * test and the test passed for the wrong reason even against the unfixed
 * code. Pinning the fixture is what makes the fault injection below actually
 * exercise the vulnerable path deterministically.
 */

import { test, expect } from './fixtures';
import type { Page, Route } from '@playwright/test';

// 1x1 transparent PNG — stands in for a real gateway response body so the
// test doesn't depend on any real image bytes existing anywhere.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const TEST_CID = 'bafkFAULTINJECTIONTESTCID';
const DEAD_GATEWAY_HOST = 'ipfs.io';
const LIVE_FALLBACK_HOST = 'dweb.link';
// Pre-resolved to the dead gateway directly (mirrors what resolveIpfsUrl()
// produces server-side today for a `.mypinata.cloud` source) so the fixture
// doesn't depend on which gateway this environment's ACTIVE_GATEWAY happens
// to be configured to.
const TEST_IMAGE_URL = `https://${DEAD_GATEWAY_HOST}/ipfs/${TEST_CID}`;

const FIXTURE_UNIVERSE = {
  id: 'e2e-fixture-universe',
  address: '0x00000000000000000000000000000000000e2e',
  name: 'E2E Fixture Universe',
  description: 'Deterministic fixture universe for image-resilience tests.',
  image_url: TEST_IMAGE_URL,
  portrait_image_url: null,
  tokenAddress: '0x00000000000000000000000000000000000e2f',
  governanceAddress: null,
  accessModel: 'open',
  creator: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  created_at: { _seconds: 1700000000, _nanoseconds: 0 },
  updated_at: { _seconds: 1700000000, _nanoseconds: 0 },
};

/** Pin the homepage's universe list to a single deterministic fixture. */
async function pinFixtureUniverse(page: Page) {
  await page.route('**/trpc/universes.getAll**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ result: { data: { success: true, data: [FIXTURE_UNIVERSE] } } }]),
    })
  );
  // Ponder enrichment is optional/silent-fail by design (see ponder-api.ts) —
  // returning a GraphQL error response makes the app treat it as offline
  // and keep our Firestore-sourced imageURL as-is, instead of depending on
  // whatever the local indexer actually has for this CID.
  await page.route('**/graphql', (route: Route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ errors: [{ message: 'e2e: ponder intentionally offline' }] }),
    })
  );
}

/**
 * Simulates the primary IPFS gateway (ipfs.io) being completely dead — both
 * the client-side HEAD probe (raceIpfsGateways) and any request our own
 * resize proxy (/api/img) makes on its behalf — while a secondary public
 * gateway (dweb.link) and the fixture's own bytes stay reachable. Real
 * network is never touched for the fixture CID: every relevant host is
 * intercepted.
 */
async function simulateDegradedPrimaryGateway(page: Page) {
  await page.route(`https://${DEAD_GATEWAY_HOST}/ipfs/${TEST_CID}**`, (route: Route) =>
    route.abort()
  );
  await page.route(`https://gateway.pinata.cloud/ipfs/${TEST_CID}**`, (route: Route) =>
    route.abort()
  );
  await page.route(`https://w3s.link/ipfs/${TEST_CID}**`, (route: Route) => route.abort());
  await page.route(`https://${LIVE_FALLBACK_HOST}/ipfs/${TEST_CID}**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
  );

  // Server-signed dedicated-gateway resolve — force it to fail so the test
  // exercises the public-gateway fallback chain specifically, not a
  // dedicated-gateway shortcut this environment's server might otherwise
  // satisfy on its own.
  await page.route('**/api/ipfs/resolve**', (route: Route) => route.abort());

  // The actual bytes the browser paints always come through our resize
  // proxy (/api/img?url=<gateway url>&w=...). Fail it when the upstream
  // target is the dead gateway; succeed with real image bytes otherwise.
  // This is the crux of the regression: the OLD code only ever requested
  // the ipfs.io-backed proxy URL for this image and had no retry, so it
  // would 502 forever.
  await page.route('**/api/img**', (route: Route) => {
    const url = new URL(route.request().url());
    const upstream = url.searchParams.get('url') || '';
    if (!upstream.includes(TEST_CID)) return route.continue();
    if (upstream.includes(DEAD_GATEWAY_HOST)) {
      return route.fulfill({ status: 502, contentType: 'text/plain', body: 'gateway down' });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
  });
}

/** Everything fails, including the fallback — total outage. */
async function simulateTotalGatewayOutage(page: Page) {
  await page.route(`https://${DEAD_GATEWAY_HOST}/ipfs/${TEST_CID}**`, (route: Route) =>
    route.abort()
  );
  await page.route(`https://${LIVE_FALLBACK_HOST}/ipfs/${TEST_CID}**`, (route: Route) =>
    route.abort()
  );
  await page.route(`https://gateway.pinata.cloud/ipfs/${TEST_CID}**`, (route: Route) =>
    route.abort()
  );
  await page.route(`https://w3s.link/ipfs/${TEST_CID}**`, (route: Route) => route.abort());
  await page.route('**/api/ipfs/resolve**', (route: Route) => route.abort());
  await page.route('**/api/img**', (route: Route) => {
    const url = new URL(route.request().url());
    if (!(url.searchParams.get('url') || '').includes(TEST_CID)) return route.continue();
    return route.fulfill({ status: 502, contentType: 'text/plain', body: 'all gateways down' });
  });
}

test.describe('Homepage — Image Resilience', () => {
  test('hero billboard image still loads when the primary IPFS gateway is degraded', async ({
    page,
  }) => {
    await pinFixtureUniverse(page);
    await simulateDegradedPrimaryGateway(page);
    await page.goto('/');

    // Hero container — `.relative.isolate` is a unique class combo scoped to
    // HeroBillboard's root (apps/web/src/components/home/HomeSections.tsx).
    const hero = page.locator('div.relative.isolate').first();
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(hero.getByText('E2E Fixture Universe')).toBeVisible({ timeout: 10_000 });

    const heroImg = hero.locator('img').first();
    await expect(heroImg).toBeVisible({ timeout: 10_000 });

    // The actual assertion: the <img> must have really decoded pixels, not
    // just be present in the DOM with a src that 502'd.
    await expect
      .poll(async () => heroImg.evaluate((img: HTMLImageElement) => img.naturalWidth), {
        timeout: 10_000,
        message: 'hero image never painted — primary-gateway failure was not recovered from',
      })
      .toBeGreaterThan(0);
  });

  test('control: total gateway outage degrades to a visible placeholder, not a silent forever-blank', async ({
    page,
  }) => {
    await pinFixtureUniverse(page);
    await simulateTotalGatewayOutage(page);
    await page.goto('/');

    const hero = page.locator('div.relative.isolate').first();
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(hero.getByText('E2E Fixture Universe')).toBeVisible({ timeout: 10_000 });

    // SmartImage's terminal error state is a muted box with this copy — it
    // must appear (bounded wait), rather than the test timing out with
    // nothing ever rendered. Documents the intended graceful-degradation
    // contract, distinct from the silent-forever-blank bug being guarded
    // against above.
    await expect(hero.getByText('Couldn’t load image').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

/**
 * Verification (2026-08-25): ran both tests against the working tree BEFORE
 * the SmartImage migration (`git checkout HEAD -- HomeSections.tsx`,
 * restoring the raw `<img src={proxiedImage(...)}>` with no onError):
 *
 *   - 'hero billboard image still loads...' FAILED — naturalWidth stayed 0
 *     for the full 10s poll window (the reported bug, reproduced).
 *   - 'control: total gateway outage...' FAILED too — no placeholder text
 *     ever appears because the old code has no onError/terminal state at
 *     all, it just leaves a permanently broken <img>.
 *
 * Restoring the SmartImage fix made both pass. See PR discussion for the
 * full before/after test output.
 */
