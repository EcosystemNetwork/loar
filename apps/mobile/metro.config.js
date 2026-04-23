const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const {
  withSerializerPlugins,
} = require('@expo/metro-config/build/serializer/withExpoSerializers');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

let config = getDefaultConfig(projectRoot);

// Rewrite `import.meta` (unsupported by Hermes) in module output.
//
// thirdweb (redux-devtools-extension), brotli_wasm, and a handful of
// related ESM packages ship published code that reads `import.meta.env` /
// `import.meta.url`. Hermes refuses to compile those expressions. The
// rewrite below replaces them with safe fallbacks at bundle time:
//   import.meta.<any>  →  (undefined)
//   import.meta        →  ({})
//
// SCOPE: the rewrite is intentionally restricted to packages we know need
// it. A graph-wide regex would silently corrupt any future dep that uses
// `import.meta.url` legitimately (EIP-4844 blob workers, dynamic worker
// loading). When Metro asks us to rewrite a module outside the allowlist
// we leave it alone and emit a build-time warning so the failure is loud
// rather than silent at first runtime invocation.
const IMPORT_META_ALLOWLIST = [
  'redux-devtools-extension',
  'zustand',
  'brotli',
  'thirdweb',
  '@thirdweb-dev',
  'ox',
  'viem/utils/kzg',
];
const importMetaSeenWarnings = new Set();
const stripImportMetaProcessor = (entryPoint, preModules, graph, options) => {
  const shouldRewrite = (modulePath) =>
    typeof modulePath === 'string' &&
    IMPORT_META_ALLOWLIST.some((needle) => modulePath.includes(needle));
  const rewrite = (code, modulePath) => {
    if (!code || !code.includes('import.meta')) return code;
    if (!shouldRewrite(modulePath)) {
      if (!importMetaSeenWarnings.has(modulePath)) {
        importMetaSeenWarnings.add(modulePath);
        // eslint-disable-next-line no-console
        console.warn(
          `[metro] import.meta found in ${modulePath} (not in allowlist) — leaving as-is. ` +
            `This will throw on Hermes if the code path is reached. Add to IMPORT_META_ALLOWLIST ` +
            `or fix the dep.`
        );
      }
      return code;
    }
    return code
      .replace(/\bimport\.meta\.(\w+)/g, '(undefined)')
      .replace(/\bimport\.meta\b/g, '({})');
  };
  for (const preMod of preModules) {
    if (preMod.output) {
      for (const out of preMod.output) {
        if (out.data && typeof out.data.code === 'string') {
          out.data.code = rewrite(out.data.code, preMod.path);
        }
      }
    }
  }
  for (const mod of graph.dependencies.values()) {
    if (mod.output) {
      for (const out of mod.output) {
        if (out.data && typeof out.data.code === 'string') {
          out.data.code = rewrite(out.data.code, mod.path);
        }
      }
    }
  }
  return [entryPoint, preModules, graph, options];
};

config = withSerializerPlugins(config, [stripImportMetaProcessor]);

// Watch the monorepo root so packages in the workspace are tracked for HMR.
config.watchFolders = [workspaceRoot];

// Resolve modules from the app first, then the workspace root — required for
// pnpm's symlinked node_modules layout so hoisted deps are still found.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Honour the "exports" field in package.json — required by thirdweb, viem,
// and other modern ESM packages that expose subpaths (e.g. "thirdweb/chains").
config.resolver.unstable_enablePackageExports = true;

// thirdweb's in-app wallet needs these built-ins polyfilled at bundle time.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  crypto: require.resolve('expo-crypto'),
};

// thirdweb ships dynamic imports for external-wallet adapters we don't use
// (Coinbase smart wallet, WalletConnect mobile). Stub them so Metro's static
// resolver doesn't fail on packages that require pod-installed native peers.
const emptyShim = path.resolve(projectRoot, 'src/shims/empty.js');
const STUBBED_MODULES = new Set(['@mobile-wallet-protocol/client', '@coinbase/wallet-mobile-sdk']);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (STUBBED_MODULES.has(moduleName)) {
    return { type: 'sourceFile', filePath: emptyShim };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './src/global.css' });
