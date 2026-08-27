jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { Text } = require("react-native");

  return {
    Ionicons: ({ name, ...props }: { name: string }) => React.createElement(Text, props, name),
  };
});

jest.mock("expo-share-intent", () => {
  const React = require("react");

  return {
    ShareIntentProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useShareIntentContext: () => ({
      isReady: true,
      hasShareIntent: false,
      shareIntent: {
        files: null,
        type: null,
        webUrl: null,
        text: null,
      },
      resetShareIntent: jest.fn(),
      error: null,
    }),
  };
});
