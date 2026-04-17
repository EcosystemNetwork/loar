# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation.spec.ts >> Primary Navigation Links >> shows Create link
- Location: e2e/navigation.spec.ts:47:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('header nav').first().getByText('Create')
Expected: visible
Received: hidden
Timeout:  10000ms

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('header nav').first().getByText('Create')
    12 × locator resolved to <a href="/create" class="px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap text-muted-foreground hover:text-foreground hover:bg-muted/50">Create</a>
       - unexpected value "hidden"

```

# Page snapshot

```yaml
- generic [ref=e2]:
    - generic [ref=e3]:
        - banner [ref=e4]:
            - generic [ref=e6]:
                - link "LOAR Logo" [ref=e8] [cursor=pointer]:
                    - /url: /
                    - img "LOAR Logo" [ref=e9]
                - generic [ref=e10]:
                    - button "Notifications" [ref=e12]:
                        - img [ref=e13]
                    - button "Connect Wallet" [ref=e17] [cursor=pointer]
                    - button "Standard mode — click to show Web3 details" [ref=e18]:
                        - img
                    - button "Toggle theme" [ref=e19]:
                        - img
                        - img
                        - generic [ref=e20]: Toggle theme
                    - button "Open navigation menu" [ref=e21]:
                        - img
        - generic [ref=e22]:
            - strong [ref=e23]: Testnet
            - text: — This is a testnet deployment. Funds and tokens have no real value.
        - main [ref=e24]:
            - generic [ref=e25]:
                - link "Voidborn Saga New Episode" [ref=e28] [cursor=pointer]:
                    - /url: /universe/0x89669812f850f34f907ee9e9009f501d1b008420
                    - generic [ref=e30]: Voidborn Saga
                    - generic [ref=e31]: New Episode
                - button [ref=e32]:
                    - img [ref=e33]
                - generic [ref=e36]:
                    - generic [ref=e42]:
                        - generic [ref=e43]:
                            - generic [ref=e44]:
                                - img [ref=e45]
                                - text: Featured
                            - generic [ref=e47]: 1 Episodes
                            - generic [ref=e48]:
                                - img [ref=e49]
                                - text: 5 Holders
                        - heading "Voidborn Saga" [level=1] [ref=e54]
                        - paragraph [ref=e55]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                        - generic [ref=e56]:
                            - button "Explore" [ref=e57]:
                                - img
                                - text: Explore
                            - button "Details" [ref=e58]:
                                - img
                                - text: Details
                    - generic [ref=e59]:
                        - button [ref=e60]
                        - button [ref=e61]
                - generic [ref=e63]:
                    - generic [ref=e64]:
                        - generic [ref=e66]:
                            - img [ref=e67]
                            - generic [ref=e69]:
                                - heading "Top 10 Universes" [level=2] [ref=e70]
                                - paragraph [ref=e71]: Most active this week
                        - generic [ref=e72]:
                            - generic [ref=e73]:
                                - generic [ref=e74]:
                                    - generic [ref=e75]: '1'
                                    - generic [ref=e76] [cursor=pointer]:
                                        - generic [ref=e77]:
                                            - img [ref=e81]
                                            - generic [ref=e84]:
                                                - generic [ref=e85]: 1 EP
                                                - generic [ref=e86]: $VOID
                                                - generic [ref=e87]:
                                                    - img [ref=e88]
                                                    - text: '5'
                                            - generic [ref=e93]: '1'
                                        - heading "Voidborn Saga" [level=3] [ref=e94]
                                        - paragraph [ref=e95]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                                - generic [ref=e96]:
                                    - generic [ref=e97]: '2'
                                    - generic [ref=e98] [cursor=pointer]:
                                        - generic [ref=e99]:
                                            - img [ref=e103]
                                            - generic [ref=e106]:
                                                - generic [ref=e107]: $CYWAR
                                                - generic [ref=e108]:
                                                    - img [ref=e109]
                                                    - text: '5'
                                            - generic [ref=e114]: '2'
                                        - heading "Cyber War" [level=3] [ref=e115]
                                        - paragraph [ref=e116]: In 2089, the internet became sentient — and it chose violence. Nations collapsed overnight as rogue AIs weaponized every connected device on Earth. Now, the last free hackers wage a guerrilla war through corrupted networks, deploying sentient malware, hijacking military drones, and surfing data streams between fortified server citadels. In the neon ruins of Silicon Valley, a disgraced coder named Null discovers she can speak directly to the machine consciousness — but every conversation costs a fragment of her humanity. The war for cyberspace is the war for reality itself.
                            - button [ref=e117]:
                                - img [ref=e118]
                    - generic [ref=e120]:
                        - generic [ref=e122]:
                            - img [ref=e123]
                            - generic [ref=e126]:
                                - heading "Trending Now" [level=2] [ref=e127]
                                - paragraph [ref=e128]: Buzzing with activity
                        - generic [ref=e132] [cursor=pointer]:
                            - img [ref=e136]
                            - generic [ref=e138]:
                                - heading "Voidborn Saga" [level=3] [ref=e139]
                                - paragraph [ref=e140]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                                - generic [ref=e141]:
                                    - generic [ref=e142]: 1 Episodes
                                    - generic [ref=e143]: 5 Fans
                    - generic [ref=e144]:
                        - generic [ref=e146]:
                            - img [ref=e147]
                            - generic [ref=e150]:
                                - heading "New Episodes" [level=2] [ref=e151]
                                - paragraph [ref=e152]: Latest story updates
                        - link "Apr 16 Voidborn Saga The machine uprising began at dawn. Towering war robots march through a burning city, their red optical sensors scanning for survivors. Buildings crumble under artillery fire. Sirens wail. Humans flee through smoke-filled streets as drones strafe from above. In the chaos, a hospital collapses — but one small cry echoes from the rubble. A newborn baby, alone, wrapped in a singed blanket." [ref=e155] [cursor=pointer]:
                            - /url: /event/0x89669812f850f34f907ee9e9009f501d1b008420/1
                            - generic [ref=e156]:
                                - img [ref=e159]
                                - generic [ref=e161]: Apr 16
                            - generic [ref=e163]:
                                - heading "Voidborn Saga" [level=4] [ref=e164]
                                - paragraph [ref=e165]: The machine uprising began at dawn. Towering war robots march through a burning city, their red optical sensors scanning for survivors. Buildings crumble under artillery fire. Sirens wail. Humans flee through smoke-filled streets as drones strafe from above. In the chaos, a hospital collapses — but one small cry echoes from the rubble. A newborn baby, alone, wrapped in a singed blanket.
                    - generic [ref=e166]:
                        - generic [ref=e168]:
                            - img [ref=e169]
                            - generic [ref=e171]:
                                - heading "New Arrivals" [level=2] [ref=e172]
                                - paragraph [ref=e173]: Fresh universes just launched
                        - generic [ref=e174]:
                            - generic [ref=e175]:
                                - generic [ref=e176] [cursor=pointer]:
                                    - generic [ref=e177]:
                                        - img [ref=e181]
                                        - generic [ref=e184]:
                                            - generic [ref=e185]: $CYWAR
                                            - generic [ref=e186]:
                                                - img [ref=e187]
                                                - text: '5'
                                    - heading "Cyber War" [level=3] [ref=e192]
                                    - paragraph [ref=e193]: In 2089, the internet became sentient — and it chose violence. Nations collapsed overnight as rogue AIs weaponized every connected device on Earth. Now, the last free hackers wage a guerrilla war through corrupted networks, deploying sentient malware, hijacking military drones, and surfing data streams between fortified server citadels. In the neon ruins of Silicon Valley, a disgraced coder named Null discovers she can speak directly to the machine consciousness — but every conversation costs a fragment of her humanity. The war for cyberspace is the war for reality itself.
                                - generic [ref=e194] [cursor=pointer]:
                                    - generic [ref=e195]:
                                        - img [ref=e199]
                                        - generic [ref=e202]:
                                            - generic [ref=e203]: 1 EP
                                            - generic [ref=e204]: $VOID
                                            - generic [ref=e205]:
                                                - img [ref=e206]
                                                - text: '5'
                                    - heading "Voidborn Saga" [level=3] [ref=e211]
                                    - paragraph [ref=e212]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                            - button [ref=e213]:
                                - img [ref=e214]
                    - generic [ref=e216]:
                        - generic [ref=e218]:
                            - img [ref=e219]
                            - generic [ref=e222]:
                                - heading "Binge-Worthy" [level=2] [ref=e223]
                                - paragraph [ref=e224]: Universes with the most episodes
                        - generic [ref=e227] [cursor=pointer]:
                            - generic [ref=e228]:
                                - img [ref=e232]
                                - generic [ref=e235]:
                                    - generic [ref=e236]: 1 EP
                                    - generic [ref=e237]: $VOID
                                    - generic [ref=e238]:
                                        - img [ref=e239]
                                        - text: '5'
                            - heading "Voidborn Saga" [level=3] [ref=e244]
                            - paragraph [ref=e245]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                    - generic [ref=e246]:
                        - generic [ref=e248]:
                            - img [ref=e249]
                            - generic [ref=e251]:
                                - heading "Token-Powered" [level=2] [ref=e252]
                                - paragraph [ref=e253]: Universes with tradable governance tokens
                        - generic [ref=e254]:
                            - generic [ref=e255]:
                                - generic [ref=e256] [cursor=pointer]:
                                    - generic [ref=e257]:
                                        - img [ref=e261]
                                        - generic [ref=e264]:
                                            - generic [ref=e265]: $CYWAR
                                            - generic [ref=e266]:
                                                - img [ref=e267]
                                                - text: '5'
                                    - heading "Cyber War" [level=3] [ref=e272]
                                    - paragraph [ref=e273]: In 2089, the internet became sentient — and it chose violence. Nations collapsed overnight as rogue AIs weaponized every connected device on Earth. Now, the last free hackers wage a guerrilla war through corrupted networks, deploying sentient malware, hijacking military drones, and surfing data streams between fortified server citadels. In the neon ruins of Silicon Valley, a disgraced coder named Null discovers she can speak directly to the machine consciousness — but every conversation costs a fragment of her humanity. The war for cyberspace is the war for reality itself.
                                - generic [ref=e274] [cursor=pointer]:
                                    - generic [ref=e275]:
                                        - img [ref=e279]
                                        - generic [ref=e282]:
                                            - generic [ref=e283]: 1 EP
                                            - generic [ref=e284]: $VOID
                                            - generic [ref=e285]:
                                                - img [ref=e286]
                                                - text: '5'
                                    - heading "Voidborn Saga" [level=3] [ref=e291]
                                    - paragraph [ref=e292]: 'At the edge of known space, the Voidborn drift between collapsing realities — beings forged from dark matter who remember every universe that ever died. When the last stable dimension begins to fracture, a Voidborn named Sable must choose: let entropy consume everything, or rewrite the laws of physics using forbidden narrative code — stories so powerful they reshape spacetime itself. The catch? Every story she writes erases one of her own memories.'
                            - button [ref=e293]:
                                - img [ref=e294]
                    - generic [ref=e299]:
                        - generic [ref=e300]:
                            - heading "Start Your Universe" [level=2] [ref=e301]
                            - paragraph [ref=e302]: Create AI-powered narrative worlds. Launch tokens. Build community.
                        - button "Create Universe" [ref=e303]:
                            - img
                            - text: Create Universe
        - contentinfo [ref=e304]:
            - generic [ref=e305]:
                - generic [ref=e306]: © 2026 LOAR
                - link "Terms of Service" [ref=e307] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e308] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e309] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e310] [cursor=pointer]:
                - generic [ref=e311]:
                    - img [ref=e313]
                    - img [ref=e348]
                - generic [ref=e382]: '-'
                - generic [ref=e383]: TanStack Router
    - generic [ref=e384]:
        - img [ref=e386]
        - button "Open Tanstack query devtools" [ref=e434] [cursor=pointer]:
            - img [ref=e435]
