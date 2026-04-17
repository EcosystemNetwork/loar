# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sandbox.spec.ts >> Sandbox — Authenticated >> video model selector exists
- Location: e2e/sandbox.spec.ts:109:3

# Error details

```
Error: expect(received).toMatch(expected)

Expected pattern: /model|seedance|kling|wan|veo/i
Received string:  "
    loar((e, i, s, u, m, a, l, h) => {
  let d = document.documentelement, w = [\"light\", \"dark\"];
  function p(n) {
    (array.isarray(e) ? e : [e]).foreach((y) => {
      let k = y === \"class\", s = k && a ? m.map((f) => a[f] || f) : m;
      k ? (d.classlist.remove(...s), d.classlist.add(a && a[n] ? a[n] : n)) : d.setattribute(y, n);
    }), r(n);
  }
  function r(n) {
    h && w.includes(n) && (d.style.colorscheme = n);
  }
  function c() {
    return window.matchmedia(\"(prefers-color-scheme: dark)\").matches ? \"dark\" : \"light\";
  }
  if (u) p(u);
  else try {
    let n = localstorage.getitem(i) || s, y = l && n === \"system\" ? c() : n;
    p(y);
  } catch (n) {
  }
})(\"class\",\"vite-ui-theme\",\"dark\",null,[\"light\",\"dark\"],null,true,true)discovercreategallerylaunchpadpricingdashboardmoreconnect wallettoggle themetestnet — this is a testnet deployment. funds and tokens have no real value.sandboxbetacreate freely. no universe required — generate images and videos, then decide what to do with them.connect your wallet to start generating. your creations are saved to your account.connect wallet© 2026 loarterms of serviceprivacy policydmcatanstacktanstack router v1router15 itemsstate9 itemsstatus: \"idle\"loadedat: 1776386236401isloading: falseistransitioning: falsematches2 itemslocation8 itemsresolvedlocation8 itemsstatuscode: 200redirect: routesbyid67 itemsroutesbypath66 itemsoptions9 itemsdefaultpreloaddelay: 50defaultpendingms: 1000defaultpendingminms: 500context1 itemroutetree12 itemsdefaultpreload: \"intent\"casesensitive: falsenotfoundmode: \"fuzzy\"protocolallowlist4 itemsshouldviewtransition: isviewtransitiontypessupported: trueisscrollrestoring: falseisscrollrestorationsetup: trueisserver: falseprotocolallowlist4 itemsorigin: \"http://localhost:3001\"resolvepathcache: {}processedtree5 itemsrewrite: commitlocationpromise: pathname/sandboxroutesmatcheshistoryage / staletime / gctime__root__ ➔/ ➔activity ➔checkout ➔cinematicuniversecreate ➔coming-soon ➔credits ➔dashboard ➔discover ➔dmca ➔docs ➔gallery ➔login ➔market ➔my-works ➔notifications ➔pricing ➔privacy ➔sandbox ➔staking ➔subscriptions ➔terms ➔upload ➔videos ➔admin/moderation ads/$slotid ➔ads/new agents/$uid ➔agents/dashboard ➔agents/register analytics/$universeid bounties/$bountyid ➔bounties/mine canon/$universeid ➔collabs/new create/$kind governance/$universeid ➔licensing/new order/$id play/$universeid product/$id profile/$username ➔profile/edit ➔sell/earnings ➔sell/new shop/$universeid tokens/$address ➔tokens/portfolio treasury/$universeid universe/$id deploy-token gallery gen-config wiki/$kind ➔ads/ ➔agents/ ➔bounties/ ➔collabs/ ➔create/ ➔licensing/ ➔sell/ ➔tokens/ ➔wiki/ event/$universe/$event tokens/creator/$address wiki/character/$id wiki/entity/$id -tanstack router·········
"
```

# Page snapshot

