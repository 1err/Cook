import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "../types";
import { RecipeCard } from "./RecipeCard";

vi.mock("../lib/i18n", () => ({ useT: () => (key: string) => key === "recipe.totalTime.minutesSuffix" ? "min" : key }));

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
  it("keeps the title, cooking time, and two tags scannable without previewing ingredients", () => {
    const view = render(<RecipeCard recipe={recipe} isHighlighted={false} />);
    const card = within(view.container);

    expect(card.getByRole("heading", { name: recipe.title })).toBeVisible();
    expect(card.queryByText("Beef chuck, Tomato, Ginger")).not.toBeInTheDocument();
    expect(card.queryByTestId("recipe-ingredients")).not.toBeInTheDocument();
    expect(card.getByText("55 min")).toBeVisible();
    expect(card.queryByText("Main Dish")).not.toBeInTheDocument();
    expect(card.getAllByTestId("recipe-tag")).toHaveLength(2);
  });
});


it("shows a separate clickable creator credit without nesting links or altering timing and tags", () => {
  const author = { id: "author-1", name: "Lin", aliases: [] };
  const onSelect = vi.fn();
  render(<RecipeCard recipe={{ ...recipe, author }} onAuthorSelect={onSelect} />);
  const credit = screen.getByRole("button", { name: "recipe.author.by" });
  expect(credit.closest("a")).toBeNull();
  fireEvent.click(credit);
  expect(onSelect).toHaveBeenCalledWith(author);
  expect(screen.getByText("55 min")).toBeVisible();
  expect(screen.getAllByTestId("recipe-tag")).toHaveLength(2);
});