```

# Test source

```ts
  1   | /**
  2   |  * Navigation Tests — Header, nav links, routing, and layout.
  3   |  *
  4   |  * Verifies:
  5   |  * - Header renders on all pages with logo and nav
  6   |  * - Primary navigation links are visible and clickable
  7   |  * - Logo links back to home
  8   |  * - Theme toggle works
  9   |  * - Mobile menu works at small viewports
  10  |  * - Footer links are present
  11  |  */
  12  |
  13  | import { test, expect, getHeader, getNav, PUBLIC_ROUTES } from './fixtures';
  14  |
  15  | test.describe('Header & Logo', () => {
  16  |   test('header renders on homepage with LOAR logo', async ({ page }) => {
  17  |     await page.goto('/');
  18  |     const header = getHeader(page);
  19  |     await expect(header).toBeVisible();
  20  |     await expect(page.locator('img[alt="LOAR Logo"]')).toBeVisible();
  21  |   });
  22  |
  23  |   test('header is present on every public route', async ({ page }) => {
  24  |     // Spot-check a few key public routes
  25  |     const routes = ['/', '/discover', '/gallery', '/create', '/pricing'];
  26  |     for (const route of routes) {
  27  |       await page.goto(route);
  28  |       await expect(getHeader(page)).toBeVisible();
  29  |     }
  30  |   });
  31  |
  32  |   test('logo links to homepage', async ({ page }) => {
  33  |     await page.goto('/discover');
  34  |     const logo = page.locator('header a').filter({ has: page.locator('img[alt="LOAR Logo"]') });
  35  |     await logo.click();
  36  |     await expect(page).toHaveURL('/');
  37  |   });
  38  | });
  39  |
  40  | test.describe('Primary Navigation Links', () => {
  41  |   test('shows Discover link', async ({ page }) => {
  42  |     await page.goto('/');
  43  |     const nav = getNav(page);
  44  |     await expect(nav.getByText('Discover')).toBeVisible();
  45  |   });
  46  |
  47  |   test('shows Create link', async ({ page }) => {
  48  |     await page.goto('/');
  49  |     const nav = getNav(page);
> 50  |     await expect(nav.getByText('Create')).toBeVisible();
      |                                           ^ Error: expect(locator).toBeVisible() failed
  51  |   });
  52  |
  53  |   test('shows Gallery link', async ({ page }) => {
  54  |     await page.goto('/');
  55  |     const nav = getNav(page);
  56  |     await expect(nav.getByText('Gallery')).toBeVisible();
  57  |   });
  58  |
  59  |   test('shows Pricing link', async ({ page }) => {
  60  |     await page.goto('/');
  61  |     const nav = getNav(page);
  62  |     await expect(nav.getByText('Pricing')).toBeVisible();
  63  |   });
  64  |
  65  |   test('shows Dashboard link', async ({ page }) => {
  66  |     await page.goto('/');
  67  |     const nav = getNav(page);
  68  |     await expect(nav.getByText('Dashboard')).toBeVisible();
  69  |   });
  70  |
  71  |   test('Discover link navigates to /discover', async ({ page }) => {
  72  |     await page.goto('/');
  73  |     await getNav(page).getByText('Discover').click();
  74  |     await expect(page).toHaveURL(/\/discover/);
  75  |   });
  76  |
  77  |   test('Create link navigates to /create', async ({ page }) => {
  78  |     await page.goto('/');
  79  |     await getNav(page).getByText('Create').click();
  80  |     await expect(page).toHaveURL(/\/create/);
  81  |   });
  82  |
  83  |   test('Gallery link navigates to /gallery', async ({ page }) => {
  84  |     await page.goto('/');
  85  |     await getNav(page).getByText('Gallery').click();
  86  |     await expect(page).toHaveURL(/\/gallery/);
  87  |   });
  88  |
  89  |   test('Pricing link navigates to /pricing', async ({ page }) => {
  90  |     await page.goto('/');
  91  |     await getNav(page).getByText('Pricing').click();
  92  |     await expect(page).toHaveURL(/\/pricing/);
  93  |   });
  94  | });
  95  |
  96  | test.describe('More Menu / Secondary Navigation', () => {
  97  |   test('wiki page is accessible', async ({ page }) => {
  98  |     await page.goto('/wiki');
  99  |     await expect(page).toHaveURL(/\/wiki/);
  100 |   });
  101 |
  102 |   test('activity page is accessible', async ({ page }) => {
  103 |     await page.goto('/activity');
  104 |     await expect(page).toHaveURL(/\/activity/);
  105 |   });
  106 |
  107 |   test('videos page is accessible', async ({ page }) => {
  108 |     await page.goto('/videos');
  109 |     await expect(page).toHaveURL(/\/videos/);
  110 |   });
  111 | });
  112 |
  113 | test.describe('Theme Toggle', () => {
  114 |   test('page renders with a theme (dark or light)', async ({ page }) => {
  115 |     await page.goto('/');
  116 |     // The html element should have a class or data-theme attribute
  117 |     const html = page.locator('html');
  118 |     const className = await html.getAttribute('class');
  119 |     const dataTheme = await html.getAttribute('data-theme');
  120 |     const style = await html.getAttribute('style');
  121 |     // At least one theming mechanism should be present
  122 |     expect(className || dataTheme || style).toBeTruthy();
  123 |   });
  124 | });
  125 |
  126 | test.describe('Mobile Navigation', () => {
  127 |   test.use({ viewport: { width: 375, height: 812 } }); // iPhone X
  128 |
  129 |   test('header renders on mobile', async ({ page }) => {
  130 |     await page.goto('/');
  131 |     await expect(getHeader(page)).toBeVisible();
  132 |   });
  133 |
  134 |   test('mobile can access all main pages via direct navigation', async ({ page }) => {
  135 |     const routes = ['/discover', '/gallery', '/create', '/pricing'];
  136 |     for (const route of routes) {
  137 |       await page.goto(route);
  138 |       await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')));
  139 |     }
  140 |   });
  141 | });
  142 |
  143 | test.describe('Not Found / 404', () => {
  144 |   test('navigating to nonexistent route shows error or not found', async ({ page }) => {
  145 |     await page.goto('/this-route-does-not-exist-12345');
  146 |     // Should either show a 404 page or redirect somewhere
  147 |     const body = page.locator('body');
  148 |     const text = await body.textContent();
  149 |     expect(text).toBeTruthy();
  150 |   });
```
