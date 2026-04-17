# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: legal-misc.spec.ts >> Coming Soon Page >> back link navigates to /discover
- Location: e2e/legal-misc.spec.ts:104:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('link', { name: /back to discover/i }).or(locator('a[href*="/discover"]').first()) resolved to 2 elements:
    1) <a href="/discover" class="px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap text-muted-foreground hover:text-foreground hover:bg-muted/50">Discover</a> aka getByRole('link', { name: 'Discover', exact: true })
    2) <a href="/discover">…</a> aka getByRole('link', { name: 'Back to Discover' })

Call log:
  - waiting for getByRole('link', { name: /back to discover/i }).or(locator('a[href*="/discover"]').first())

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
            - generic [ref=e34]:
                - img [ref=e35]
                - heading "Coming Soon" [level=1] [ref=e40]
                - paragraph [ref=e41]: This feature is under active development and will be available in a future release. Check back soon!
                - link "Back to Discover" [ref=e42] [cursor=pointer]:
                    - /url: /discover
                    - button "Back to Discover" [ref=e43]:
                        - img
                        - text: Back to Discover
        - contentinfo [ref=e44]:
            - generic [ref=e45]:
                - generic [ref=e46]: © 2026 LOAR
                - link "Terms of Service" [ref=e47] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e48] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e49] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e50] [cursor=pointer]:
                - generic [ref=e51]:
                    - img [ref=e53]
                    - img [ref=e88]
                - generic [ref=e122]: '-'
                - generic [ref=e123]: TanStack Router
    - generic [ref=e124]:
        - img [ref=e126]
        - button "Open Tanstack query devtools" [ref=e174] [cursor=pointer]:
            - img [ref=e175]
