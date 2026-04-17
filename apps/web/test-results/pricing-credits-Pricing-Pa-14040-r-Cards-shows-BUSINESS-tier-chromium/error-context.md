# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pricing-credits.spec.ts >> Pricing Page — Tier Cards >> shows BUSINESS tier
- Location: e2e/pricing-credits.spec.ts:83:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/business/i).first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/business/i).first()

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
                    - heading "PICK YOUR PLAN" [level=1] [ref=e37]
                    - paragraph [ref=e38]:
                        - text: Create AI-powered cinematic universes with monthly credits.
                        - text: Upgrade anytime. Cancel anytime.
                    - generic [ref=e39]:
                        - button "Monthly" [ref=e40]
                        - button "Annual SAVE 20%" [ref=e41]:
                            - text: Annual
                            - generic [ref=e42]: SAVE 20%
                - generic [ref=e43]: Failed to load data. Please try again.
                - paragraph [ref=e45]:
                    - text: Need more credits? You can always
                    - button "buy credit top-ups" [ref=e46]
                    - text: alongside your subscription.
        - contentinfo [ref=e47]:
            - generic [ref=e48]:
                - generic [ref=e49]: © 2026 LOAR
                - link "Terms of Service" [ref=e50] [cursor=pointer]:
                    - /url: /terms
                - link "Privacy Policy" [ref=e51] [cursor=pointer]:
                    - /url: /privacy
                - link "DMCA" [ref=e52] [cursor=pointer]:
                    - /url: /dmca
    - region "Notifications alt+T"
    - generic:
        - contentinfo:
            - button "Open TanStack Router Devtools" [ref=e53] [cursor=pointer]:
                - generic [ref=e54]:
                    - img [ref=e56]
                    - img [ref=e91]
                - generic [ref=e125]: '-'
                - generic [ref=e126]: TanStack Router
    - generic [ref=e127]:
        - img [ref=e129]
        - button "Open Tanstack query devtools" [ref=e177] [cursor=pointer]:
            - img [ref=e178]
