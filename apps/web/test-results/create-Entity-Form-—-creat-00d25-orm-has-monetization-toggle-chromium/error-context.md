# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: create.spec.ts >> Entity Form — /create/$kind >> entity form has monetization toggle
- Location: e2e/create.spec.ts:110:3

# Error details

```
Error: expect(received).toMatch(expected)

Expected pattern: /monetiz|non-monetiz|original|fan/i
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
})(\"class\",\"vite-ui-theme\",\"dark\",null,[\"light\",\"dark\"],null,true,true)discovercreategallerylaunchpadpricingdashboardmoreconnect wallettoggle themetestnet — this is a testnet deployment. funds and tokens have no real value.welcome to loardecentralized narrative control suitesign inconnect your ethereum wallet to get startedconnect walletsepoliasign in with any ethereum wallet.powered by thirdweb© 2026 loarterms of serviceprivacy policydmcatanstacktanstack router v1router16 itemsstate9 itemsstatus: \"idle\"loadedat: 1776386111969isloading: falseistransitioning: falsematches2 itemslocation8 itemsresolvedlocation8 itemsstatuscode: 200redirect: routesbyid67 itemsroutesbypath66 itemsoptions9 itemsdefaultpreloaddelay: 50defaultpendingms: 1000defaultpendingminms: 500context1 itemroutetree12 itemsdefaultpreload: \"intent\"casesensitive: falsenotfoundmode: \"fuzzy\"protocolallowlist4 itemsshouldviewtransition: isviewtransitiontypessupported: trueisscrollrestoring: falseisscrollrestorationsetup: trueisserver: falseprotocolallowlist4 itemsorigin: \"http://localhost:3001\"resolvepathcache: {}processedtree5 itemsrewrite: pendingbuiltlocation: commitlocationpromise: pathname/loginroutesmatcheshistoryage / staletime / gctime__root__ ➔/ ➔activity ➔checkout ➔cinematicuniversecreate ➔coming-soon ➔credits ➔dashboard ➔discover ➔dmca ➔docs ➔gallery ➔login ➔market ➔my-works ➔notifications ➔pricing ➔privacy ➔sandbox ➔staking ➔subscriptions ➔terms ➔upload ➔videos ➔admin/moderation ads/$slotid ➔ads/new agents/$uid ➔agents/dashboard ➔agents/register analytics/$universeid bounties/$bountyid ➔bounties/mine canon/$universeid ➔collabs/new create/$kind governance/$universeid ➔licensing/new order/$id play/$universeid product/$id profile/$username ➔profile/edit ➔sell/earnings ➔sell/new shop/$universeid tokens/$address ➔tokens/portfolio treasury/$universeid universe/$id deploy-token gallery gen-config wiki/$kind ➔ads/ ➔agents/ ➔bounties/ ➔collabs/ ➔create/ ➔licensing/ ➔sell/ ➔tokens/ ➔wiki/ event/$universe/$event tokens/creator/$address wiki/character/$id wiki/entity/$id search params📋1 itemredirect: \"/create/person\"-tanstack router·········
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
                    - img "LOAR" [ref=e37]
                    - heading "Welcome to LOAR" [level=1] [ref=e38]
                    - paragraph [ref=e39]: Decentralized Narrative Control Suite
                - generic [ref=e40]:
                    - generic [ref=e41]:
                        - heading "Sign In" [level=2] [ref=e42]
                        - paragraph [ref=e43]: Connect your Ethereum wallet to get started
                    - button "Connect Wallet" [ref=e46] [cursor=pointer]
                    - generic [ref=e47]:
                        - generic [ref=e50]: Sepolia
                        - paragraph [ref=e52]: Sign in with any Ethereum wallet.
                - paragraph [ref=e53]: Powered by thirdweb
        - contentinfo [ref=e54]:
            - generic [ref=e55]:
                - generic [ref=e56]: © 2026 LOAR
                - link "Terms of Service" [ref=e57] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e58] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e59] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e60] [cursor=pointer]:
                - generic [ref=e61]:
                    - img [ref=e63]
                    - img [ref=e98]
                - generic [ref=e132]: '-'
                - generic [ref=e133]: TanStack Router
    - generic [ref=e134]:
        - img [ref=e136]
        - button "Open Tanstack query devtools" [ref=e184] [cursor=pointer]:
            - img [ref=e185]
```

# Test source

