import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ProfileScreen } from "./ProfileScreen";

const mockNavigate = jest.fn();

jest.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "cook@example.com",
      is_library_public: false,
    },
    setLibraryVisibility: jest.fn(),
  }),
}));

jest.mock("../../lib/i18n", () => ({
  useI18n: () => ({ language: "en", setLanguage: jest.fn() }),
  useT: () => (key: string) => key,
}));

beforeEach(() => mockNavigate.mockClear());

test("opens the development design-system gallery from the account screen", async () => {
  await render(
    <ProfileScreen
      navigation={{ navigate: mockNavigate } as never}
      route={{ key: "profile", name: "Profile" }}
    />,
  );

  await fireEvent.press(screen.getByText("Design system"));

  expect(mockNavigate).toHaveBeenCalledWith("DesignSystem");
});
