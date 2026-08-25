import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Recipe } from "../types";
import { RecipeCard } from "./RecipeCard";

const recipe: Recipe = {
  id: "recipe-1",
  title: "Tomato braised beef",
  thumbnail_url: null,
  ingredients: [{ name: "Beef chuck", quantity: "500 g" }],
  library_tags: ["chinese", "weeknight", "main_dish"],
  total_time_minutes: 55,
};

afterEach(cleanup);

describe("RecipeCard", () => {
  it("shows only supported scanning metadata", () => {
    const view = render(<RecipeCard recipe={recipe} isHighlighted={false} />);
    const card = within(view.container);

    expect(card.getByRole("heading", { name: recipe.title })).toBeVisible();
    expect(card.getByText("55 min")).toBeVisible();
    expect(card.queryByText("Beef chuck")).not.toBeInTheDocument();
    expect(card.queryByText("Main Dish")).not.toBeInTheDocument();
    expect(card.getAllByTestId("recipe-tag")).toHaveLength(2);
  });

  it("removes the metadata row when total time is unavailable", () => {
    render(<RecipeCard recipe={{ ...recipe, total_time_minutes: null }} isHighlighted={false} />);

    expect(screen.queryByTestId("recipe-time")).not.toBeInTheDocument();
  });
});
