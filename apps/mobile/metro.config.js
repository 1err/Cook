// Metro must watch the mobile app's hoisted dependencies and shared packages,
// but not the entire monorepo root. Watching the root makes Metro's `find`
// fallback crawl unrelated worktrees and their node_modules when Watchman is
// unavailable, preventing the first bundle from ever starting.
//
// disableHierarchicalLookup is intentionally NOT set: with the SDK 54 dep tree,
// some Expo transitives (expo-asset, babel-preset-expo, etc.) end up nested at
// apps/mobile/node_modules/expo/node_modules/ rather than hoisted to the root.
// Hierarchical lookup is needed so Metro can walk into those nested locations.
//
// resolveRequest pins every `react` import to the mobile-local copy. The web app
// (apps/web) uses Next.js 15 + React 19.1.5; the native renderer requires React
// 19.1.0. Hoisted transitives can otherwise resolve the web copy while mobile's
// own files resolve the native copy. Sharing a major version does not make two
// React instances compatible: mixed instances cause "Invalid hook call" errors.
// Forcing all `react` and `react/*` specifiers to the mobile-local copy preserves
// one React instance and the version expected by the native renderer.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.resolve(workspaceRoot, "node_modules"),
  path.resolve(workspaceRoot, "packages/api-client"),
  path.resolve(workspaceRoot, "packages/design-tokens"),
  path.resolve(workspaceRoot, "packages/shared"),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

const mobileReactRoot = path.resolve(projectRoot, "node_modules/react");
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    const subpath = moduleName.slice("react".length);
    const target = subpath
      ? require.resolve(path.join(mobileReactRoot, subpath.replace(/^\//, "")))
      : require.resolve(mobileReactRoot);
    return { filePath: target, type: "sourceFile" };
  }
  if (typeof upstreamResolveRequest === "function") {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
