import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 10_000,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
});
