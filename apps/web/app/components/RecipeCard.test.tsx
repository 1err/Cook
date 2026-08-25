import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Recipe } from "../types";
import { RecipeCard } from "./RecipeCard";

const recipe: Recipe = {
  id: "recipe-1",
  title: "Tomato braised beef",
  thumbnail_url: null,
  ingredients: [
    { name: "Beef chuck", quantity: "500 g" },
    { name: "Tomato", quantity: "3" },
    { name: "Ginger", quantity: "1 knob" },
  ],
  library_tags: ["chinese", "weeknight", "main_dish"],
  total_time_minutes: 55,
};

afterEach(cleanup);

describe("RecipeCard", () => {
  it("keeps the title and two tags scannable without previewing ingredients", () => {
    const view = render(<RecipeCard recipe={recipe} isHighlighted={false} />);
    const card = within(view.container);

    expect(card.getByRole("heading", { name: recipe.title })).toBeVisible();
    expect(card.queryByText("Beef chuck, Tomato, Ginger")).not.toBeInTheDocument();
    expect(card.queryByTestId("recipe-ingredients")).not.toBeInTheDocument();
    expect(card.queryByText("55 min")).not.toBeInTheDocument();
    expect(card.queryByText("Main Dish")).not.toBeInTheDocument();
    expect(card.getAllByTestId("recipe-tag")).toHaveLength(2);
  });
});
