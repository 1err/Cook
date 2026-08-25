import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FriendsSearchPage from "./page";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../lib/api", () => ({ apiFetch: mockApiFetch }));

afterEach(cleanup);

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe("FriendsSearchPage", () => {
  it("keeps exact-email guidance out of the default state and opens a found library", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "friend-1", email: "friend@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const user = userEvent.setup();

    render(<FriendsSearchPage />);

    expect(screen.queryByText(/exact email/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "friend@example.com");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("link", { name: /Open library/i })).toHaveAttribute(
      "href",
      expect.stringContaining("friend-1"),
    );
  });

  it("explains privacy only after a search cannot find a public library", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const user = userEvent.setup();

    render(<FriendsSearchPage />);
    await user.type(screen.getByRole("textbox"), "private@example.com");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/haven't shared their library/i)).toBeVisible();
  });
});
