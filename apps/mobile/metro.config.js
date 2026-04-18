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
// thirdweb (redux-devtools-extension) and brotli_wasm ship published ESM
// that reads `import.meta.env` / `import.meta.url`. Hermes refuses to compile
// those expressions. This serializer processor walks the module graph after
// transform and replaces MetaProperty with safe fallbacks before serialization.
//   import.meta.<any>  →  (undefined)
//   import.meta        →  ({})
const stripImportMetaProcessor = (entryPoint, preModules, graph, options) => {
  const rewrite = (code) => {
    if (!code || !code.includes('import.meta')) return code;
    return code
      .replace(/\bimport\.meta\.(\w+)/g, '(undefined)')
      .replace(/\bimport\.meta\b/g, '({})');
  };
  for (const preMod of preModules) {
    if (preMod.output) {
      for (const out of preMod.output) {
        if (out.data && typeof out.data.code === 'string') {
          out.data.code = rewrite(out.data.code);
        }
      }
    }
  }
  for (const mod of graph.dependencies.values()) {
    if (mod.output) {
      for (const out of mod.output) {
        if (out.data && typeof out.data.code === 'string') {
          out.data.code = rewrite(out.data.code);
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
