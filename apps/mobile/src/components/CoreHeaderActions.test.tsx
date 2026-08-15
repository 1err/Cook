import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { IconButton } from "./IconButton";
import { CoreHeaderActions } from "./CoreHeaderActions";

const mockNavigate = jest.fn();

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ user: { email: "jerry@example.com" } }),
}));

jest.mock("../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string>) => {
    if (key === "nav.addRecipe") return "Add recipe";
    if (key === "nav.accountFor") return `Account for ${vars?.email ?? ""}`;
    return key;
  },
}));

beforeEach(() => mockNavigate.mockClear());

test("orders contextual, account, and add actions and opens root flows", async () => {
  await render(
    <CoreHeaderActions
      before={
        <IconButton
          icon="search"
          accessibilityLabel="Find a friend"
          onPress={() => undefined}
        />
      }
    />,
  );

  expect(screen.getAllByRole("button").map((node) => node.props.accessibilityLabel)).toEqual([
    "Find a friend",
    "Account for jerry@example.com",
    "Add recipe",
  ]);

  await fireEvent.press(screen.getByRole("button", { name: "Account for jerry@example.com" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add recipe" }));

  expect(mockNavigate).toHaveBeenNthCalledWith(1, "Account");
  expect(mockNavigate).toHaveBeenNthCalledWith(2, "ImportModal");
});
