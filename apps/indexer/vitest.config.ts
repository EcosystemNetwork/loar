import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      'ponder:registry': path.resolve(__dirname, 'src/__tests__/mocks/ponder-registry.ts'),
      'ponder:schema': path.resolve(__dirname, 'src/__tests__/mocks/ponder-schema.ts'),
      'ponder:api': path.resolve(__dirname, 'src/__tests__/mocks/ponder-api.ts'),
      ponder: path.resolve(__dirname, 'src/__tests__/mocks/ponder-pkg.ts'),
    },
  },
});
