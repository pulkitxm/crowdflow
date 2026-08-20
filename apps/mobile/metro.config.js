// CrowdFlow packages are Bun workspaces outside Expo's project root. Metro must
// watch the authored workspace packages the app imports, without watching the
// repo root (which drags in the bun node_modules store and exhausts the Linux
// inotify limit: ENOSPC / EINVAL in @expo/metro-file-map).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Watch only the app and the workspace packages it imports. Workspace packages
// are linked into apps/mobile/node_modules by bun, so resolution works; this
// keeps the watched tree small (node_modules is never in watchFolders).
const workspacePackages = [
  path.resolve(repoRoot, 'packages/contracts'),
  // The positioning engine, reached through the `@crowdflow/core/positioning`
  // subpath export. Only that directory is resolved, which is the point: the
  // package root pulls in `node:crypto` (the participation sketches) and the
  // simulation engine, neither of which can exist in a phone bundle.
  path.resolve(repoRoot, 'packages/core'),
];

config.watchFolders = [projectRoot, ...workspacePackages];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

/**
 * Two resolver rules, both about the difference between what TypeScript compiles
 * and what a phone runs.
 *
 * 1. `.js` specifiers that are really `.ts` files. The workspace packages are
 *    authored under `moduleResolution: NodeNext`, which requires every relative
 *    import to name the emitted `.js` file even though the file on disk is
 *    `.ts` — `export * from './geo.js'` resolving to `geo.ts`. tsc understands
 *    that mapping; Metro does not, and fails with "Unable to resolve ./geo.js".
 *    This became load-bearing when the app started importing RUNTIME values from
 *    `@crowdflow/core/positioning`: before that, every workspace import was
 *    `import type`, which is erased before Metro ever sees it.
 *
 *    Scoped to the workspace packages deliberately. A blanket rule would also
 *    rewrite genuine `.js` imports inside node_modules, where the `.js` file is
 *    exactly what is meant.
 *
 * 2. The radio modules do not exist on web. `react-native-wifi-reborn` and
 *    `react-native-ble-plx` are native modules with no web implementation, and
 *    Metro resolves `require` calls statically — so the lazy `require` in the
 *    sensor adapters, which is what lets a build omit them, is not enough to
 *    keep them out of a web bundle. They resolve to an empty module on web, and
 *    the adapters then report themselves unavailable in words, which is exactly
 *    what they do on a device that lacks them.
 */
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
      // Fall through: a workspace package importing a real `.js` file is
      // unusual but not forbidden, and the default resolver should get the
      // error rather than this branch swallowing it.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
