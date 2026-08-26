import { defineConfig } from 'vitest/config';
import path from 'path';

// Unit tests only (pure logic, hooks helpers) — separate from the Playwright
// suite in e2e/, which drives the actual running app. Keep this config
// scoped to src/ so it never picks up e2e/*.spec.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
