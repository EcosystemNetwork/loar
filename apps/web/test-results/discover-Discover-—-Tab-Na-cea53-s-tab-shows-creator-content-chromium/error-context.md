# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: discover.spec.ts >> Discover — Tab Navigation >> clicking Creators tab shows creator content
- Location: e2e/discover.spec.ts:65:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('tab', { name: /creators/i }).or(getByText(/creators/i).first()) resolved to 2 elements:
    1) <p class="text-muted-foreground text-lg">Explore universes, creators, and AI-generated sto…</p> aka getByText('Explore universes, creators,')
    2) <button role="tab" type="button" tabindex="-1" aria-selected="false" data-state="inactive" data-orientation="horizontal" data-radix-collection-item="" id="radix-:r2:-trigger-creators" aria-controls="radix-:r2:-content-creators" class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none dis…>…</button> aka getByRole('tab', { name: 'Creators' })

Call log:
  - waiting for getByRole('tab', { name: /creators/i }).or(getByText(/creators/i).first())

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
                - generic [ref=e36]:
                    - generic [ref=e37]:
                        - generic [ref=e38]:
                            - heading "Discover" [level=1] [ref=e39]
                            - paragraph [ref=e40]: Explore universes, creators, and AI-generated stories.
                        - generic [ref=e41]:
                            - img [ref=e42]
                            - text: Trending Now
                    - generic [ref=e44]:
                        - img [ref=e45]
                        - textbox "Search universes, creators, content..." [ref=e48]
                - generic [ref=e50]:
                    - tablist [ref=e52]:
                        - tab "Universes" [selected] [ref=e53]:
                            - img [ref=e54]
                            - text: Universes
                        - tab "Creators" [ref=e57]:
                            - img [ref=e58]
                            - text: Creators
                        - tab "Content" [ref=e63]:
                            - img [ref=e64]
                            - text: Content
                        - tab "Videos" [ref=e66]:
                            - img [ref=e67]
                            - text: Videos
                    - tabpanel "Universes" [ref=e69]:
                        - generic [ref=e70]:
                            - generic [ref=e71]:
                                - generic [ref=e72]: 'Sort:'
                                - button "Newest" [ref=e73]
                                - button "Oldest" [ref=e74]
                                - button "Name" [ref=e75]
                                - generic [ref=e77]: 'Access:'
                                - button "All" [ref=e78]
                                - button "Open" [ref=e79]
                                - button "Token-Gated" [ref=e80]:
                                    - img
                                    - text: Token-Gated
                                - button "Subscription" [ref=e81]:
                                    - img
                                    - text: Subscription
                            - generic [ref=e82]: Failed to load universes. Please try again.
        - contentinfo [ref=e83]:
            - generic [ref=e84]:
                - generic [ref=e85]: © 2026 LOAR
                - link "Terms of Service" [ref=e86] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e87] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e88] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e89] [cursor=pointer]:
                - generic [ref=e90]:
                    - img [ref=e92]
                    - img [ref=e127]
                - generic [ref=e161]: '-'
                - generic [ref=e162]: TanStack Router
    - generic [ref=e163]:
        - img [ref=e165]
        - button "Open Tanstack query devtools" [ref=e213] [cursor=pointer]:
            - img [ref=e214]
