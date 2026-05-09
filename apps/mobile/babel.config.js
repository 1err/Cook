// require.resolve resolves from this file's directory (apps/mobile/),
// which is necessary in this monorepo: babel runs from the root node_modules
// but the preset/plugin live in apps/mobile/node_modules and aren't always hoisted.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [require.resolve("babel-preset-expo")],
    // Reanimated 4 splits worklets into react-native-worklets;
    // its plugin replaces the old react-native-reanimated/plugin.
    plugins: [require.resolve("react-native-worklets/plugin")],
  };
};
