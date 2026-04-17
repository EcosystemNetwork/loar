# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Partial features redirect to Coming Soon >> /tokens redirects to coming-soon
- Location: e2e/smoke.spec.ts:135:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/coming-soon/
Received string:  "http://localhost:3001/tokens"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    13 × unexpected value "http://localhost:3001/tokens"

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
                        - generic [ref=e38]:
                            - img [ref=e39]
                            - heading "Token Launchpad" [level=1] [ref=e44]
                        - paragraph [ref=e45]: Discover universe tokens. Every token = governance over a narrative universe.
                    - generic [ref=e46]:
                        - link "Portfolio" [ref=e47] [cursor=pointer]:
                            - /url: /tokens/portfolio
                            - button "Portfolio" [ref=e48]:
                                - img
                                - text: Portfolio
                        - link "Launch Token" [ref=e49] [cursor=pointer]:
                            - /url: /cinematicUniverseCreate
                            - button "Launch Token" [ref=e50]:
                                - img
                                - text: Launch Token
                - generic [ref=e51]:
                    - generic [ref=e53]:
                        - img [ref=e55]
                        - generic [ref=e60]:
                            - paragraph [ref=e61]: '2'
                            - paragraph [ref=e62]: Tokens Launched
                    - generic [ref=e64]:
                        - img [ref=e66]
                        - generic [ref=e68]:
                            - paragraph [ref=e69]: 20261639537693528.0K
                            - paragraph [ref=e70]: Total MCap (ETH)
                    - generic [ref=e72]:
                        - img [ref=e74]
                        - generic [ref=e77]:
                            - paragraph [ref=e78]: '22'
                            - paragraph [ref=e79]: Recent Swaps
                    - generic [ref=e81]:
                        - img [ref=e83]
                        - generic [ref=e85]:
                            - paragraph [ref=e86]: 100B
                            - paragraph [ref=e87]: Supply / Token
                    - generic [ref=e89]:
                        - img [ref=e91]
                        - generic [ref=e93]:
                            - paragraph [ref=e94]: LP Locked
                            - paragraph [ref=e95]: Forever. No Rugs.
                - generic [ref=e96]:
                    - generic [ref=e97]:
                        - generic [ref=e98]:
                            - generic [ref=e99]:
                                - img [ref=e100]
                                - textbox "Search by name, symbol, or address..." [ref=e103]
                            - generic [ref=e104]:
                                - button "Trending" [ref=e105]:
                                    - img
                                    - text: Trending
                                - button "New" [ref=e106]:
                                    - img
                                    - text: New
                                - button "Holders" [ref=e107]:
                                    - img
                                    - text: Holders
                                - button "Volume" [ref=e108]:
                                    - img
                                    - text: Volume
                                - button "A-Z" [ref=e109]:
                                    - img
                                    - text: A-Z
                        - generic [ref=e110]:
                            - 'link "Cyber War Cyber War $CYWAR 4h ago Price 10130819768.846764ETH 5 Holders 0 Swaps -- Vol 24h MCap 10130819768846764.0K ETH Maturity 0/5 Next: First trade LP Locked Governance" [ref=e111] [cursor=pointer]':
                                - /url: /tokens/0x80853FD1F9Edd437bEf6AD8e20CF2cD51321D472
                                - generic [ref=e113]:
                                    - generic [ref=e114]:
                                        - img "Cyber War" [ref=e115]
                                        - generic [ref=e117]:
                                            - generic [ref=e118]:
                                                - paragraph [ref=e119]: Cyber War
                                                - generic [ref=e120]: $CYWAR
                                            - generic [ref=e121]: 4h ago
                                    - generic [ref=e122]:
                                        - generic [ref=e124]:
                                            - paragraph [ref=e125]: Price
                                            - paragraph [ref=e126]: 10130819768.846764ETH
                                        - generic [ref=e128]:
                                            - generic [ref=e129]:
                                                - paragraph [ref=e130]: '5'
                                                - paragraph [ref=e131]: Holders
                                            - generic [ref=e132]:
                                                - paragraph [ref=e133]: '0'
                                                - paragraph [ref=e134]: Swaps
                                            - generic [ref=e135]:
                                                - paragraph [ref=e136]: '--'
                                                - paragraph [ref=e137]: Vol 24h
                                        - generic [ref=e138]:
                                            - generic [ref=e139]: MCap
                                            - generic [ref=e140]: 10130819768846764.0K ETH
                                        - generic [ref=e141]:
                                            - generic [ref=e142]:
                                                - generic [ref=e143]:
                                                    - img [ref=e144]
                                                    - text: Maturity
                                                - generic [ref=e148]: 0/5
                                            - paragraph [ref=e150]: 'Next: First trade'
                                        - generic [ref=e151]:
                                            - generic [ref=e152]:
                                                - generic [ref=e153]:
                                                    - img [ref=e154]
                                                    - text: LP Locked
                                                - generic [ref=e156]:
                                                    - img [ref=e157]
                                                    - text: Governance
                                            - button "Copy link" [ref=e162]:
                                                - img [ref=e163]
                            - 'link "Voidborn Saga Voidborn Saga $VOID 6h ago Price 10130819768.846764ETH 5 Holders 0 Swaps -- Vol 24h MCap 10130819768846764.0K ETH Maturity 0/5 Next: First trade LP Locked Governance" [ref=e169] [cursor=pointer]':
                                - /url: /tokens/0xEBc8Dc6bf5c4b0d579ea876C8C4965098F9d0A31
                                - generic [ref=e171]:
                                    - generic [ref=e172]:
                                        - img "Voidborn Saga" [ref=e173]
                                        - generic [ref=e175]:
                                            - generic [ref=e176]:
                                                - paragraph [ref=e177]: Voidborn Saga
                                                - generic [ref=e178]: $VOID
                                            - generic [ref=e179]: 6h ago
                                    - generic [ref=e180]:
                                        - generic [ref=e182]:
                                            - paragraph [ref=e183]: Price
                                            - paragraph [ref=e184]: 10130819768.846764ETH
                                        - generic [ref=e186]:
                                            - generic [ref=e187]:
                                                - paragraph [ref=e188]: '5'
                                                - paragraph [ref=e189]: Holders
                                            - generic [ref=e190]:
                                                - paragraph [ref=e191]: '0'
                                                - paragraph [ref=e192]: Swaps
                                            - generic [ref=e193]:
                                                - paragraph [ref=e194]: '--'
                                                - paragraph [ref=e195]: Vol 24h
                                        - generic [ref=e196]:
                                            - generic [ref=e197]: MCap
                                            - generic [ref=e198]: 10130819768846764.0K ETH
                                        - generic [ref=e199]:
                                            - generic [ref=e200]:
                                                - generic [ref=e201]:
                                                    - img [ref=e202]
                                                    - text: Maturity
                                                - generic [ref=e206]: 0/5
                                            - paragraph [ref=e208]: 'Next: First trade'
                                        - generic [ref=e209]:
                                            - generic [ref=e210]:
                                                - generic [ref=e211]:
                                                    - img [ref=e212]
                                                    - text: LP Locked
                                                - generic [ref=e214]:
                                                    - img [ref=e215]
                                                    - text: Governance
                                            - button "Copy link" [ref=e220]:
                                                - img [ref=e221]
                    - generic [ref=e229]:
                        - generic [ref=e230]:
                            - img [ref=e231]
                            - heading "Live Activity" [level=3] [ref=e233]
                        - generic [ref=e235]:
                            - generic [ref=e236]:
                                - generic [ref=e238]:
                                    - generic [ref=e240]: SELL
                                    - generic [ref=e241]:
                                        - generic "0xf347c8ced3d12f49ce8dc5df9302e5b5d4d30238" [ref=e242]: 0xf347...0238
                                        - generic [ref=e243]: 10m ago
                                - generic [ref=e244]:
                                    - paragraph [ref=e245]: '0.0e+0'
                                    - paragraph [ref=e246]: ETH
                            - generic [ref=e247]:
                                - generic [ref=e249]:
                                    - generic [ref=e251]: SELL
                                    - generic [ref=e252]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e253]: 0x3a9d...f98b
                                        - generic [ref=e254]: 58m ago
                                - generic [ref=e255]:
                                    - paragraph [ref=e256]: '1.9e-10'
                                    - paragraph [ref=e257]: ETH
                            - generic [ref=e258]:
                                - generic [ref=e260]:
                                    - generic [ref=e262]: BUY
                                    - generic [ref=e263]:
                                        - generic "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee" [ref=e264]: 0x9b6b...6eee
                                        - generic [ref=e265]: 1h ago
                                - generic [ref=e266]:
                                    - paragraph [ref=e267]: '1.0e-12'
                                    - paragraph [ref=e268]: ETH
                            - generic [ref=e269]:
                                - generic [ref=e271]:
                                    - generic [ref=e273]: BUY
                                    - generic [ref=e274]:
                                        - generic "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee" [ref=e275]: 0x9b6b...6eee
                                        - generic [ref=e276]: 1h ago
                                - generic [ref=e277]:
                                    - paragraph [ref=e278]: '1.0e-12'
                                    - paragraph [ref=e279]: ETH
                            - generic [ref=e280]:
                                - generic [ref=e282]:
                                    - generic [ref=e284]: SELL
                                    - generic [ref=e285]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e286]: 0x3a9d...f98b
                                        - generic [ref=e287]: 2h ago
                                - generic [ref=e288]:
                                    - paragraph [ref=e289]: '8.8e-11'
                                    - paragraph [ref=e290]: ETH
                            - generic [ref=e291]:
                                - generic [ref=e293]:
                                    - generic [ref=e295]: BUY
                                    - generic [ref=e296]:
                                        - generic "0x52b6c8973027292219cb91f2c1357c05cc3642cc" [ref=e297]: 0x52b6...42cc
                                        - generic [ref=e298]: 2h ago
                                - generic [ref=e299]:
                                    - paragraph [ref=e300]: '3.0e-12'
                                    - paragraph [ref=e301]: ETH
                            - generic [ref=e302]:
                                - generic [ref=e304]:
                                    - generic [ref=e306]: SELL
                                    - generic [ref=e307]:
                                        - generic "0x52b6c8973027292219cb91f2c1357c05cc3642cc" [ref=e308]: 0x52b6...42cc
                                        - generic [ref=e309]: 2h ago
                                - generic [ref=e310]:
                                    - paragraph [ref=e311]: '2.7e-12'
                                    - paragraph [ref=e312]: ETH
                            - generic [ref=e313]:
                                - generic [ref=e315]:
                                    - generic [ref=e317]: SELL
                                    - generic [ref=e318]:
                                        - generic "0x659420c427fdd8cc54daed70caa30eb923fbe1dc" [ref=e319]: 0x6594...e1dc
                                        - generic [ref=e320]: 2h ago
                                - generic [ref=e321]:
                                    - paragraph [ref=e322]: '1.3e-7'
                                    - paragraph [ref=e323]: ETH
                            - generic [ref=e324]:
                                - generic [ref=e326]:
                                    - generic [ref=e328]: SELL
                                    - generic [ref=e329]:
                                        - generic "0x659420c427fdd8cc54daed70caa30eb923fbe1dc" [ref=e330]: 0x6594...e1dc
                                        - generic [ref=e331]: 2h ago
                                - generic [ref=e332]:
                                    - paragraph [ref=e333]: '1.3e-7'
                                    - paragraph [ref=e334]: ETH
                            - generic [ref=e335]:
                                - generic [ref=e337]:
                                    - generic [ref=e339]: SELL
                                    - generic [ref=e340]:
                                        - generic "0x659420c427fdd8cc54daed70caa30eb923fbe1dc" [ref=e341]: 0x6594...e1dc
                                        - generic [ref=e342]: 2h ago
                                - generic [ref=e343]:
                                    - paragraph [ref=e344]: '1.3e-7'
                                    - paragraph [ref=e345]: ETH
                            - generic [ref=e346]:
                                - generic [ref=e348]:
                                    - generic [ref=e350]: SELL
                                    - generic [ref=e351]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e352]: 0x3a9d...f98b
                                        - generic [ref=e353]: 2h ago
                                - generic [ref=e354]:
                                    - paragraph [ref=e355]: '1.2e-10'
                                    - paragraph [ref=e356]: ETH
                            - generic [ref=e357]:
                                - generic [ref=e359]:
                                    - generic [ref=e361]: SELL
                                    - generic [ref=e362]:
                                        - generic "0xf347c8ced3d12f49ce8dc5df9302e5b5d4d30238" [ref=e363]: 0xf347...0238
                                        - generic [ref=e364]: 3h ago
                                - generic [ref=e365]:
                                    - paragraph [ref=e366]: '0.0e+0'
                                    - paragraph [ref=e367]: ETH
                            - generic [ref=e368]:
                                - generic [ref=e370]:
                                    - generic [ref=e372]: BUY
                                    - generic [ref=e373]:
                                        - generic "0x659420c427fdd8cc54daed70caa30eb923fbe1dc" [ref=e374]: 0x6594...e1dc
                                        - generic [ref=e375]: 4h ago
                                - generic [ref=e376]:
                                    - paragraph [ref=e377]: '2.5e-5'
                                    - paragraph [ref=e378]: ETH
                            - generic [ref=e379]:
                                - generic [ref=e381]:
                                    - generic [ref=e383]: BUY
                                    - generic [ref=e384]:
                                        - generic "0x659420c427fdd8cc54daed70caa30eb923fbe1dc" [ref=e385]: 0x6594...e1dc
                                        - generic [ref=e386]: 4h ago
                                - generic [ref=e387]:
                                    - paragraph [ref=e388]: '2.5e-5'
                                    - paragraph [ref=e389]: ETH
                            - generic [ref=e390]:
                                - generic [ref=e392]:
                                    - generic [ref=e394]: SELL
                                    - generic [ref=e395]:
                                        - generic "0x52b6c8973027292219cb91f2c1357c05cc3642cc" [ref=e396]: 0x52b6...42cc
                                        - generic [ref=e397]: 5h ago
                                - generic [ref=e398]:
                                    - paragraph [ref=e399]: '1.8e-11'
                                    - paragraph [ref=e400]: ETH
                            - generic [ref=e401]:
                                - generic [ref=e403]:
                                    - generic [ref=e405]: BUY
                                    - generic [ref=e406]:
                                        - generic "0x52b6c8973027292219cb91f2c1357c05cc3642cc" [ref=e407]: 0x52b6...42cc
                                        - generic [ref=e408]: 5h ago
                                - generic [ref=e409]:
                                    - paragraph [ref=e410]: '5.0e-12'
                                    - paragraph [ref=e411]: ETH
                            - generic [ref=e412]:
                                - generic [ref=e414]:
                                    - generic [ref=e416]: BUY
                                    - generic [ref=e417]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e418]: 0x3a9d...f98b
                                        - generic [ref=e419]: 5h ago
                                - generic [ref=e420]:
                                    - paragraph [ref=e421]: '2.8e-13'
                                    - paragraph [ref=e422]: ETH
                            - generic [ref=e423]:
                                - generic [ref=e425]:
                                    - generic [ref=e427]: BUY
                                    - generic [ref=e428]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e429]: 0x3a9d...f98b
                                        - generic [ref=e430]: 5h ago
                                - generic [ref=e431]:
                                    - paragraph [ref=e432]: '2.3e-13'
                                    - paragraph [ref=e433]: ETH
                            - generic [ref=e434]:
                                - generic [ref=e436]:
                                    - generic [ref=e438]: SELL
                                    - generic [ref=e439]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e440]: 0x3a9d...f98b
                                        - generic [ref=e441]: 5h ago
                                - generic [ref=e442]:
                                    - paragraph [ref=e443]: '1.1e-11'
                                    - paragraph [ref=e444]: ETH
                            - generic [ref=e445]:
                                - generic [ref=e447]:
                                    - generic [ref=e449]: SELL
                                    - generic [ref=e450]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e451]: 0x3a9d...f98b
                                        - generic [ref=e452]: 6h ago
                                - generic [ref=e453]:
                                    - paragraph [ref=e454]: '3.8e-4'
                                    - paragraph [ref=e455]: ETH
                            - generic [ref=e456]:
                                - generic [ref=e458]:
                                    - generic [ref=e460]: BUY
                                    - generic [ref=e461]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e462]: 0x3a9d...f98b
                                        - generic [ref=e463]: 6h ago
                                - generic [ref=e464]:
                                    - paragraph [ref=e465]: '3.8e-4'
                                    - paragraph [ref=e466]: ETH
                            - generic [ref=e467]:
                                - generic [ref=e469]:
                                    - generic [ref=e471]: SELL
                                    - generic [ref=e472]:
                                        - generic "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" [ref=e473]: 0x3a9d...f98b
                                        - generic [ref=e474]: 6h ago
                                - generic [ref=e475]:
                                    - paragraph [ref=e476]: '1426.1987'
                                    - paragraph [ref=e477]: ETH
        - contentinfo [ref=e478]:
            - generic [ref=e479]:
                - generic [ref=e480]: © 2026 LOAR
                - link "Terms of Service" [ref=e481] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e482] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e483] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e484] [cursor=pointer]:
                - generic [ref=e485]:
                    - img [ref=e487]
                    - img [ref=e522]
                - generic [ref=e556]: '-'
                - generic [ref=e557]: TanStack Router
    - generic [ref=e558]:
        - img [ref=e560]
        - button "Open Tanstack query devtools" [ref=e608] [cursor=pointer]:
            - img [ref=e609]
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
