# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gallery.spec.ts >> Gallery Content Display >> search input is present
- Location: e2e/gallery.spec.ts:112:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByPlaceholder(/search/i).first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByPlaceholder(/search/i).first()

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
                - generic [ref=e35]:
                    - img [ref=e36]
                    - heading "Gallery" [level=1] [ref=e38]
                    - generic [ref=e39]: Discover content across all universes
                - generic [ref=e40]:
                    - generic [ref=e41]:
                        - generic [ref=e42]:
                            - button "All" [ref=e43]
                            - button "Video" [ref=e44]
                            - button "Image" [ref=e45]
                            - button "Audio" [ref=e46]
                            - button "3D" [ref=e47]
                        - generic [ref=e48]:
                            - img [ref=e49]
                            - button "Newest" [ref=e50]
                            - button "Trending" [ref=e51]
                            - 'button "Price: Low" [ref=e52]'
                            - 'button "Price: High" [ref=e53]'
                    - generic [ref=e54]:
                        - button "All Origins" [ref=e55]
                        - button "AI Generated" [ref=e56]
                        - button "Uploaded" [ref=e57]
                - generic [ref=e58]: No content yet. Be the first to create something!
        - contentinfo [ref=e59]:
            - generic [ref=e60]:
                - generic [ref=e61]: © 2026 LOAR
                - link "Terms of Service" [ref=e62] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e63] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e64] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e65] [cursor=pointer]:
                - generic [ref=e66]:
                    - img [ref=e68]
                    - img [ref=e103]
                - generic [ref=e137]: '-'
                - generic [ref=e138]: TanStack Router
    - generic [ref=e139]:
        - img [ref=e141]
        - button "Open Tanstack query devtools" [ref=e189] [cursor=pointer]:
            - img [ref=e190]
```

# Test source

```ts
  15  |
  16  | import { test, expect } from './fixtures';
  17  |
  18  | test.describe('Gallery Page — Load & Layout', () => {
  19  |   test('gallery page loads with title', async ({ page }) => {
  20  |     await page.goto('/gallery');
  21  |     await expect(page).toHaveURL(/\/gallery/);
  22  |     await expect(page.locator('body')).toContainText(/gallery/i);
  23  |   });
  24  |
  25  |   test('gallery page has header', async ({ page }) => {
  26  |     await page.goto('/gallery');
  27  |     await expect(page.locator('header')).toBeVisible();
  28  |   });
  29  |
  30  |   test('shows "Discover content across all universes" subtitle', async ({ page }) => {
  31  |     await page.goto('/gallery');
  32  |     await expect(page.locator('body')).toContainText(/discover content/i);
  33  |   });
  34  | });
  35  |
  36  | test.describe('Gallery Filters', () => {
  37  |   test('media type filter buttons are visible', async ({ page }) => {
  38  |     await page.goto('/gallery');
  39  |     const body = page.locator('body');
  40  |     // At minimum, "All" should always be present as a filter
  41  |     await expect(body.getByRole('button', { name: 'All' }).first()).toBeVisible();
  42  |   });
  43  |
  44  |   test('media type options include Video and Image', async ({ page }) => {
  45  |     await page.goto('/gallery');
  46  |     const body = page.locator('body');
  47  |     await expect(body.getByRole('button', { name: 'Video' }).first()).toBeVisible();
  48  |     await expect(body.getByRole('button', { name: 'Image' }).first()).toBeVisible();
  49  |   });
  50  |
  51  |   test('sort options are available', async ({ page }) => {
  52  |     await page.goto('/gallery');
  53  |     const body = page.locator('body');
  54  |     // Sort buttons or dropdown
  55  |     await expect(
  56  |       body
  57  |         .getByRole('button', { name: /newest/i })
  58  |         .first()
  59  |         .or(body.getByText(/newest/i).first())
  60  |     ).toBeVisible();
  61  |   });
  62  |
  63  |   test('origin filter has All Origins option', async ({ page }) => {
  64  |     await page.goto('/gallery');
  65  |     await expect(
  66  |       page
  67  |         .getByRole('button', { name: /all origins/i })
  68  |         .first()
  69  |         .or(page.getByText(/all origins/i).first())
  70  |     ).toBeVisible();
  71  |   });
  72  |
  73  |   test('clicking Video filter updates active state', async ({ page }) => {
  74  |     await page.goto('/gallery');
  75  |     const videoBtn = page.getByRole('button', { name: 'Video' }).first();
  76  |     await videoBtn.click();
  77  |     // Button should have active/selected styling — check it's still visible after click
  78  |     await expect(videoBtn).toBeVisible();
  79  |   });
  80  |
  81  |   test('clicking Image filter updates active state', async ({ page }) => {
  82  |     await page.goto('/gallery');
  83  |     const imageBtn = page.getByRole('button', { name: 'Image' }).first();
  84  |     await imageBtn.click();
  85  |     await expect(imageBtn).toBeVisible();
  86  |   });
  87  | });
  88  |
  89  | test.describe('Gallery Trending Section', () => {
  90  |   test('trending section renders', async ({ page }) => {
  91  |     await page.goto('/gallery');
  92  |     // Trending section with icon or text
  93  |     await expect(
  94  |       page
  95  |         .getByText(/trending/i)
  96  |         .first()
  97  |         .or(page.locator('body'))
  98  |     ).toBeVisible();
  99  |   });
  100 | });
  101 |
  102 | test.describe('Gallery Content Display', () => {
  103 |   test('shows empty state or content cards', async ({ page }) => {
  104 |     await page.goto('/gallery');
  105 |     await page.waitForTimeout(2000);
  106 |
  107 |     // Either content cards or empty state message
  108 |     const hasCards = await page.locator('[class*="card"], [class*="Card"]').count();
  109 |     const hasEmptyState = await page.getByText(/no content yet/i).count();
  110 |
  111 |     // One of these should be true
  112 |     expect(hasCards > 0 || hasEmptyState > 0).toBeTruthy();
  113 |   });
  114 |
> 115 |   test('search input is present', async ({ page }) => {
      |                               ^ Error: expect(locator).toBeVisible() failed
  116 |     await page.goto('/gallery');
  117 |     const searchInput = page.getByPlaceholder(/search/i).first();
  118 |     await expect(searchInput).toBeVisible();
  119 |   });
  120 |
  121 |   test('search input accepts text', async ({ page }) => {
  122 |     await page.goto('/gallery');
  123 |     const searchInput = page.getByPlaceholder(/search/i).first();
  124 |     await searchInput.fill('test query');
  125 |     await expect(searchInput).toHaveValue('test query');
  126 |   });
  127 | });
  128 |
  129 | test.describe('Gallery — Universe-Scoped', () => {
  130 |   test('universe gallery route loads', async ({ page }) => {
  131 |     // Try navigating to a universe gallery (may show empty/error without real data)
  132 |     await page.goto('/universe/test-id/gallery');
  133 |     // Should not crash — either shows content or fallback
  134 |     await expect(page.locator('body')).toBeVisible();
  135 |   });
  136 | });
  137 |
```
