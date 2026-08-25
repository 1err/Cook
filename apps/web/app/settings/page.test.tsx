import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettingsPage from "./page";

const { mockSetLibraryVisibility, mockUseAuth } = vi.hoisted(() => ({
  mockSetLibraryVisibility: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock("../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../lib/auth", () => ({ useAuth: mockUseAuth }));

afterEach(cleanup);

beforeEach(() => {
  mockSetLibraryVisibility.mockReset().mockResolvedValue(undefined);
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", email: "cook@example.com", is_library_public: false },
    setLibraryVisibility: mockSetLibraryVisibility,
  });
});

it("keeps the sharing consequence beside a clearly labeled control", async () => {
  const user = userEvent.setup();
  render(<SettingsPage />);

  expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
  const control = screen.getByRole("checkbox", { name: /Share my library/i });
  await user.click(control);

  expect(mockSetLibraryVisibility).toHaveBeenCalledWith(true);
});
