import { defineConfig, devices } from '@playwright/test';

/**
 * Real-stack E2E: no route interception, no mocked tRPC. Runs against an
 * ALREADY RUNNING local stack (`make dev-local`): web :3001, server :3000,
 * Firestore emulator :8080. Uses the system Chromium so no browser download
 * is needed (override with E2E_CHROMIUM_PATH).
 */
export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.E2E_CHROMIUM_PATH ?? '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
