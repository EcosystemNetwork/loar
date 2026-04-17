# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Partial features redirect to Coming Soon >> /ads redirects to coming-soon
- Location: e2e/smoke.spec.ts:135:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/coming-soon/
Received string:  "http://localhost:3001/ads"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    13 × unexpected value "http://localhost:3001/ads"

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
                - generic [ref=e38]:
                    - heading "Ad Placements" [level=1] [ref=e39]:
                        - img [ref=e40]
                        - text: Ad Placements
                    - paragraph [ref=e43]: Sponsor AI-generated universes with your brand
                - generic [ref=e44]:
                    - generic [ref=e45]:
                        - button "Browse Slots" [ref=e46]
                        - button "My Campaigns" [ref=e47]
                    - generic [ref=e48]:
                        - generic [ref=e49]:
                            - button "All Types" [ref=e50]:
                                - img [ref=e51]
                                - text: All Types
                            - button "Billboard" [ref=e54]:
                                - img [ref=e55]
                                - text: Billboard
                            - button "Product" [ref=e57]:
                                - img [ref=e58]
                                - text: Product
                            - button "Character" [ref=e62]:
                                - img [ref=e63]
                                - text: Character
                            - button "Audio" [ref=e66]:
                                - img [ref=e67]
                                - text: Audio
                        - generic [ref=e72]:
                            - heading "How Ad Placements Work" [level=3] [ref=e74]
                            - generic [ref=e76]:
                                - generic [ref=e77]:
                                    - img [ref=e79]
                                    - generic [ref=e82]: Creator opens a slot on their universe
                                - generic [ref=e83]:
                                    - img [ref=e85]
                                    - generic [ref=e88]: Advertisers bid — highest bid wins
                                - generic [ref=e89]:
                                    - img [ref=e91]
                                    - generic [ref=e93]: Winning brand appears across N episodes
                                - generic [ref=e94]:
                                    - img [ref=e96]
                                    - generic [ref=e99]: Impressions tracked per episode automatically
                        - generic [ref=e100]:
                            - heading "Placement Types" [level=2] [ref=e101]
                            - generic [ref=e102]:
                                - generic [ref=e104]:
                                    - generic [ref=e105]:
                                        - img [ref=e106]
                                        - text: Billboard
                                    - paragraph [ref=e108]: Visual banner shown during episodes
                                - generic [ref=e110]:
                                    - generic [ref=e111]:
                                        - img [ref=e112]
                                        - text: Product
                                    - paragraph [ref=e116]: Brand product featured in the narrative
                                - generic [ref=e118]:
                                    - generic [ref=e119]:
                                        - img [ref=e120]
                                        - text: Character
                                    - paragraph [ref=e123]: Character co-created with your brand
                                - generic [ref=e125]:
                                    - generic [ref=e126]:
                                        - img [ref=e127]
                                        - text: Audio
                                    - paragraph [ref=e131]: Brand mentioned in the audio track
                            - generic [ref=e132]:
                                - img [ref=e133]
                                - paragraph [ref=e136]: Find slots inside universe shops
                                - paragraph [ref=e137]: Visit any universe's storefront to see open ad slots and place bids.
                                - link "Browse Universes" [ref=e138] [cursor=pointer]:
                                    - /url: /market
                                    - button "Browse Universes" [ref=e139]:
                                        - text: Browse Universes
                                        - img
        - contentinfo [ref=e140]:
            - generic [ref=e141]:
                - generic [ref=e142]: © 2026 LOAR
                - link "Terms of Service" [ref=e143] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e144] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e145] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e146] [cursor=pointer]:
                - generic [ref=e147]:
                    - img [ref=e149]
                    - img [ref=e184]
                - generic [ref=e218]: '-'
                - generic [ref=e219]: TanStack Router
    - generic [ref=e220]:
        - img [ref=e222]
        - button "Open Tanstack query devtools" [ref=e270] [cursor=pointer]:
            - img [ref=e271]
