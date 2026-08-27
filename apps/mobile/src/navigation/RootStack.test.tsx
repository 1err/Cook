import React from "react";
import { render } from "@testing-library/react-native";
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

let mockAuthState: { loading: boolean; token: string | null } = {
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
    Screen: () => null,
  }),
}));

jest.mock("./AuthStack", () => ({ AuthStack: () => null }));
jest.mock("./MainTabs", () => ({ MainTabs: () => null }));
jest.mock("./stacks/AccountStack", () => ({ AccountStack: () => null }));
jest.mock("../features/import/ImportModalScreen", () => ({ ImportModalScreen: () => null }));

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

    const nextUrl = "https://vm.tiktok.com/ZMnextRecipe/";
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
