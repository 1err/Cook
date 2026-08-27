import React from "react";
import { render } from "@testing-library/react-native";
import App from "./App";

const mockShareIntentProvider = jest.fn(
  ({ children }: { children: React.ReactNode }) => children,
);

jest.mock("expo-share-intent", () => ({
  ShareIntentProvider: (props: { children: React.ReactNode; options?: unknown }) =>
    mockShareIntentProvider(props),
}));

jest.mock("expo-font", () => ({
  useFonts: () => [false],
}));

jest.mock("@expo-google-fonts/inter", () => ({
  Inter_400Regular: {},
  Inter_600SemiBold: {},
  Inter_700Bold: {},
}));

jest.mock("@expo-google-fonts/source-serif-4", () => ({
  SourceSerif4_400Regular: {},
  SourceSerif4_600SemiBold: {},
}));

jest.mock("./src/lib/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("./src/lib/i18n", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("./src/navigation/RootStack", () => ({
  RootStack: () => null,
}));

jest.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("expo-status-bar", () => ({
  StatusBar: () => null,
}));

test("keeps a shared intent across background login transitions", async () => {
  await render(<App />);

  expect(mockShareIntentProvider).toHaveBeenCalledWith(
    expect.objectContaining({
      options: { resetOnBackground: false },
    }),
  );
});
