import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { CookScreen } from "./CookScreen";

const mockRefresh = jest.fn();
const mockUseCookingSession = jest.fn();

jest.mock("./useCookingSession", () => ({ useCookingSession: () => mockUseCookingSession() }));
jest.mock("./CookSetup", () => ({
  CookSetup: () => {
    const ReactModule = require("react") as typeof import("react");
    const { Text, View } = require("react-native") as typeof import("react-native");
    return ReactModule.createElement(View, null,
      ReactModule.createElement(Text, null, "Start cooking"),
      ReactModule.createElement(Text, null, "Choose a planned meal or recipes from your library."),
    );
  },
}));
jest.mock("./CookWorkspace", () => ({
  CookWorkspace: () => {
    const ReactModule = require("react") as typeof import("react");
    const { Text } = require("react-native") as typeof import("react-native");
    return ReactModule.createElement(Text, null, "Your cooking session");
  },
}));
jest.mock("../../lib/i18n", () => ({
  useT: () => (key: string) => ({
    "common.loading": "Loading...",
    "common.refresh": "Refresh",
    "cook.empty.title": "Start cooking",
    "cook.empty.description": "Choose a planned meal or recipes from your library.",
    "cook.error.title": "Couldn't load your cooking session",
    "cook.active.title": "Your cooking session",
  }[key] ?? key),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseCookingSession.mockReturnValue({
    status: "ready",
    session: null,
    error: null,
    refresh: mockRefresh,
  });
});

test("shows the empty cooking entry when no account session is active", async () => {
  await render(<CookScreen />);
  expect(screen.getByText("Start cooking")).toBeOnTheScreen();
  expect(screen.getByText("Choose a planned meal or recipes from your library.")).toBeOnTheScreen();
});

test("keeps loading and retryable error states inside the Cook tab", async () => {
  mockUseCookingSession.mockReturnValue({ status: "loading", session: null, error: null, refresh: mockRefresh });
  const view = await render(<CookScreen />);
  expect(screen.getByText("Loading...")).toBeOnTheScreen();

  mockUseCookingSession.mockReturnValue({ status: "error", session: null, error: "Offline", refresh: mockRefresh });
  await view.rerender(<CookScreen />);
  expect(screen.getByText("Offline")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Refresh" }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