```

# Test source

```ts
  37  | // 2. Auth guard — unauthenticated users
  38  | // ---------------------------------------------------------------------------
  39  |
  40  | test.describe('Auth guards', () => {
  41  |   test('dashboard redirects to login when unauthenticated', async ({ page }) => {
  42  |     await page.goto('/dashboard');
  43  |     await expect(page).toHaveURL(/\/login/);
  44  |   });
  45  |
  46  |   test('login page renders wallet connect', async ({ page }) => {
  47  |     await page.goto('/login');
  48  |     await expect(page).toHaveURL(/\/login/);
  49  |     // The page should contain some sign-in prompt
  50  |     await expect(page.locator('body')).toContainText(/sign|connect|wallet/i);
  51  |   });
  52  | });
  53  |
  54  | // ---------------------------------------------------------------------------
  55  | // 3. Universe creation flow (UI loads, form renders)
  56  | // ---------------------------------------------------------------------------
  57  |
  58  | test.describe('Create flow', () => {
  59  |   test('create hub page loads', async ({ page }) => {
  60  |     await page.goto('/create');
  61  |     await expect(page).toHaveURL(/\/create/);
  62  |     await expect(page.locator('body')).toContainText(/create/i);
  63  |   });
  64  | });
  65  |
  66  | // ---------------------------------------------------------------------------
  67  | // 4. AI generation page (sandbox loads)
  68  | // ---------------------------------------------------------------------------
  69  |
  70  | test.describe('AI Generation', () => {
  71  |   test('sandbox page loads', async ({ page }) => {
  72  |     await page.goto('/sandbox');
  73  |     await expect(page).toHaveURL(/\/sandbox/);
  74  |   });
  75  | });
  76  |
  77  | // ---------------------------------------------------------------------------
  78  | // 5. Credits / Pricing
  79  | // ---------------------------------------------------------------------------
  80  |
  81  | test.describe('Credits & Pricing', () => {
  82  |   test('pricing page renders', async ({ page }) => {
  83  |     await page.goto('/pricing');
  84  |     await expect(page).toHaveURL(/\/pricing/);
  85  |     await expect(page.locator('body')).toContainText(/credit|price|plan/i);
  86  |   });
  87  |
  88  |   test('faucet page renders', async ({ page }) => {
  89  |     await page.goto('/credits');
  90  |     await expect(page).toHaveURL(/\/credits/);
  91  |   });
  92  | });
  93  |
  94  | // ---------------------------------------------------------------------------
  95  | // 6. Moderation & Legal
  96  | // ---------------------------------------------------------------------------
  97  |
  98  | test.describe('Moderation & Legal', () => {
  99  |   test('DMCA page renders', async ({ page }) => {
  100 |     await page.goto('/dmca');
  101 |     await expect(page).toHaveURL(/\/dmca/);
  102 |     await expect(page.locator('body')).toContainText(/takedown|dmca|copyright/i);
  103 |   });
  104 |
  105 |   test('terms page renders', async ({ page }) => {
  106 |     await page.goto('/terms');
  107 |     await expect(page).toHaveURL(/\/terms/);
  108 |     await expect(page.locator('body')).toContainText(/terms of service/i);
  109 |   });
  110 |
  111 |   test('privacy page renders', async ({ page }) => {
  112 |     await page.goto('/privacy');
  113 |     await expect(page).toHaveURL(/\/privacy/);
  114 |     await expect(page.locator('body')).toContainText(/privacy/i);
  115 |   });
  116 | });
  117 |
  118 | // ---------------------------------------------------------------------------
  119 | // 7. Partial-feature routes redirect to Coming Soon
  120 | // ---------------------------------------------------------------------------
  121 |
  122 | test.describe('Partial features redirect to Coming Soon', () => {
  123 |   const partialRoutes = [
  124 |     '/tokens',
  125 |     '/licensing',
  126 |     '/collabs',
  127 |     '/ads',
  128 |     '/market',
  129 |     '/sell',
  130 |     '/staking',
  131 |     '/bounties',
  132 |   ];
  133 |
  134 |   for (const route of partialRoutes) {
  135 |     test(`${route} redirects to coming-soon`, async ({ page }) => {
  136 |       await page.goto(route);
> 137 |       await expect(page).toHaveURL(/\/coming-soon/);
      |                          ^ Error: expect(page).toHaveURL(expected) failed
  138 |       await expect(page.locator('body')).toContainText(/coming soon/i);
  139 |     });
  140 |   }
  141 | });
  142 |
  143 | // ---------------------------------------------------------------------------
  144 | // 8. Navigation structure
  145 | // ---------------------------------------------------------------------------
  146 |
  147 | test.describe('Navigation', () => {
  148 |   test('header shows expected primary links', async ({ page }) => {
  149 |     await page.goto('/');
  150 |     const nav = page.locator('header nav').first();
  151 |     await expect(nav.getByText('Discover')).toBeVisible();
  152 |     await expect(nav.getByText('Create')).toBeVisible();
  153 |     await expect(nav.getByText('Gallery')).toBeVisible();
  154 |     await expect(nav.getByText('Pricing')).toBeVisible();
  155 |     await expect(nav.getByText('Dashboard')).toBeVisible();
  156 |   });
  157 |
  158 |   test('header does NOT show hidden partial-feature links', async ({ page }) => {
  159 |     await page.goto('/');
  160 |     const header = page.locator('header');
  161 |     // These should not appear as direct nav items
  162 |     await expect(header.getByRole('link', { name: 'Launchpad' })).toHaveCount(0);
  163 |     await expect(header.getByRole('link', { name: 'Licensing' })).toHaveCount(0);
  164 |     await expect(header.getByRole('link', { name: 'Collabs' })).toHaveCount(0);
  165 |     await expect(header.getByRole('link', { name: 'Ads' })).toHaveCount(0);
  166 |   });
  167 |
  168 |   test('wiki page is accessible from More menu', async ({ page }) => {
  169 |     await page.goto('/wiki');
  170 |     await expect(page).toHaveURL(/\/wiki/);
  171 |   });
  172 | });
  173 |
```
