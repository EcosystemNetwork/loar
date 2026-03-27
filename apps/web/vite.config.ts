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
  const BANNED = /^(node:|ponder|@ponder\/)/;
  return {
    name: 'browser-boundary-guard',
    enforce: 'pre',
    resolveId(source, importer) {
      if (BANNED.test(source) && importer && !importer.includes('node_modules')) {
        throw new Error(
          `[browser-boundary-guard] Browser code cannot import "${source}".\n` +
            `  Imported from: ${importer}\n` +
            `  Move this import to a server-only module or use a browser-safe alternative.`
        );
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
    },
    dedupe: ['wagmi', 'viem', '@tanstack/react-query', 'react', 'react-dom'],
  },
  // Remove external wagmi/codegen - let it be bundled properly
  server: {
    port: 3001,
    hmr: {
      port: 3001,
    },
  },
});
