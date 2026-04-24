const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

let config = getDefaultConfig(projectRoot);

// Watch the monorepo root so packages in the workspace are tracked for HMR.
config.watchFolders = [workspaceRoot];

// Resolve modules from the app first, then the workspace root — required for
// pnpm's symlinked node_modules layout so hoisted deps are still found.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Honour the "exports" field in package.json — required by modern ESM
// packages (expo-auth-session, @tanstack/*, @trpc/*) that expose subpaths.
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, { input: './src/global.css' });