```

# Test source

```ts
  9   |  * - Videos page loads
  10  |  * - Tokens/Launchpad page loads
  11  |  * - Market page loads
  12  |  * - Staking page loads
  13  |  * - Bounties page loads
  14  |  * - Agents page loads
  15  |  * - Sell page loads
  16  |  * - Licensing page loads
  17  |  * - Collabs page loads
  18  |  * - Ads page loads
  19  |  * - My Works page loads
  20  |  * - Docs page loads
  21  |  */
  22  |
  23  | import { test, expect } from './fixtures';
  24  |
  25  | /* -------------------------------------------------------------------------- */
  26  | /*  Legal Pages                                                               */
  27  | /* -------------------------------------------------------------------------- */
  28  |
  29  | test.describe('Terms of Service', () => {
  30  |   test('page loads with heading', async ({ page }) => {
  31  |     await page.goto('/terms');
  32  |     await expect(page).toHaveURL(/\/terms/);
  33  |     await expect(page.locator('body')).toContainText(/terms of service/i);
  34  |   });
  35  |
  36  |   test('shows last updated date', async ({ page }) => {
  37  |     await page.goto('/terms');
  38  |     await expect(page.locator('body')).toContainText(/last updated/i);
  39  |   });
  40  |
  41  |   test('has contact information', async ({ page }) => {
  42  |     await page.goto('/terms');
  43  |     await expect(page.locator('body')).toContainText(/loar\.fun/i);
  44  |   });
  45  |
  46  |   test('covers key sections', async ({ page }) => {
  47  |     await page.goto('/terms');
  48  |     const body = await page.locator('body').textContent();
  49  |     const requiredSections = [
  50  |       /eligibility/i,
  51  |       /user content/i,
  52  |       /prohibited/i,
  53  |       /limitation of liability/i,
  54  |       /governing law/i,
  55  |     ];
  56  |     for (const section of requiredSections) {
  57  |       expect(body).toMatch(section);
  58  |     }
  59  |   });
  60  |
  61  |   test('has header', async ({ page }) => {
  62  |     await page.goto('/terms');
  63  |     await expect(page.locator('header')).toBeVisible();
  64  |   });
  65  | });
  66  |
  67  | test.describe('Privacy Policy', () => {
  68  |   test('page loads with heading', async ({ page }) => {
  69  |     await page.goto('/privacy');
  70  |     await expect(page).toHaveURL(/\/privacy/);
  71  |     await expect(page.locator('body')).toContainText(/privacy/i);
  72  |   });
  73  |
  74  |   test('has header', async ({ page }) => {
  75  |     await page.goto('/privacy');
  76  |     await expect(page.locator('header')).toBeVisible();
  77  |   });
  78  | });
  79  |
  80  | /* -------------------------------------------------------------------------- */
  81  | /*  Coming Soon                                                               */
  82  | /* -------------------------------------------------------------------------- */
  83  |
  84  | test.describe('Coming Soon Page', () => {
  85  |   test('page loads with message', async ({ page }) => {
  86  |     await page.goto('/coming-soon');
  87  |     await expect(page).toHaveURL(/\/coming-soon/);
  88  |     await expect(page.locator('body')).toContainText(/coming soon/i);
  89  |   });
  90  |
  91  |   test('shows under development message', async ({ page }) => {
  92  |     await page.goto('/coming-soon');
  93  |     await expect(page.locator('body')).toContainText(/under active development/i);
  94  |   });
  95  |
  96  |   test('has back link to Discover', async ({ page }) => {
  97  |     await page.goto('/coming-soon');
  98  |     const backLink = page
  99  |       .getByRole('link', { name: /back to discover/i })
  100 |       .or(page.locator('a[href*="/discover"]').first());
  101 |     await expect(backLink).toBeVisible();
  102 |   });
  103 |
  104 |   test('back link navigates to /discover', async ({ page }) => {
  105 |     await page.goto('/coming-soon');
  106 |     const backLink = page
  107 |       .getByRole('link', { name: /back to discover/i })
  108 |       .or(page.locator('a[href*="/discover"]').first());
> 109 |     await backLink.click();
      |                    ^ Error: locator.click: Error: strict mode violation: getByRole('link', { name: /back to discover/i }).or(locator('a[href*="/discover"]').first()) resolved to 2 elements:
  110 |     await expect(page).toHaveURL(/\/discover/);
  111 |   });
  112 | });
  113 |
  114 | /* -------------------------------------------------------------------------- */
  115 | /*  Feature Pages — Ensure They Load (Not Crash)                              */
  116 | /* -------------------------------------------------------------------------- */
  117 |
  118 | test.describe('Feature Pages Load Successfully', () => {
  119 |   const featureRoutes = [
  120 |     { path: '/activity', name: 'Activity Feed' },
  121 |     { path: '/videos', name: 'Videos' },
  122 |     { path: '/tokens', name: 'Token Launchpad' },
  123 |     { path: '/market', name: 'Market' },
  124 |     { path: '/staking', name: 'Staking' },
  125 |     { path: '/bounties', name: 'Bounties' },
  126 |     { path: '/agents', name: 'Agents' },
  127 |     { path: '/sell', name: 'Sell' },
  128 |     { path: '/licensing', name: 'Licensing' },
  129 |     { path: '/collabs', name: 'Collabs' },
  130 |     { path: '/ads', name: 'Ads' },
  131 |     { path: '/docs', name: 'Docs' },
  132 |   ];
  133 |
  134 |   for (const { path, name } of featureRoutes) {
  135 |     test(`${name} page (${path}) loads without crash`, async ({ page }) => {
  136 |       await page.goto(path);
  137 |       await page.waitForTimeout(1000);
  138 |       // Page should render some content (not a blank white page)
  139 |       const body = await page.locator('body').textContent();
  140 |       expect(body!.length).toBeGreaterThan(10);
  141 |       // Header should still be visible (layout not broken)
  142 |       await expect(page.locator('header')).toBeVisible();
  143 |     });
  144 |   }
  145 | });
  146 |
  147 | /* -------------------------------------------------------------------------- */
  148 | /*  My Works (Requires Auth)                                                  */
  149 | /* -------------------------------------------------------------------------- */
  150 |
  151 | test.describe('My Works Page', () => {
  152 |   test('my-works page loads', async ({ page }) => {
  153 |     await page.goto('/my-works');
  154 |     await page.waitForTimeout(1000);
  155 |     // May require auth or show public content
  156 |     await expect(page.locator('body')).toBeVisible();
  157 |   });
  158 | });
  159 |
  160 | /* -------------------------------------------------------------------------- */
  161 | /*  Token Sub-Routes                                                          */
  162 | /* -------------------------------------------------------------------------- */
  163 |
  164 | test.describe('Token Detail Page', () => {
  165 |   test('token detail page loads for an address', async ({ page }) => {
  166 |     await page.goto('/tokens/0x1234567890abcdef1234567890abcdef12345678');
  167 |     await page.waitForTimeout(1000);
  168 |     await expect(page.locator('body')).toBeVisible();
  169 |   });
  170 |
  171 |   test('token creator page loads', async ({ page }) => {
  172 |     await page.goto('/tokens/creator.0x1234567890abcdef1234567890abcdef12345678');
  173 |     await page.waitForTimeout(1000);
  174 |     await expect(page.locator('body')).toBeVisible();
  175 |   });
  176 |
  177 |   test('token portfolio page loads', async ({ page }) => {
  178 |     await page.goto('/tokens/portfolio');
  179 |     await page.waitForTimeout(1000);
  180 |     await expect(page.locator('body')).toBeVisible();
  181 |   });
  182 | });
  183 |
  184 | /* -------------------------------------------------------------------------- */
  185 | /*  Bounty Sub-Routes                                                         */
  186 | /* -------------------------------------------------------------------------- */
  187 |
  188 | test.describe('Bounty Detail Page', () => {
  189 |   test('bounty detail page loads', async ({ page }) => {
  190 |     await page.goto('/bounties/test-bounty-123');
  191 |     await page.waitForTimeout(1000);
  192 |     await expect(page.locator('body')).toBeVisible();
  193 |   });
  194 |
  195 |   test('my bounties page loads', async ({ page }) => {
  196 |     await page.goto('/bounties/mine');
  197 |     await page.waitForTimeout(1000);
  198 |     await expect(page.locator('body')).toBeVisible();
  199 |   });
  200 | });
  201 |
  202 | /* -------------------------------------------------------------------------- */
  203 | /*  Agent Sub-Routes                                                          */
  204 | /* -------------------------------------------------------------------------- */
  205 |
  206 | test.describe('Agent Routes', () => {
  207 |   test('agents index page loads', async ({ page }) => {
  208 |     await page.goto('/agents');
  209 |     await page.waitForTimeout(1000);
```