```

# Test source

```ts
  1   | /**
  2   |  * Pricing & Credits Tests — Subscription plans, credit packages, balances.
  3   |  *
  4   |  * Verifies:
  5   |  * - Pricing page loads with heading
  6   |  * - Shows billing toggle (Monthly / Annual)
  7   |  * - Shows tier cards (Starter, Plus, Ultra, Business)
  8   |  * - Each tier shows price and features
  9   |  * - Annual toggle shows savings badge
  10  |  * - Credits page loads
  11  |  * - Credits page shows balance card
  12  |  * - Credits page shows transaction history section
  13  |  * - Credits page shows generation cost reference
  14  |  */
  15  |
  16  | import { test, expect } from './fixtures';
  17  |
  18  | test.describe('Pricing Page — Load & Layout', () => {
  19  |   test('pricing page loads', async ({ page }) => {
  20  |     await page.goto('/pricing');
  21  |     await expect(page).toHaveURL(/\/pricing/);
  22  |   });
  23  |
  24  |   test('shows "PICK YOUR PLAN" heading', async ({ page }) => {
  25  |     await page.goto('/pricing');
  26  |     await expect(page.locator('body')).toContainText(/pick your plan/i);
  27  |   });
  28  |
  29  |   test('shows plan description', async ({ page }) => {
  30  |     await page.goto('/pricing');
  31  |     await expect(page.locator('body')).toContainText(/ai-powered|credit|upgrade/i);
  32  |   });
  33  |
  34  |   test('has header', async ({ page }) => {
  35  |     await page.goto('/pricing');
  36  |     await expect(page.locator('header')).toBeVisible();
  37  |   });
  38  | });
  39  |
  40  | test.describe('Pricing Page — Billing Toggle', () => {
  41  |   test('Monthly button is visible', async ({ page }) => {
  42  |     await page.goto('/pricing');
  43  |     await expect(page.getByRole('button', { name: /monthly/i }).first()).toBeVisible();
  44  |   });
  45  |
  46  |   test('Annual button is visible', async ({ page }) => {
  47  |     await page.goto('/pricing');
  48  |     await expect(page.getByRole('button', { name: /annual/i }).first()).toBeVisible();
  49  |   });
  50  |
  51  |   test('Annual button shows SAVE 20% badge', async ({ page }) => {
  52  |     await page.goto('/pricing');
  53  |     await expect(page.locator('body')).toContainText(/save 20%/i);
  54  |   });
  55  |
  56  |   test('clicking Annual toggle switches pricing', async ({ page }) => {
  57  |     await page.goto('/pricing');
  58  |     const annualBtn = page.getByRole('button', { name: /annual/i }).first();
  59  |     await annualBtn.click();
  60  |     await page.waitForTimeout(300);
  61  |     // Annual pricing should now be displayed (different values)
  62  |     const body = await page.locator('body').textContent();
  63  |     expect(body?.toLowerCase()).toMatch(/\/month|\/year/i);
  64  |   });
  65  | });
  66  |
  67  | test.describe('Pricing Page — Tier Cards', () => {
  68  |   test('shows STARTER tier', async ({ page }) => {
  69  |     await page.goto('/pricing');
  70  |     await expect(page.getByText(/starter/i).first()).toBeVisible();
  71  |   });
  72  |
  73  |   test('shows PLUS tier', async ({ page }) => {
  74  |     await page.goto('/pricing');
  75  |     await expect(page.getByText(/plus/i).first()).toBeVisible();
  76  |   });
  77  |
  78  |   test('shows ULTRA tier', async ({ page }) => {
  79  |     await page.goto('/pricing');
  80  |     await expect(page.getByText(/ultra/i).first()).toBeVisible();
  81  |   });
  82  |
  83  |   test('shows BUSINESS tier', async ({ page }) => {
  84  |     await page.goto('/pricing');
> 85  |     await expect(page.getByText(/business/i).first()).toBeVisible();
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  86  |   });
  87  |
  88  |   test('shows "Most Popular" badge on one tier', async ({ page }) => {
  89  |     await page.goto('/pricing');
  90  |     await expect(page.getByText(/most popular/i).first()).toBeVisible();
  91  |   });
  92  |
  93  |   test('each tier shows price', async ({ page }) => {
  94  |     await page.goto('/pricing');
  95  |     // Should have dollar amounts visible
  96  |     await expect(page.getByText(/\$\d+/).first()).toBeVisible();
  97  |   });
  98  |
  99  |   test('tier cards have CTA buttons', async ({ page }) => {
  100 |     await page.goto('/pricing');
  101 |     // Should have "Pay with $LOAR" or "Current Plan" buttons
  102 |     const body = await page.locator('body').textContent();
  103 |     expect(body?.toLowerCase()).toMatch(/pay with.*loar|current plan|subscribe|get started/i);
  104 |   });
  105 |
  106 |   test('tier cards show feature lists', async ({ page }) => {
  107 |     await page.goto('/pricing');
  108 |     // Tiers should list features (check marks)
  109 |     const body = await page.locator('body').textContent();
  110 |     expect(body?.toLowerCase()).toMatch(/credit|generation|support|priority/i);
  111 |   });
  112 | });
  113 |
  114 | test.describe('Credits Page — Load & Layout', () => {
  115 |   test('credits page loads', async ({ page }) => {
  116 |     await page.goto('/credits');
  117 |     await expect(page).toHaveURL(/\/credits/);
  118 |   });
  119 |
  120 |   test('shows Credits heading', async ({ page }) => {
  121 |     await page.goto('/credits');
  122 |     await expect(page.locator('body')).toContainText(/credit/i);
  123 |   });
  124 |
  125 |   test('has header', async ({ page }) => {
  126 |     await page.goto('/credits');
  127 |     await expect(page.locator('header')).toBeVisible();
  128 |   });
  129 | });
  130 |
  131 | test.describe('Credits Page — Balance Card', () => {
  132 |   test('shows Available Credits label', async ({ page }) => {
  133 |     await page.goto('/credits');
  134 |     await page.waitForTimeout(1000);
  135 |     const body = await page.locator('body').textContent();
  136 |     expect(body?.toLowerCase()).toMatch(/available credit|credit|balance/i);
  137 |   });
  138 | });
  139 |
  140 | test.describe('Credits Page — Generation Costs', () => {
  141 |   test('shows generation cost reference', async ({ page }) => {
  142 |     await page.goto('/credits');
  143 |     await page.waitForTimeout(1000);
  144 |     const body = await page.locator('body').textContent();
  145 |     // Should show costs like "image_generation 10 cr"
  146 |     expect(body?.toLowerCase()).toMatch(/generation|cr\b|cost|image|video/i);
  147 |   });
  148 | });
  149 |
  150 | test.describe('Credits Page — Transaction History', () => {
  151 |   test('shows transaction history section', async ({ page }) => {
  152 |     await page.goto('/credits');
  153 |     await page.waitForTimeout(1000);
  154 |     const body = await page.locator('body').textContent();
  155 |     expect(body?.toLowerCase()).toMatch(/transaction|history|no transaction/i);
  156 |   });
  157 | });
  158 |
  159 | test.describe('Credits Page — Buy Credits', () => {
  160 |   test('Buy Credits button or store exists', async ({ page }) => {
  161 |     await page.goto('/credits');
  162 |     await page.waitForTimeout(1000);
  163 |     const body = await page.locator('body').textContent();
  164 |     expect(body?.toLowerCase()).toMatch(/buy credit|top.?up|credit store/i);
  165 |   });
  166 | });
  167 |
```
