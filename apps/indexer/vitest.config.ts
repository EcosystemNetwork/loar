import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      'ponder:registry': path.resolve(__dirname, 'test/mocks/ponder-registry.ts'),
      'ponder:schema': path.resolve(__dirname, 'test/mocks/ponder-schema.ts'),
      'ponder:api': path.resolve(__dirname, 'test/mocks/ponder-api.ts'),
      ponder: path.resolve(__dirname, 'test/mocks/ponder-pkg.ts'),
    },
  },
});
