vi.mock("../../components/safety/BlockedAccounts", () => ({ BlockedAccounts: () => null }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { id: "alice" } }) }));
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FriendsSearchPage from "./page";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../../lib/editorialCopy", () => ({
  useEditorialCopy: () => ({
    "library.tagline": "A little inspiration for your next meal.",
    "library.friends": "Friends",
    "friends.tagline": "Find shared recipes",
  }),
}));
vi.mock("../../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string) => MESSAGE_MAP.en[key] ?? key };
});

afterEach(cleanup);

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe("FriendsSearchPage", () => {
  it("keeps the library page heading and tabs above the friend search section", () => {
    render(<FriendsSearchPage />);

    const heading = screen.getByRole("heading", { level: 1, name: "Recipe library" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const subtitle = screen.getByText("A little inspiration for your next meal.", { exact: true });
    const tabs = screen.getByRole("tablist", { name: "Library views" });
    expect(within(tabs).getByRole("tab", { name: "My library" })).toHaveAttribute("href", "/library");
    expect(within(tabs).getByRole("tab", { name: "Public library" })).toHaveAttribute("href", "/library?view=public");
    expect(within(tabs).getByRole("tab", { name: "Friends" })).toHaveAttribute("aria-selected", "true");
    const searchHeading = screen.getByRole("heading", { level: 2, name: "Find a friend" });
    expect(heading.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(subtitle.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.compareDocumentPosition(searchHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

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
    expect(screen.getByText("Search for a shared recipe library.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Want to share yours?" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Library sharing settings/ })).toHaveAttribute("href", "/settings");
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