```ts
  16  |
  17  | test.describe('Create Hub — Page Load', () => {
  18  |   test('create hub loads with heading', async ({ page }) => {
  19  |     await page.goto('/create');
  20  |     await expect(page).toHaveURL(/\/create/);
  21  |     await expect(page.locator('body')).toContainText(/create/i);
  22  |   });
  23  |
  24  |   test('create hub has header', async ({ page }) => {
  25  |     await page.goto('/create');
  26  |     await expect(page.locator('header')).toBeVisible();
  27  |   });
  28  | });
  29  |
  30  | test.describe('Create Hub — Entity Type Cards', () => {
  31  |   const entityKinds = ['Universe', 'Person', 'Place', 'Faction', 'Lore', 'Species', 'Organization'];
  32  |
  33  |   for (const kind of entityKinds) {
  34  |     test(`shows ${kind} entity card`, async ({ page }) => {
  35  |       await page.goto('/create');
  36  |       await expect(page.getByText(kind, { exact: false }).first()).toBeVisible();
  37  |     });
  38  |   }
  39  |
  40  |   test('shows Upload Media card', async ({ page }) => {
  41  |     await page.goto('/create');
  42  |     await expect(page.getByText(/upload media/i).first()).toBeVisible();
  43  |   });
  44  |
  45  |   test('Universe card mentions on-chain deployment', async ({ page }) => {
  46  |     await page.goto('/create');
  47  |     await expect(page.getByText(/on-chain|governance token|deploy/i).first()).toBeVisible();
  48  |   });
  49  |
  50  |   test('Person card mentions characters', async ({ page }) => {
  51  |     await page.goto('/create');
  52  |     await expect(page.getByText(/character|hero|villain|NPC/i).first()).toBeVisible();
  53  |   });
  54  | });
  55  |
  56  | test.describe('Create Hub — Navigation to Forms', () => {
  57  |   test('clicking Person card navigates to /create/person', async ({ page }) => {
  58  |     await page.goto('/create');
  59  |     // Find the Person card and click it
  60  |     const personLink = page.locator('a[href*="/create/person"]').first();
  61  |     if (await personLink.isVisible()) {
  62  |       await personLink.click();
  63  |       await expect(page).toHaveURL(/\/create\/person/);
  64  |     }
  65  |   });
  66  |
  67  |   test('clicking Place card navigates to /create/place', async ({ page }) => {
  68  |     await page.goto('/create');
  69  |     const placeLink = page.locator('a[href*="/create/place"]').first();
  70  |     if (await placeLink.isVisible()) {
  71  |       await placeLink.click();
  72  |       await expect(page).toHaveURL(/\/create\/place/);
  73  |     }
  74  |   });
  75  | });
  76  |
  77  | test.describe('Entity Form — /create/$kind', () => {
  78  |   test('person form loads with correct heading', async ({ page }) => {
  79  |     await injectMockSession(page);
  80  |     await page.goto('/create/person');
  81  |     await expect(page.locator('body')).toContainText(/new.*person|create.*person/i);
  82  |   });
  83  |
  84  |   test('entity form has name input', async ({ page }) => {
  85  |     await injectMockSession(page);
  86  |     await page.goto('/create/person');
  87  |     const nameInput = page.getByPlaceholder(/name/i).first().or(page.locator('input').first());
  88  |     await expect(nameInput).toBeVisible();
  89  |   });
  90  |
  91  |   test('entity form has summary/description textarea', async ({ page }) => {
  92  |     await injectMockSession(page);
  93  |     await page.goto('/create/person');
  94  |     await page.waitForTimeout(500);
  95  |     // Look for a textarea element
  96  |     const textarea = page.locator('textarea').first();
  97  |     if (await textarea.isVisible()) {
  98  |       await expect(textarea).toBeVisible();
  99  |     }
  100 |   });
  101 |
  102 |   test('entity form has monetization toggle', async ({ page }) => {
  103 |     await injectMockSession(page);
  104 |     await page.goto('/create/person');
  105 |     await page.waitForTimeout(500);
  106 |     // Look for monetization-related UI
  107 |     const body = await page.locator('body').textContent();
  108 |     expect(body?.toLowerCase()).toMatch(/monetiz|non-monetiz|original|fan/i);
  109 |   });
  110 |
  111 |   test('filling in name enables submit button', async ({ page }) => {
  112 |     await injectMockSession(page);
  113 |     await page.goto('/create/person');
  114 |     await page.waitForTimeout(500);
  115 |     // Type a name
> 116 |     const nameInput = page
      |                                 ^ Error: expect(received).toMatch(expected)
  117 |       .getByPlaceholder(/name/i)
  118 |       .first()
  119 |       .or(page.locator('input[type="text"]').first());
  120 |     if (await nameInput.isVisible()) {
  121 |       await nameInput.fill('Test Character');
  122 |       await page.waitForTimeout(300);
  123 |       // Submit button should exist
  124 |       const submitBtn = page.getByRole('button', { name: /create/i }).first();
  125 |       if (await submitBtn.isVisible()) {
  126 |         await expect(submitBtn).toBeVisible();
  127 |       }
  128 |     }
  129 |   });
  130 |
  131 |   test('place form loads with correct heading', async ({ page }) => {
  132 |     await injectMockSession(page);
  133 |     await page.goto('/create/place');
  134 |     await expect(page.locator('body')).toContainText(/new.*place|create.*place/i);
  135 |   });
  136 |
  137 |   test('faction form loads with correct heading', async ({ page }) => {
  138 |     await injectMockSession(page);
  139 |     await page.goto('/create/faction');
  140 |     await expect(page.locator('body')).toContainText(/new.*faction|create.*faction/i);
  141 |   });
  142 |
  143 |   test('event form loads with correct heading', async ({ page }) => {
  144 |     await injectMockSession(page);
  145 |     await page.goto('/create/event');
  146 |     await expect(page.locator('body')).toContainText(/new.*event|create.*event|new.*scene/i);
  147 |   });
  148 |
  149 |   test('lore form loads with correct heading', async ({ page }) => {
  150 |     await injectMockSession(page);
  151 |     await page.goto('/create/lore');
  152 |     await expect(page.locator('body')).toContainText(/new.*lore|create.*lore/i);
  153 |   });
  154 |
  155 |   test('species form loads with correct heading', async ({ page }) => {
  156 |     await injectMockSession(page);
  157 |     await page.goto('/create/species');
  158 |     await expect(page.locator('body')).toContainText(/new.*species|create.*species/i);
  159 |   });
  160 | });
  161 |
  162 | test.describe('Entity Form — Monetization & Rights', () => {
  163 |   test('selecting monetized shows rights declaration', async ({ page }) => {
  164 |     await injectMockSession(page);
  165 |     await page.goto('/create/person');
  166 |     await page.waitForTimeout(500);
  167 |
  168 |     // Look for and click the monetized option
  169 |     const monetizedBtn = page
  170 |       .getByRole('button', { name: /monetized/i })
  171 |       .first()
  172 |       .or(page.getByText(/monetized/i).first());
  173 |     if (await monetizedBtn.isVisible()) {
  174 |       await monetizedBtn.click();
  175 |       await page.waitForTimeout(300);
  176 |       // Rights declaration should appear
  177 |       const body = await page.locator('body').textContent();
  178 |       expect(body?.toLowerCase()).toMatch(/original work|licensed|rights/i);
  179 |     }
  180 |   });
  181 | });
  182 |
  183 | test.describe('Entity Form — AI Features', () => {
  184 |   test('Generate with AI button exists', async ({ page }) => {
  185 |     await injectMockSession(page);
  186 |     await page.goto('/create/person');
  187 |     await page.waitForTimeout(500);
  188 |     const aiBtn = page
  189 |       .getByRole('button', { name: /generate.*ai/i })
  190 |       .first()
  191 |       .or(page.getByText(/generate.*ai/i).first());
  192 |     // AI generation button should exist (may be disabled without name)
  193 |     if (await aiBtn.isVisible()) {
  194 |       await expect(aiBtn).toBeVisible();
  195 |     }
  196 |   });
  197 | });
  198 |
  199 | test.describe('Universe Creation — /cinematicUniverseCreate', () => {
  200 |   test('redirects unauthenticated users to login', async ({ page }) => {
  201 |     await page.goto('/cinematicUniverseCreate');
  202 |     await expect(page).toHaveURL(/\/login/);
  203 |   });
  204 |
  205 |   test('authenticated user can access universe creation page', async ({ authedPage: page }) => {
  206 |     await page.goto('/cinematicUniverseCreate');
  207 |     await page.waitForTimeout(1000);
  208 |     const url = page.url();
  209 |     // Should either stay on the page or show content
  210 |     expect(url).toBeTruthy();
  211 |   });
  212 | });
  213 |
```
