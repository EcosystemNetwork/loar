const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

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
