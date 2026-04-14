import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Vite plugin that fails the build if browser code imports Node.js builtins
 * or server-only packages (ponder, @ponder/*).
 */
function browserBoundaryGuard(): Plugin {
  const BANNED = /^(node:|ponder|@ponder\/|firebase-admin|hono)/;
  const CROSS_APP = /\/apps\/(server|indexer)\//;
  return {
    name: 'browser-boundary-guard',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && !importer.includes('node_modules')) {
        if (BANNED.test(source)) {
          throw new Error(
            `[browser-boundary-guard] Browser code cannot import "${source}".\n` +
              `  Imported from: ${importer}\n` +
              `  Move this import to a server-only module or use a browser-safe alternative.`
          );
        }
        if (CROSS_APP.test(source)) {
          throw new Error(
            `[browser-boundary-guard] Browser code cannot import from apps/server or apps/indexer.\n` +
              `  Import: "${source}"\n` +
              `  Imported from: ${importer}\n` +
              `  Use @loar/shared for shared types instead.`
          );
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  base: '/',
  envDir: path.resolve(__dirname, '../../'),
  plugins: [browserBoundaryGuard(), tailwindcss(), react(), tanstackRouter({})],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@loar/abis/addresses': path.resolve(__dirname, '../../packages/abis/src/addresses.ts'),
      '@loar/abis/generated': path.resolve(__dirname, '../../packages/abis/src/generated.ts'),
      '@loar/shared/trpc': path.resolve(__dirname, '../../packages/shared/src/trpc.ts'),
    },
    dedupe: ['wagmi', 'viem', '@tanstack/react-query', 'react', 'react-dom'],
  },
  build: {
    // Let Vite/Rollup handle code splitting automatically.
    // Manual chunks broke module initialization order — @radix-ui calls
    // React.forwardRef() at load time, but React was in a different chunk
    // that hadn't initialized yet, causing "Cannot read properties of
    // undefined (reading 'forwardRef')" white screen crash.
  },
  server: {
    port: 3001,
    hmr: {
      port: 3001,
    },
  },
});
