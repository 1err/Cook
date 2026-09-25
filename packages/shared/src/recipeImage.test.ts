import { describe, expect, it } from "vitest";
import { buildRecipeImageInput } from "./recipeImage";

describe("buildRecipeImageInput", () => {
  it("sends only dish context and leaves the user's recipe unchanged", () => {
    const recipe = {
      title: "  豆腐茄子煲  ", description: "  Golden tofu with eggplant. ",
      ingredients: [{ name: " tofu ", quantity: "1 block" }, { name: " ", quantity: "" }],
      steps: [{ text: " Pan-fry tofu until golden. ", image_url: "https://private.example/step" }],
      source_url: "https://private.example/recipe", raw_extraction_text: "private source text",
    };
    expect(buildRecipeImageInput(recipe)).toEqual({
      title: "豆腐茄子煲", description: "Golden tofu with eggplant.",
      ingredients: ["tofu"], steps: ["Pan-fry tofu until golden."],
    });
    expect(recipe.title).toBe("  豆腐茄子煲  ");
    expect(recipe.ingredients).toHaveLength(2);
  });

  it("bounds long recipes without splitting Unicode characters", () => {
    const input = buildRecipeImageInput({
      title: "🍆".repeat(513), description: "a".repeat(2001),
      ingredients: Array.from({ length: 42 }, () => ({ name: "豆".repeat(101), quantity: "" })),
      steps: Array.from({ length: 15 }, () => ({ text: "焖".repeat(301) })),
    });
    expect(Array.from(input.title)).toHaveLength(512);
    expect(input.title.endsWith("🍆")).toBe(true);
    expect(input.description).toHaveLength(2000);
    expect(input.ingredients).toHaveLength(40);
    expect(input.ingredients[0]).toHaveLength(100);
    expect(input.steps).toHaveLength(12);
    expect(input.steps[0]).toHaveLength(300);
  });

  it("supports a title-only draft", () => {
    expect(buildRecipeImageInput({ title: "油焖鸡" })).toEqual({
      title: "油焖鸡", description: "", ingredients: [], steps: [],
    });
  });
});
