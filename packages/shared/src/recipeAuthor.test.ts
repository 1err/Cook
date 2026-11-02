import { describe, expect, it } from "vitest";
import { matchesRecipeSearch } from "./recipeAuthor";

describe("recipe author search", () => {
  const recipe = { title: "番茄炒蛋", author: { id: "wang", name: "美食作家王刚", aliases: ["Chef Wang", "王刚"] } };
  it("combines dish and creator terms, including aliases", () => {
    expect(matchesRecipeSearch(recipe, "番茄 王刚")).toBe(true);
    expect(matchesRecipeSearch(recipe, "Ｃｈｅｆ  WANG")).toBe(true);
    expect(matchesRecipeSearch(recipe, "番茄 小高姐")).toBe(false);
  });
  it("keeps old recipes and blank queries usable", () => {
    expect(matchesRecipeSearch({ title: "Egg fried rice" }, "  RICE ")).toBe(true);
    expect(matchesRecipeSearch({ title: "Egg fried rice" }, "王刚")).toBe(false);
    expect(matchesRecipeSearch(recipe, "  ")).toBe(true);
  });
  it("matches common Unicode alias case folding like the creator directory", () => {
    expect(matchesRecipeSearch({ title: "Soup", author: { id: "a", name: "Chef", aliases: ["Straße"] } }, "STRASSE")).toBe(true);
    expect(matchesRecipeSearch({ title: "Soup", author: { id: "b", name: "Οδυσσεύς", aliases: [] } }, "οδυσσεύσ")).toBe(true);
  });
});
