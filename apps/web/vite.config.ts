import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin, type Rollup } from 'vite';

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

/**
 * Rollup plugin that fails the build on circular imports between our source
 * files. Circular deps are the root cause of TDZ crashes in production
 * bundles. Escape hatch: set LOAR_ALLOW_CIRCULAR=1.
 */
function failOnCircularImports(): Plugin {
  return {
    name: 'fail-on-circular-imports',
    buildEnd() {
      if (process.env.LOAR_ALLOW_CIRCULAR === '1') return;

      const moduleIds = (this as unknown as Rollup.PluginContext).getModuleIds?.();
      if (!moduleIds) return;

      const cycles: string[][] = [];
      const visited = new Set<string>();

      for (const id of moduleIds) {
        if (id.includes('node_modules') || visited.has(id)) continue;

        const stack: string[] = [];
        const inStack = new Set<string>();

        const dfs = (moduleId: string) => {
          if (moduleId.includes('node_modules')) return;
          if (inStack.has(moduleId)) {
            const cycleStart = stack.indexOf(moduleId);
            cycles.push(stack.slice(cycleStart));
            return;
          }
          if (visited.has(moduleId)) return;

          stack.push(moduleId);
          inStack.add(moduleId);

          const mod = (this as unknown as Rollup.PluginContext).getModuleInfo(moduleId);
          if (mod) {
            for (const dep of mod.importedIds) {
              dfs(dep);
            }
          }

          inStack.delete(moduleId);
          stack.pop();
          visited.add(moduleId);
        };

        dfs(id);
      }

      if (cycles.length > 0) {
        const root = process.cwd();
        const summary = cycles
          .slice(0, 5)
          .map((c, i) => `  ${i + 1}. ${c.map((p) => p.replace(root, '.')).join(' → ')}`)
          .join('\n');
        this.error(
          `[fail-on-circular-imports] Found ${cycles.length} circular import(s):\n${summary}\n` +
            `  Fix the cycles or set LOAR_ALLOW_CIRCULAR=1 to bypass.`
        );
      }
    },
  };
}

export default defineConfig({
  base: '/',
  envDir: path.resolve(__dirname, '../../'),
  plugins: [
    browserBoundaryGuard(),
    failOnCircularImports(),
    tailwindcss(),
    react(),
    tanstackRouter({}),
  ],
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
