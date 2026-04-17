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
    dedupe: ['wagmi', 'viem', 'thirdweb', '@tanstack/react-query', 'react', 'react-dom'],
  },
  build: {
    // Only isolate thirdweb into its own chunk — it has internal circular
    // deps that cause TDZ errors ("Cannot access 'Tc' before initialization")
    // when Rollup concatenates it into the main chunk.
    // NOTE: Do NOT separate React or @radix-ui — they call React.forwardRef()
    // at load time and must share a chunk with React.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/thirdweb')) {
            return 'thirdweb';
          }
        },
      },
    },
  },
  server: {
    port: 3001,
    hmr: {
      port: 3001,
    },
  },
});
