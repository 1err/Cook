import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import FriendRecipeDetailPage from "./page";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ userId: "friend-1", recipeId: "recipe-1" }),
}));
vi.mock("../../../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../../../../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string, vars?: Record<string, string | number>) =>
    (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? "")) };
});

beforeEach(() => mockApiFetch.mockReset());
afterEach(cleanup);

test("shows recorded timing on a friend's recipe without adding editing controls", async () => {
  mockApiFetch.mockResolvedValue(new Response(JSON.stringify({
    id: "recipe-1", title: "Slow noodles", ingredients: [], total_time_minutes: 135,
    timing_summary: { hands_on_minutes: 15, passive_minutes: 120, is_estimate: true },
  })));
  render(<FriendRecipeDetailPage />);
  expect(await screen.findByText("2 hr 15 min")).toBeVisible();
  expect(screen.getByText("15 min hands-on")).toBeVisible();
  expect(screen.getByText("2 hr passive")).toBeVisible();
  expect(screen.getByText("About")).toBeVisible();
  expect(screen.queryByRole("link", { name: /Edit/ })).not.toBeInTheDocument();
  for (const button of screen.getAllByRole("button", { name: "Add to library" })) {
    expect(button).toBeEnabled();
  }
});

test.each(["A public description of these tomato noodles.", null])(
  "does not show private import text in the shared recipe subtitle (description: %s)",
  async (description) => {
    mockApiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(
      {
        id: "recipe-1",
        title: "Tomato noodles",
        description,
        raw_extraction_text: "Private import guidance: synthetic family medical notes.",
        source_url: "https://example.com/noodles",
        ingredients: [{ name: "tomato", quantity: "2" }],
        already_saved: false,
      },
    ), { status: 200 }));

    render(<FriendRecipeDetailPage />);
    expect(await screen.findByRole("heading", { name: "Tomato noodles" })).toBeVisible();
    expect(screen.queryByText(/synthetic family medical notes/)).not.toBeInTheDocument();
    if (description) expect(screen.getByText(description)).toBeVisible();
    expect(screen.getByRole("link", { name: "Original source →" })).toHaveAttribute(
      "href", "https://example.com/noodles",
    );
    expect(mockApiFetch).toHaveBeenCalledWith("/users/friend-1/recipes/recipe-1");
  },
);