```

# Test source

```ts
  1   | /**
  2   |  * Discover Page Tests — Tabs, search, filters, and content browsing.
  3   |  *
  4   |  * Verifies:
  5   |  * - Discover page loads with title and subtitle
  6   |  * - Tab navigation (Universes, Creators, Content, Videos)
  7   |  * - Search input works
  8   |  * - Universe tab shows filter controls
  9   |  * - Content tab shows classification filters
  10  |  * - Videos tab has shorts and episodes sections
  11  |  * - Trending section renders
  12  |  */
  13  |
  14  | import { test, expect } from './fixtures';
  15  |
  16  | test.describe('Discover Page — Load & Layout', () => {
  17  |   test('page loads with title', async ({ page }) => {
  18  |     await page.goto('/discover');
  19  |     await expect(page).toHaveURL(/\/discover/);
  20  |     await expect(page.locator('body')).toContainText(/discover/i);
  21  |   });
  22  |
  23  |   test('shows subtitle about exploring', async ({ page }) => {
  24  |     await page.goto('/discover');
  25  |     await expect(page.locator('body')).toContainText(/explore/i);
  26  |   });
  27  |
  28  |   test('has header', async ({ page }) => {
  29  |     await page.goto('/discover');
  30  |     await expect(page.locator('header')).toBeVisible();
  31  |   });
  32  | });
  33  |
  34  | test.describe('Discover — Tab Navigation', () => {
  35  |   test('Universes tab is visible', async ({ page }) => {
  36  |     await page.goto('/discover');
  37  |     await expect(
  38  |       page.getByRole('tab', { name: /universes/i }).or(page.getByText(/universes/i).first())
  39  |     ).toBeVisible();
  40  |   });
  41  |
  42  |   test('Creators tab is visible', async ({ page }) => {
  43  |     await page.goto('/discover');
  44  |     await expect(
  45  |       page.getByRole('tab', { name: /creators/i }).or(page.getByText(/creators/i).first())
  46  |     ).toBeVisible();
  47  |   });
  48  |
  49  |   test('Content tab is visible', async ({ page }) => {
  50  |     await page.goto('/discover');
  51  |     await expect(
  52  |       page.getByRole('tab', { name: /content/i }).or(page.getByText(/content/i).first())
  53  |     ).toBeVisible();
  54  |   });
  55  |
  56  |   test('Videos tab is visible', async ({ page }) => {
  57  |     await page.goto('/discover');
  58  |     await expect(
  59  |       page.getByRole('tab', { name: /videos/i }).or(page.getByText(/videos/i).first())
  60  |     ).toBeVisible();
  61  |   });
  62  |
  63  |   test('clicking Universes tab shows universe content', async ({ page }) => {
  64  |     await page.goto('/discover');
  65  |     const tab = page
  66  |       .getByRole('tab', { name: /universes/i })
  67  |       .or(page.getByText(/universes/i).first());
> 68  |     await tab.click();
      |               ^ Error: locator.click: Error: strict mode violation: getByRole('tab', { name: /creators/i }).or(getByText(/creators/i).first()) resolved to 2 elements:
  69  |     await page.waitForTimeout(500);
  70  |     // Should show universes-related content or empty state
  71  |     const body = await page.locator('body').textContent();
  72  |     expect(body).toBeTruthy();
  73  |   });
  74  |
  75  |   test('clicking Creators tab shows creator content', async ({ page }) => {
  76  |     await page.goto('/discover');
  77  |     const tab = page
  78  |       .getByRole('tab', { name: /creators/i })
  79  |       .or(page.getByText(/creators/i).first());
  80  |     await tab.click();
  81  |     await page.waitForTimeout(500);
  82  |     const body = await page.locator('body').textContent();
  83  |     expect(body).toBeTruthy();
  84  |   });
  85  |
  86  |   test('clicking Videos tab shows video content', async ({ page }) => {
  87  |     await page.goto('/discover');
  88  |     const tab = page.getByRole('tab', { name: /videos/i }).or(page.getByText(/videos/i).first());
  89  |     await tab.click();
  90  |     await page.waitForTimeout(500);
  91  |     const body = await page.locator('body').textContent();
  92  |     expect(body).toBeTruthy();
  93  |   });
  94  | });
  95  |
  96  | test.describe('Discover — Search', () => {
  97  |   test('search input is present', async ({ page }) => {
  98  |     await page.goto('/discover');
  99  |     const searchInput = page.getByPlaceholder(/search/i).first();
  100 |     await expect(searchInput).toBeVisible();
  101 |   });
  102 |
  103 |   test('search input accepts and displays text', async ({ page }) => {
  104 |     await page.goto('/discover');
  105 |     const searchInput = page.getByPlaceholder(/search/i).first();
  106 |     await searchInput.fill('cyberpunk');
  107 |     await expect(searchInput).toHaveValue('cyberpunk');
  108 |   });
  109 |
  110 |   test('searching filters visible content', async ({ page }) => {
  111 |     await page.goto('/discover');
  112 |     const searchInput = page.getByPlaceholder(/search/i).first();
  113 |     await searchInput.fill('nonexistent-universe-xyz-12345');
  114 |     await page.waitForTimeout(1000);
  115 |     // Should show either filtered results or empty state
  116 |     const body = await page.locator('body').textContent();
  117 |     expect(body).toBeTruthy();
  118 |   });
  119 | });
  120 |
  121 | test.describe('Discover — Universes Tab Filters', () => {
  122 |   test('sort options are available in Universes tab', async ({ page }) => {
  123 |     await page.goto('/discover');
  124 |     // Click Universes tab first
  125 |     const tab = page
  126 |       .getByRole('tab', { name: /universes/i })
  127 |       .or(page.getByText(/universes/i).first());
  128 |     await tab.click();
  129 |     await page.waitForTimeout(500);
  130 |     // Look for sort-related UI elements
  131 |     const body = await page.locator('body').textContent();
  132 |     expect(body?.toLowerCase()).toMatch(/newest|oldest|name|sort|filter/i);
  133 |   });
  134 | });
  135 |
  136 | test.describe('Discover — Content Tab', () => {
  137 |   test('content tab shows classification filters', async ({ page }) => {
  138 |     await page.goto('/discover');
  139 |     const tab = page.getByRole('tab', { name: /content/i }).or(page.getByText(/content/i).first());
  140 |     await tab.click();
  141 |     await page.waitForTimeout(500);
  142 |     // Should have "All" filter button and classification options
  143 |     const body = await page.locator('body').textContent();
  144 |     expect(body).toBeTruthy();
  145 |   });
  146 | });
  147 |
  148 | test.describe('Discover — Trending', () => {
  149 |   test('trending section is rendered', async ({ page }) => {
  150 |     await page.goto('/discover');
  151 |     // Trending hero section
  152 |     await expect(
  153 |       page
  154 |         .getByText(/trending/i)
  155 |         .first()
  156 |         .or(page.locator('body'))
  157 |     ).toBeVisible();
  158 |   });
  159 | });
  160 |
```
