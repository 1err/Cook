import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "../../types";
import { FriendLibraryCard } from "./FriendLibraryCard";

const recipe: Recipe = {
  id: "friend-recipe",
  title: "Scallion noodles",
  thumbnail_url: null,
  total_time_minutes: 25,
  ingredients: [{ name: "Noodles", quantity: "200 g" }],
  library_tags: ["chinese", "weeknight", "main_dish"],
};

afterEach(cleanup);

describe("FriendLibraryCard", () => {
  it("uses the same compact recipe metadata and an available copy action", () => {
    render(
      <FriendLibraryCard
        recipe={recipe}
        href="/library/friends/one/friend-recipe"
        state="idle"
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByText("25 min")).toBeVisible();
    expect(screen.queryByText("Noodles")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("friend-recipe-tag")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add to library" })).toBeEnabled();
  });

  it("communicates in-progress and completed copy states", () => {
    const { rerender } = render(
      <FriendLibraryCard recipe={recipe} href="#" state="copying" onCopy={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();

    rerender(<FriendLibraryCard recipe={recipe} href="#" state="added" onCopy={vi.fn()} />);
    expect(screen.getByRole("button", { name: "In your library" })).toBeDisabled();
  });
});
