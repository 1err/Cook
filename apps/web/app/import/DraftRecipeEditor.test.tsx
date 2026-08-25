import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "../types";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      "common.add": "Add",
      "common.ingredients": "Ingredients",
      "common.save": "Save",
      "common.saving": "Saving…",
      "common.tags": "Tags",
      "import.saveRecipe": "Save recipe",
      "import.untitledRecipe": "Untitled recipe",
      "recipe.coverImage": "Cover image",
      "recipe.description": "Description",
      "recipe.equipment": "Equipment",
      "recipe.equipment.addRow": "Add equipment",
      "recipe.equipment.placeholder": "Equipment item",
      "recipe.ingredient": "Ingredient",
      "recipe.qty": "Amount",
      "recipe.removeIngredient": "Remove ingredient",
      "recipe.recipeTitle": "Recipe title",
      "recipe.step.addRow": "Add step",
      "recipe.step.duration": "Duration",
      "recipe.step.moveDown": "Move down",
      "recipe.step.moveUp": "Move up",
      "recipe.step.remove": "Remove step",
      "recipe.step.textPlaceholder": "Step instructions",
      "recipe.steps": "Steps",
      "recipe.steps.empty": "No steps",
      "recipe.tips": "Tips",
      "recipe.tips.addRow": "Add tip",
      "recipe.tips.placeholder": "Tip",
      "recipe.totalTime": "Total time",
      "recipe.totalTime.minutesSuffix": "minutes",
    };
    return messages[key] ?? key;
  },
}));

const draft: Recipe = {
  id: "draft-1",
  title: "Braised tofu",
  thumbnail_url: null,
  description: "A weeknight braise.",
  total_time_minutes: 40,
  ingredients: [
    { name: "Tofu", quantity: "1 block", metric_quantity: "400 g", notes: "firm" },
  ],
  steps: [{ text: "Braise until glossy.", image_url: "https://example.com/step.jpg" }],
  tips: ["Drain the tofu."],
  equipment: ["Skillet"],
  library_tags: ["weeknight"],
};

afterEach(cleanup);

describe("DraftRecipeEditor", () => {
  it("keeps the review hierarchy focused on editable recipe content", () => {
    render(
      <DraftRecipeEditor
        draft={draft}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSaveSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Back to source" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Review recipe" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Add image|Upload image/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Image URL")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Notes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Errors stay local/i)).not.toBeInTheDocument();
  });
});