```yaml
- generic [ref=e2]:
    - generic [ref=e3]:
        - banner [ref=e4]:
            - generic [ref=e6]:
                - generic [ref=e7]:
                    - link "LOAR Logo" [ref=e8] [cursor=pointer]:
                        - /url: /
                        - img "LOAR Logo" [ref=e9]
                    - navigation [ref=e10]:
                        - link "Discover" [ref=e11] [cursor=pointer]:
                            - /url: /discover
                        - link "Create" [ref=e12] [cursor=pointer]:
                            - /url: /create
                        - link "Gallery" [ref=e13] [cursor=pointer]:
                            - /url: /gallery
                        - link "Launchpad" [ref=e14] [cursor=pointer]:
                            - /url: /tokens
                        - link "Pricing" [ref=e15] [cursor=pointer]:
                            - /url: /pricing
                        - link "Dashboard" [ref=e16] [cursor=pointer]:
                            - /url: /dashboard
                        - button "More" [ref=e17]:
                            - text: More
                            - img [ref=e18]
                - generic [ref=e20]:
                    - button "Notifications" [ref=e22]:
                        - img [ref=e23]
                    - button "Connect Wallet" [ref=e27] [cursor=pointer]
                    - button "Standard mode — click to show Web3 details" [ref=e28]:
                        - img
                    - button "Toggle theme" [ref=e29]:
                        - img
                        - img
                        - generic [ref=e30]: Toggle theme
        - generic [ref=e31]:
            - strong [ref=e32]: Testnet
            - text: — This is a testnet deployment. Funds and tokens have no real value.
        - main [ref=e33]:
            - generic [ref=e35]:
                - generic [ref=e36]:
                    - generic [ref=e37]:
                        - img [ref=e38]
                        - heading "Sandbox" [level=1] [ref=e40]
                        - generic [ref=e41]: Beta
                    - paragraph [ref=e42]: Create freely. No universe required — generate images and videos, then decide what to do with them.
                - generic [ref=e44]:
                    - img [ref=e45]
                    - paragraph [ref=e48]: Connect your wallet to start generating. Your creations are saved to your account.
                    - button "Connect Wallet" [ref=e50] [cursor=pointer]
        - contentinfo [ref=e51]:
            - generic [ref=e52]:
                - generic [ref=e53]: © 2026 LOAR
                - link "Terms of Service" [ref=e54] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e55] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e56] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e57] [cursor=pointer]:
                - generic [ref=e58]:
                    - img [ref=e60]
                    - img [ref=e95]
                - generic [ref=e129]: '-'
                - generic [ref=e130]: TanStack Router
    - generic [ref=e131]:
        - img [ref=e133]
        - button "Open Tanstack query devtools" [ref=e181] [cursor=pointer]:
            - img [ref=e182]
```

# Test source

