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

// A non-IPFS cover image — mirrors real data: a universe whose fal.ai cover
// generation failed at creation time and fell back to a plain https
// placeholder URL (scripts/create-dostopian-universe.ts) instead of an
// ipfs:// one. "Dostopia: The Iron Faith" is a real example of this in
// production (see the incident this test guards against).
const NON_IPFS_IMAGE_URL = 'https://images.example.com/placeholder-cover.jpg';
const NON_IPFS_FIXTURE_UNIVERSE = {
  ...FIXTURE_UNIVERSE,
  id: 'e2e-fixture-universe-non-ipfs',
  address: '0x00000000000000000000000000000000000e3e',
  name: 'E2E Non-IPFS Cover Fixture',
  image_url: NON_IPFS_IMAGE_URL,
};

async function pinNonIpfsFixtureUniverse(page: Page) {
  await page.route('**/trpc/universes.getAll**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { result: { data: { success: true, data: [NON_IPFS_FIXTURE_UNIVERSE] } } },
      ]),
    })
  );
  await page.route('**/graphql', (route: Route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ errors: [{ message: 'e2e: ponder intentionally offline' }] }),
    })
  );
  // The real https host resolves fine on its own — SmartImage should just
  // render it directly, never through the resize proxy.
  await page.route(`**/${new URL(NON_IPFS_IMAGE_URL).host}/**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  );
  // Mirror the server's real SSRF guard (apps/server's /api/img host
  // allowlist): any non-IPFS-gateway host gets a 400. If SmartImage's
  // srcset ever asks the proxy for this host again, the <img> fails with no
  // fallback candidate — exactly the "Couldn't load image" bug being
  // guarded against here.
  await page.route('**/api/img**', (route: Route) => {
    const upstream = new URL(route.request().url()).searchParams.get('url') || '';
    if (upstream.includes(new URL(NON_IPFS_IMAGE_URL).host)) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'host not allowed' }),
      });
    }
    return route.continue();
  });
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

  test('a universe card with a non-IPFS cover image renders directly, not through the resize proxy', async ({
    page,
  }) => {
    // Regression guard for the "Dostopia: The Iron Faith" incident: its cover
    // is a plain https placeholder (fal.ai generation failed at seed time, see
    // scripts/create-dostopian-universe.ts), not an ipfs:// URL. SmartImage's
    // buildResizeSrcSet() used to route *every* src through the server's
    // `/api/img` resize proxy unconditionally; the proxy's SSRF host
    // allowlist 400s ("host not allowed") on anything that isn't a known IPFS
    // gateway, which fails the <img> with no fallback candidate and renders
    // the terminal "Couldn't load image" state — for an image that was live
    // and reachable the whole time.
    await pinNonIpfsFixtureUniverse(page);
    await page.goto('/');

    const card = page.getByText('E2E Non-IPFS Cover Fixture').first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    const cardImg = page
      .locator('div', { has: page.getByText('E2E Non-IPFS Cover Fixture', { exact: true }) })
      .locator('img')
      .first();
    await expect(cardImg).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => cardImg.evaluate((img: HTMLImageElement) => img.naturalWidth), {
        timeout: 10_000,
        message:
          'non-IPFS cover image never painted — likely routed through the resize proxy and 400ed on its SSRF guard',
      })
      .toBeGreaterThan(0);

    // The negative assertion that actually pins the bug: the "Couldn't load
    // image" terminal state must never appear for this card.
    await expect(page.getByText('Couldn’t load image')).toHaveCount(0);
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
 *
 * Second incident, same day: "Dostopia: The Iron Faith" was reported showing
 * no thumbnail in production even with the SmartImage fix live. Root cause
 * was different from the above — SmartImage.tsx's buildResizeSrcSet() routed
 * *every* image through the server's /api/img resize proxy unconditionally,
 * with no host guard (unlike utils/img-proxy.ts's proxyable(), which only
 * proxies recognized IPFS gateway URLs). The proxy's SSRF allowlist 400s
 * ("host not allowed") on a non-IPFS host, which fails the <img> via its
 * srcset with no fallback candidate. Confirmed live against production:
 * `GET /api/img?url=<Unsplash cover>&w=320 → 400 {"error":"host not
 * allowed"}`. Reproduced with the 'a universe card with a non-IPFS cover
 * image...' test above (`git stash` the SmartImage.tsx guard fix — 5
 * "Couldn't load image" cards). Fixed by gating buildResizeSrcSet() on
 * isIpfsGatewayUrl(src), same as img-proxy.ts.
 */
