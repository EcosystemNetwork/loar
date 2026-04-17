# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Login Page >> shows LOAR logo on login page
- Location: e2e/auth.spec.ts:23:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('img[src*="loarlogo"]')
Expected: visible
Error: strict mode violation: locator('img[src*="loarlogo"]') resolved to 2 elements:
    1) <img alt="LOAR Logo" src="/loarlogo.svg" class="h-9 w-auto object-contain"/> aka getByRole('link', { name: 'LOAR Logo' })
    2) <img alt="LOAR" src="/loarlogo.svg" class="h-16 w-auto mx-auto"/> aka getByRole('img', { name: 'LOAR', exact: true })

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('img[src*="loarlogo"]')

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
  1  | /**
  2  |  * Auth Flow Tests — Wallet connection, session guards, and redirects.
  3  |  *
  4  |  * Verifies:
  5  |  * - Login page renders wallet connect UI
  6  |  * - Protected routes redirect unauthenticated users to /login
  7  |  * - Redirect param preserves intended destination
  8  |  * - Authenticated users can access protected routes
  9  |  * - Authenticated users visiting /login are redirected to dashboard
  10 |  */
  11 |
  12 | import { test, expect, PROTECTED_ROUTES, injectMockSession, clearMockSession } from './fixtures';
  13 |
  14 | test.describe('Login Page', () => {
  15 |   test('renders wallet connection UI', async ({ page }) => {
  16 |     await page.goto('/login');
  17 |     await expect(page).toHaveURL(/\/login/);
  18 |     await expect(page.locator('body')).toContainText(/welcome to loar/i);
  19 |     await expect(page.locator('body')).toContainText(/connect your ethereum wallet/i);
  20 |     await expect(page.locator('body')).toContainText(/sign in/i);
  21 |   });
  22 |
  23 |   test('shows LOAR logo on login page', async ({ page }) => {
  24 |     await page.goto('/login');
  25 |     // Login page renders the LOAR logo SVG
> 26 |     await expect(page.locator('img[src*="loarlogo"]')).toBeVisible();
     |                                                        ^ Error: expect(locator).toBeVisible() failed
  27 |   });
  28 |
  29 |   test('shows "Powered by thirdweb" attribution', async ({ page }) => {
  30 |     await page.goto('/login');
  31 |     await expect(page.locator('body')).toContainText(/powered by thirdweb/i);
  32 |   });
  33 | });
  34 |
  35 | test.describe('Auth Guards — Unauthenticated Redirects', () => {
  36 |   for (const route of PROTECTED_ROUTES) {
  37 |     test(`${route} redirects to /login when unauthenticated`, async ({ page }) => {
  38 |       await page.goto(route);
  39 |       await expect(page).toHaveURL(/\/login/);
  40 |     });
  41 |   }
  42 |
  43 |   test('redirect param preserves intended destination for /dashboard', async ({ page }) => {
  44 |     await page.goto('/dashboard');
  45 |     await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard|\/login\?redirect=\/dashboard/);
  46 |   });
  47 |
  48 |   test('redirect param preserves intended destination for /upload', async ({ page }) => {
  49 |     await page.goto('/upload');
  50 |     await expect(page).toHaveURL(/\/login\?redirect=%2Fupload|\/login\?redirect=\/upload/);
  51 |   });
  52 |
  53 |   test('redirect param preserves intended destination for /profile/edit', async ({ page }) => {
  54 |     await page.goto('/profile/edit');
  55 |     await expect(page).toHaveURL(
  56 |       /\/login\?redirect=%2Fprofile%2Fedit|\/login\?redirect=\/profile\/edit/,
  57 |     );
  58 |   });
  59 | });
  60 |
  61 | test.describe('Auth Guards — Authenticated Access', () => {
  62 |   test('authenticated user can access /dashboard', async ({ authedPage: page }) => {
  63 |     await page.goto('/dashboard');
  64 |     // Should NOT redirect to login
  65 |     await page.waitForTimeout(1000);
  66 |     // Either stays on dashboard or shows dashboard content
  67 |     const url = page.url();
  68 |     // Accept either staying on dashboard or being on dashboard
  69 |     expect(url).toMatch(/\/dashboard|\/login/);
  70 |   });
  71 |
  72 |   test('authenticated user accessing /login redirects away', async ({ authedPage: page }) => {
  73 |     await page.goto('/login');
  74 |     await page.waitForTimeout(1500);
  75 |     // Authenticated users should be redirected from login
  76 |     // They may go to /dashboard or stay on /login if session validation fails
  77 |     // (in test env without real SIWE, session may not validate)
  78 |     const url = page.url();
  79 |     expect(url).toBeDefined();
  80 |   });
  81 | });
  82 |
  83 | test.describe('Session Lifecycle', () => {
  84 |   test('clearing session makes protected routes redirect again', async ({ page }) => {
  85 |     // Start with a session
  86 |     await injectMockSession(page);
  87 |     // Clear the session
  88 |     await clearMockSession(page);
  89 |     // Now try a protected route
  90 |     await page.goto('/dashboard');
  91 |     await expect(page).toHaveURL(/\/login/);
  92 |   });
  93 | });
  94 |
```
