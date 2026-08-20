const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

const workspacePackages = [
  path.resolve(repoRoot, 'packages/contracts'),
  path.resolve(repoRoot, 'packages/core'),
];

config.watchFolders = [projectRoot, ...workspacePackages];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

const WEB_ABSENT = ['react-native-wifi-reborn', 'react-native-ble-plx'];
const emptyModule = path.resolve(projectRoot, 'src/sensing/absent.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_ABSENT.includes(moduleName)) {
    return { type: 'sourceFile', filePath: emptyModule };
  }
  if (
    moduleName.startsWith('.')
    && moduleName.endsWith('.js')
    && workspacePackages.some((root) => (context.originModulePath ?? '').startsWith(`${root}${path.sep}`))
  ) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
