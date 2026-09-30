import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ShareIntent } from "expo-share-intent";
import { RootStack } from "./RootStack";

const mockNavigate = jest.fn();
const mockIsReady = jest.fn(() => true);
const mockNavigationRef = {
  isReady: mockIsReady,
  navigate: mockNavigate,
};
const mockResetShareIntent = jest.fn();

type MockShareContext = {
  hasShareIntent: boolean;
  shareIntent: ShareIntent;
  resetShareIntent: jest.Mock;
};

let mockAuthState: {
  loading: boolean;
  token: string | null;
  user?: { id: string; email_verified?: boolean; email_verification_required?: boolean };
} = {
  loading: true,
  token: null,
};
let mockShareContext: MockShareContext = {
  hasShareIntent: true,
  shareIntent: {
    files: null,
    type: "weburl" as const,
    webUrl: "https://youtu.be/dQw4w9WgXcQ",
    text: null,
  },
  resetShareIntent: mockResetShareIntent,
};

jest.mock("../lib/auth", () => ({
  useAuth: () => mockAuthState,
}));

jest.mock("expo-share-intent", () => ({
  useShareIntentContext: () => mockShareContext,
}));

jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return {
    NavigationContainer: ({ children, onReady }: { children: React.ReactNode; onReady?: () => void }) => {
      React.useEffect(() => {
        onReady?.();
      }, [onReady]);
      return React.createElement(React.Fragment, null, children);
    },
    useNavigationContainerRef: () => mockNavigationRef,
  };
});

jest.mock("@react-navigation/native-stack", () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: ({ component: Component }: { component: React.ComponentType }) => <Component />,
  }),
}));

jest.mock("./AuthStack", () => ({ AuthStack: () => null }));
jest.mock("./MainTabs", () => ({ MainTabs: () => {
  const React = require("react");
  const { TextInput } = require("react-native");
  const [draft, setDraft] = React.useState("");
  return <TextInput accessibilityLabel="Private draft" value={draft} onChangeText={setDraft} />;
} }));
jest.mock("./stacks/AccountStack", () => ({ AccountStack: () => null }));
jest.mock("../features/import/ImportModalScreen", () => ({ ImportModalScreen: () => null }));
jest.mock("../features/profile/SettingsScreen", () => ({ SettingsScreen: () => {
  const { Text } = require("react-native");
  return <Text>Verification gate</Text>;
} }));

describe("RootStack shared video bridge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = { loading: true, token: null };
    mockShareContext = {
      hasShareIntent: true,
      shareIntent: {
        files: null,
        type: "weburl",
        webUrl: "https://youtu.be/dQw4w9WgXcQ",
        text: null,
      },
      resetShareIntent: mockResetShareIntent,
    };
  });

  it("retains a pending intent through auth restoration until authenticated navigation", async () => {
    const view = await render(<RootStack />);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockResetShareIntent).not.toHaveBeenCalled();

    mockAuthState = { loading: false, token: null };
    await view.rerender(<RootStack />);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockResetShareIntent).not.toHaveBeenCalled();

    mockAuthState = { loading: false, token: "token" };
    await view.rerender(<RootStack />);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("ImportModal", {
      initialUrl: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);

    await view.rerender(<RootStack />);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);
  });

  it("keeps required unverified accounts out of private screens and retains their shared recipe", async () => {
    mockAuthState = {
      loading: false,
      token: "new-account-token",
      user: { id: "new-account", email_verified: false, email_verification_required: true },
    };
    const view = await render(<RootStack />);

    expect(screen.getByText("Verification gate")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Private draft")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockResetShareIntent).not.toHaveBeenCalled();

    mockAuthState = { ...mockAuthState, user: { ...mockAuthState.user!, email_verified: true } };
    await view.rerender(<RootStack />);

    expect(screen.queryByText("Verification gate")).toBeNull();
    expect(screen.getByLabelText("Private draft")).toBeOnTheScreen();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("ImportModal", { initialUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);
  });

  it.each([false, undefined])("preserves app access for legacy unverified accounts with requirement %s", async (required) => {
    mockAuthState = {
      loading: false,
      token: "legacy-token",
      user: { id: "legacy", email_verified: false, email_verification_required: required },
    };
    await render(<RootStack />);
    expect(screen.getByLabelText("Private draft")).toBeOnTheScreen();
    expect(screen.queryByText("Verification gate")).toBeNull();
  });

  it("consumes a replayed intent once and still handles a genuinely new intent", async () => {
    mockAuthState = { loading: false, token: "token" };
    const view = await render(<RootStack />);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);

    const replayReset = jest.fn();
    mockShareContext = {
      ...mockShareContext,
      resetShareIntent: replayReset,
    };
    await view.rerender(<RootStack />);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(replayReset).not.toHaveBeenCalled();

    const nextUrl = "https://xhslink.com/o/NextRecipe";
    mockShareContext = {
      ...mockShareContext,
      shareIntent: {
        files: null,
        type: "weburl",
        webUrl: nextUrl,
        text: null,
      },
    };
    await view.rerender(<RootStack />);

    expect(mockNavigate).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenLastCalledWith("ImportModal", { initialUrl: nextUrl });
    expect(replayReset).toHaveBeenCalledTimes(1);
  });

  it("resets unsupported share content without navigating once the app is ready", async () => {
    mockShareContext = {
      ...mockShareContext,
      shareIntent: {
        files: null,
        type: "text",
        webUrl: null,
        text: "Try https://example.com/not-a-recipe",
      },
    };
    const view = await render(<RootStack />);

    expect(mockResetShareIntent).not.toHaveBeenCalled();

    mockAuthState = { loading: false, token: "token" };
    await view.rerender(<RootStack />);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);
  });
});

test("switching accounts discards the previous account's mounted private draft", async () => {
  mockShareContext = { ...mockShareContext, hasShareIntent: false };
  mockAuthState = { loading: false, token: "alice-token", user: { id: "alice" } };
  const view = await render(<RootStack />);
  await fireEvent.changeText(screen.getByLabelText("Private draft"), "Alice's private recipe");
  mockAuthState = { loading: false, token: "bob-token", user: { id: "bob" } };
  await view.rerender(<RootStack />);
  expect(screen.getByLabelText("Private draft")).toHaveProp("value", "");
});


test("refreshing verification for the same account preserves its private screen state", async () => {
  mockShareContext = { ...mockShareContext, hasShareIntent: false };
  mockAuthState = { loading: false, token: "alice-token", user: { id: "alice" } };
  const view = await render(<RootStack />);
  await fireEvent.changeText(screen.getByLabelText("Private draft"), "My recipe draft");
  mockAuthState = { ...mockAuthState, user: { id: "alice" } };
  await view.rerender(<RootStack />);
  expect(screen.getByLabelText("Private draft")).toHaveProp("value", "My recipe draft");
});
