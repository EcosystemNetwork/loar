import { defineConfig } from 'vitest/config';
import path from 'path';

// Two test projects, split by extension:
//   *.test.ts   → node env, pure logic (the original suite, unchanged)
//   *.test.tsx  → jsdom env + @testing-library/react (component tests)
// Kept scoped to src/ so it never picks up the Playwright suite in e2e/.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          globals: true,
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
          testTimeout: 10_000,
        },
      },
    ],
  },
});
