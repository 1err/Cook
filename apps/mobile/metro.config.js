// Metro must watch the monorepo root and resolve workspace symlinks
// (@cooking/shared, @cooking/api-client) hoisted to root node_modules.
//
// disableHierarchicalLookup is intentionally NOT set: with the SDK 54 dep tree,
// some Expo transitives (expo-asset, babel-preset-expo, etc.) end up nested at
// apps/mobile/node_modules/expo/node_modules/ rather than hoisted to the root.
// Hierarchical lookup is needed so Metro can walk into those nested locations.
//
// resolveRequest pins every `react` import to the mobile-local copy. The web app
// (apps/web) uses Next.js 14 + React 18; mobile uses React 19. With both reactlets
// installed in the workspace, transitives like @react-navigation/core get hoisted
// to the root and resolve to React 18 via Node's hierarchical walk, while mobile's
// own files resolve to React 19. Two Reacts in one bundle ⇒ "Cannot read property
// 'useContext' of null" / "Invalid hook call" redboxes. Forcing all `react` and
// `react/*` specifiers to the mobile-local copy gives the bundle a single React.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
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
