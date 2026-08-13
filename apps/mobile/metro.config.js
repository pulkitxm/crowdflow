// CrowdFlow packages are npm workspaces outside Expo's project root. Metro must
// watch the repository root so the authored TypeScript contract package and its
// changes are visible during development.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);
config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(repoRoot, 'node_modules'),
  path.resolve(projectRoot, 'node_modules'),
];
module.exports = config;
