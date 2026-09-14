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

beforeEach(() => mockApiFetch.mockReset());
afterEach(cleanup);

test.each(["A public description of these tomato noodles.", null])(
  "does not show private import text in the shared recipe subtitle (description: %s)",
  async (description) => {
    mockApiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(
      path === "/recipes" ? [] : [{
        id: "recipe-1",
        title: "Tomato noodles",
        description,
        raw_extraction_text: "Private import guidance: synthetic family medical notes.",
        source_url: "https://example.com/noodles",
        ingredients: [{ name: "tomato", quantity: "2" }],
      }],
    ), { status: 200 }));

    render(<FriendRecipeDetailPage />);
    expect(await screen.findByRole("heading", { name: "Tomato noodles" })).toBeVisible();
    expect(screen.queryByText(/synthetic family medical notes/)).not.toBeInTheDocument();
    if (description) expect(screen.getByText(description)).toBeVisible();
    expect(screen.getByRole("link", { name: "Original source →" })).toHaveAttribute(
      "href", "https://example.com/noodles",
    );
    expect(mockApiFetch).toHaveBeenCalledWith("/users/friend-1/recipes");
  },
);