```ts
  13  |  * - Drafts section renders
  14  |  * - Empty drafts show helpful message
  15  |  */
  16  |
  17  | import { test, expect, injectMockSession } from './fixtures';
  18  |
  19  | test.describe('Sandbox — Page Load', () => {
  20  |   test('sandbox page loads', async ({ page }) => {
  21  |     await page.goto('/sandbox');
  22  |     await expect(page).toHaveURL(/\/sandbox/);
  23  |   });
  24  |
  25  |   test('shows Sandbox heading', async ({ page }) => {
  26  |     await page.goto('/sandbox');
  27  |     await expect(page.locator('body')).toContainText(/sandbox/i);
  28  |   });
  29  |
  30  |   test('shows Beta badge', async ({ page }) => {
  31  |     await page.goto('/sandbox');
  32  |     await expect(page.locator('body')).toContainText(/beta/i);
  33  |   });
  34  |
  35  |   test('has header', async ({ page }) => {
  36  |     await page.goto('/sandbox');
  37  |     await expect(page.locator('header')).toBeVisible();
  38  |   });
  39  | });
  40  |
  41  | test.describe('Sandbox — Unauthenticated', () => {
  42  |   test('shows wallet connect prompt', async ({ page }) => {
  43  |     await page.goto('/sandbox');
  44  |     await page.waitForTimeout(1000);
  45  |     const body = await page.locator('body').textContent();
  46  |     expect(body?.toLowerCase()).toMatch(/connect.*wallet|sign in|wallet/i);
  47  |   });
  48  | });
  49  |
  50  | test.describe('Sandbox — Authenticated', () => {
  51  |   test('shows creation interface', async ({ authedPage: page }) => {
  52  |     await page.goto('/sandbox');
  53  |     await page.waitForTimeout(1500);
  54  |     const body = await page.locator('body').textContent();
  55  |     // Should show prompt input, model selection, or generation UI
  56  |     expect(body?.toLowerCase()).toMatch(/prompt|describe|generate|create|model|image|video/i);
  57  |   });
  58  |
  59  |   test('prompt textarea exists', async ({ authedPage: page }) => {
  60  |     await page.goto('/sandbox');
  61  |     await page.waitForTimeout(1500);
  62  |     const textarea = page.locator('textarea').first();
  63  |     if (await textarea.isVisible()) {
  64  |       await expect(textarea).toBeVisible();
  65  |     }
  66  |   });
  67  |
  68  |   test('prompt textarea accepts input', async ({ authedPage: page }) => {
  69  |     await page.goto('/sandbox');
  70  |     await page.waitForTimeout(1500);
  71  |     const textarea = page.locator('textarea').first();
  72  |     if (await textarea.isVisible()) {
  73  |       await textarea.fill('A lone samurai on a neon-lit rooftop in cyberpunk Tokyo');
  74  |       await expect(textarea).toHaveValue('A lone samurai on a neon-lit rooftop in cyberpunk Tokyo');
  75  |     }
  76  |   });
  77  |
  78  |   test('Generate Image button exists', async ({ authedPage: page }) => {
  79  |     await page.goto('/sandbox');
  80  |     await page.waitForTimeout(1500);
  81  |     const genBtn = page.getByRole('button', { name: /generate image/i }).first();
  82  |     if (await genBtn.isVisible()) {
  83  |       await expect(genBtn).toBeVisible();
  84  |     }
  85  |   });
  86  |
  87  |   test('video generation button exists', async ({ authedPage: page }) => {
  88  |     await page.goto('/sandbox');
  89  |     await page.waitForTimeout(1500);
  90  |     const vidBtn = page.getByRole('button', { name: /animate|generate video/i }).first();
  91  |     if (await vidBtn.isVisible()) {
  92  |       await expect(vidBtn).toBeVisible();
  93  |     }
  94  |   });
  95  |
  96  |   test('image ratio selector exists', async ({ authedPage: page }) => {
  97  |     await page.goto('/sandbox');
  98  |     await page.waitForTimeout(1500);
  99  |     const body = await page.locator('body').textContent();
  100 |     expect(body?.toLowerCase()).toMatch(/ratio|landscape|portrait|square|16:9|9:16|1:1/i);
  101 |   });
  102 |
  103 |   test('video model selector exists', async ({ authedPage: page }) => {
  104 |     await page.goto('/sandbox');
  105 |     await page.waitForTimeout(1500);
  106 |     const body = await page.locator('body').textContent();
  107 |     expect(body?.toLowerCase()).toMatch(/model|seedance|kling|wan|veo/i);
  108 |   });
  109 | });
  110 |
  111 | test.describe('Sandbox — Drafts', () => {
  112 |   test('drafts section is visible', async ({ authedPage: page }) => {
> 113 |     await page.goto('/sandbox');
      |                                 ^ Error: expect(received).toMatch(expected)
  114 |     await page.waitForTimeout(1500);
  115 |     const body = await page.locator('body').textContent();
  116 |     expect(body?.toLowerCase()).toMatch(/draft|saved|nothing saved/i);
  117 |   });
  118 |
  119 |   test('empty drafts show helpful message', async ({ authedPage: page }) => {
  120 |     await page.goto('/sandbox');
  121 |     await page.waitForTimeout(1500);
  122 |     // For a new user, drafts should be empty
  123 |     const body = await page.locator('body').textContent();
  124 |     // Either shows empty message or existing drafts
  125 |     expect(body).toBeTruthy();
  126 |   });
  127 | });
  128 |
```
