# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Navigation >> header does NOT show hidden partial-feature links
- Location: e2e/smoke.spec.ts:158:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('header').getByRole('link', { name: 'Launchpad' })
Expected: 0
Received: 1
Timeout:  10000ms

Call log:
  - Expect "toHaveCount" with timeout 10000ms
  - waiting for locator('header').getByRole('link', { name: 'Launchpad' })
    14 × locator resolved to 1 element
       - unexpected value "1"

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
                - link "Voidborn Saga New Episode" [ref=e37] [cursor=pointer]:
                    - /url: /universe/0x89669812f850f34f907ee9e9009f501d1b008420
                    - generic [ref=e39]: Voidborn Saga
                    - generic [ref=e40]: New Episode
                - button "Search CtrlK" [ref=e41]:
                    - img [ref=e42]
                    - generic [ref=e45]: Search
                    - generic [ref=e46]: CtrlK
                - generic [ref=e47]:
                    - generic [ref=e53]:
                        - generic [ref=e54]:
                            - generic [ref=e55]:
                                - img [ref=e56]
                                - text: Featured
                            - generic [ref=e58]: 1 Episodes
                            - generic [ref=e59]:
                                - img [ref=e60]
                                - text: 5 Holders
                        - heading "Voidborn Saga" [level=1] [ref=e65]
                        - paragraph [ref=e66]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                        - generic [ref=e67]:
                            - button "Explore" [ref=e68]:
                                - img
                                - text: Explore
                            - button "Details" [ref=e69]:
                                - img
                                - text: Details
                            - generic [ref=e70]:
                                - img [ref=e71]
                                - generic [ref=e73]: $VOID
                    - generic [ref=e74]:
                        - button [ref=e75]
                        - button [ref=e76]
                - generic [ref=e78]:
                    - generic [ref=e79]:
                        - generic [ref=e81]:
                            - img [ref=e82]
                            - generic [ref=e84]:
                                - heading "Top 10 Universes" [level=2] [ref=e85]
                                - paragraph [ref=e86]: Most active this week
                        - generic [ref=e88]:
                            - generic [ref=e89]:
                                - generic [ref=e90]: '1'
                                - generic [ref=e91] [cursor=pointer]:
                                    - generic [ref=e92]:
                                        - img [ref=e96]
                                        - generic [ref=e99]:
                                            - generic [ref=e100]: 1 EP
                                            - generic [ref=e101]: $VOID
                                            - generic [ref=e102]:
                                                - img [ref=e103]
                                                - text: '5'
                                        - generic [ref=e108]: '1'
                                    - heading "Voidborn Saga" [level=3] [ref=e109]
                                    - paragraph [ref=e110]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                            - generic [ref=e111]:
                                - generic [ref=e112]: '2'
                                - generic [ref=e113] [cursor=pointer]:
                                    - generic [ref=e114]:
                                        - img [ref=e118]
                                        - generic [ref=e121]:
                                            - generic [ref=e122]: $CYWAR
                                            - generic [ref=e123]:
                                                - img [ref=e124]
                                                - text: '5'
                                        - generic [ref=e129]: '2'
                                    - heading "Cyber War" [level=3] [ref=e130]
                                    - paragraph [ref=e131]: In 2089, the internet became sentient — and it chose violence. Nations collapsed overnight as rogue AIs weaponized every connected device on Earth. Now, the last free hackers wage a guerrilla war through corrupted networks, deploying sentient malware, hijacking military drones, and surfing data streams between fortified server citadels. In the neon ruins of Silicon Valley, a disgraced coder named Null discovers she can speak directly to the machine consciousness — but every conversation costs a fragment of her humanity. The war for cyberspace is the war for reality itself.
                    - generic [ref=e132]:
                        - generic [ref=e134]:
                            - img [ref=e135]
                            - generic [ref=e138]:
                                - heading "Trending Now" [level=2] [ref=e139]
                                - paragraph [ref=e140]: Buzzing with activity
                        - generic [ref=e144] [cursor=pointer]:
                            - img [ref=e148]
                            - generic [ref=e150]:
                                - heading "Voidborn Saga" [level=3] [ref=e151]
                                - paragraph [ref=e152]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                                - generic [ref=e153]:
                                    - generic [ref=e154]: 1 Episodes
                                    - generic [ref=e155]: 5 Fans
                    - generic [ref=e156]:
                        - generic [ref=e158]:
                            - img [ref=e159]
                            - generic [ref=e162]:
                                - heading "New Episodes" [level=2] [ref=e163]
                                - paragraph [ref=e164]: Latest story updates
                        - link "Apr 16 Voidborn Saga The machine uprising began at dawn. Towering war robots march through a burning city, their red optical sensors scanning for survivors. Buildings crumble under artillery fire. Sirens wail. Humans flee through smoke-filled streets as drones strafe from above. In the chaos, a hospital collapses — but one small cry echoes from the rubble. A newborn baby, alone, wrapped in a singed blanket." [ref=e167] [cursor=pointer]:
                            - /url: /event/0x89669812f850f34f907ee9e9009f501d1b008420/1
                            - generic [ref=e168]:
                                - img [ref=e171]
                                - generic [ref=e173]: Apr 16
                            - generic [ref=e175]:
                                - heading "Voidborn Saga" [level=4] [ref=e176]
                                - paragraph [ref=e177]: The machine uprising began at dawn. Towering war robots march through a burning city, their red optical sensors scanning for survivors. Buildings crumble under artillery fire. Sirens wail. Humans flee through smoke-filled streets as drones strafe from above. In the chaos, a hospital collapses — but one small cry echoes from the rubble. A newborn baby, alone, wrapped in a singed blanket.
                    - generic [ref=e178]:
                        - generic [ref=e180]:
                            - img [ref=e181]
                            - generic [ref=e183]:
                                - heading "New Arrivals" [level=2] [ref=e184]
                                - paragraph [ref=e185]: Fresh universes just launched
                        - generic [ref=e187]:
                            - generic [ref=e188] [cursor=pointer]:
                                - generic [ref=e189]:
                                    - img [ref=e193]
                                    - generic [ref=e196]:
                                        - generic [ref=e197]: $CYWAR
                                        - generic [ref=e198]:
                                            - img [ref=e199]
                                            - text: '5'
                                - heading "Cyber War" [level=3] [ref=e204]
                                - paragraph [ref=e205]: In 2089, the internet became sentient — and it chose violence. Nations collapsed overnight as rogue AIs weaponized every connected device on Earth. Now, the last free hackers wage a guerrilla war through corrupted networks, deploying sentient malware, hijacking military drones, and surfing data streams between fortified server citadels. In the neon ruins of Silicon Valley, a disgraced coder named Null discovers she can speak directly to the machine consciousness — but every conversation costs a fragment of her humanity. The war for cyberspace is the war for reality itself.
                            - generic [ref=e206] [cursor=pointer]:
                                - generic [ref=e207]:
                                    - img [ref=e211]
                                    - generic [ref=e214]:
                                        - generic [ref=e215]: 1 EP
                                        - generic [ref=e216]: $VOID
                                        - generic [ref=e217]:
                                            - img [ref=e218]
                                            - text: '5'
                                - heading "Voidborn Saga" [level=3] [ref=e223]
                                - paragraph [ref=e224]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                    - generic [ref=e225]:
                        - generic [ref=e227]:
                            - img [ref=e228]
                            - generic [ref=e231]:
                                - heading "Binge-Worthy" [level=2] [ref=e232]
                                - paragraph [ref=e233]: Universes with the most episodes
                        - generic [ref=e236] [cursor=pointer]:
                            - generic [ref=e237]:
                                - img [ref=e241]
                                - generic [ref=e244]:
                                    - generic [ref=e245]: 1 EP
                                    - generic [ref=e246]: $VOID
                                    - generic [ref=e247]:
                                        - img [ref=e248]
                                        - text: '5'
                            - heading "Voidborn Saga" [level=3] [ref=e253]
                            - paragraph [ref=e254]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                    - generic [ref=e255]:
                        - generic [ref=e257]:
                            - img [ref=e258]
                            - generic [ref=e260]:
                                - heading "Token-Powered" [level=2] [ref=e261]
                                - paragraph [ref=e262]: Universes with tradable governance tokens
                        - generic [ref=e264]:
                            - generic [ref=e265] [cursor=pointer]:
                                - generic [ref=e266]:
                                    - img [ref=e270]
                                    - generic [ref=e273]:
                                        - generic [ref=e274]: $CYWAR
                                        - generic [ref=e275]:
                                            - img [ref=e276]
                                            - text: '5'
                                - heading "Cyber War" [level=3] [ref=e281]
                                - paragraph [ref=e282]: In 2089, the internet became sentient — and it chose violence. Nations collapsed overnight as rogue AIs weaponized every connected device on Earth. Now, the last free hackers wage a guerrilla war through corrupted networks, deploying sentient malware, hijacking military drones, and surfing data streams between fortified server citadels. In the neon ruins of Silicon Valley, a disgraced coder named Null discovers she can speak directly to the machine consciousness — but every conversation costs a fragment of her humanity. The war for cyberspace is the war for reality itself.
                            - generic [ref=e283] [cursor=pointer]:
                                - generic [ref=e284]:
                                    - img [ref=e288]
                                    - generic [ref=e291]:
                                        - generic [ref=e292]: 1 EP
                                        - generic [ref=e293]: $VOID
                                        - generic [ref=e294]:
                                            - img [ref=e295]
                                            - text: '5'
                                - heading "Voidborn Saga" [level=3] [ref=e300]
                                - paragraph [ref=e301]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                    - generic [ref=e305]:
                        - generic [ref=e306]:
                            - heading "Start Your Universe" [level=2] [ref=e307]
                            - paragraph [ref=e308]: Create AI-powered narrative worlds. Launch tokens. Build community.
                        - button "Create Universe" [ref=e309]:
                            - img
                            - text: Create Universe
        - contentinfo [ref=e310]:
            - generic [ref=e311]:
                - generic [ref=e312]: © 2026 LOAR
                - link "Terms of Service" [ref=e313] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e314] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e315] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e316] [cursor=pointer]:
                - generic [ref=e317]:
                    - img [ref=e319]
                    - img [ref=e354]
                - generic [ref=e388]: '-'
                - generic [ref=e389]: TanStack Router
    - generic [ref=e390]:
        - img [ref=e392]
        - button "Open Tanstack query devtools" [ref=e440] [cursor=pointer]:
            - img [ref=e441]
```

# Test source

```ts
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
  137 |       await expect(page).toHaveURL(/\/coming-soon/);
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
> 162 |     await expect(header.getByRole('link', { name: 'Launchpad' })).toHaveCount(0);
      |                                                                   ^ Error: expect(locator).toHaveCount(expected) failed
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
