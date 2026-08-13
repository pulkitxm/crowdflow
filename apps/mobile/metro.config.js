// The app lives in a Python-first monorepo, so the TypeScript contracts it
// consumes sit outside its project root (packages/contracts/ts). Metro only
// watches the project root by default and would treat that import as missing,
// so the repo root is added as a watch folder and the alias is resolved here as
// well as in tsconfig — Metro does not read tsconfig paths.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@contracts': path.resolve(repoRoot, 'packages/contracts/ts/index.ts'),
};
// Dependencies are installed in apps/mobile only; without this Metro would walk
// up and find nothing at the repo root.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
