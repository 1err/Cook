import { expect, test } from "vitest";
import { GROCERY_CATEGORY_ORDER, guessGroceryCategory, normalizeGroceryCategory } from "./shoppingCategories";

test("prioritizes meat, produce, and pantry while retaining the other category order", () => {
  expect(GROCERY_CATEGORY_ORDER).toEqual([
    "Meat & Seafood", "Produce", "Pantry & Dry Goods", "Dairy", "Frozen", "Bakery", "Other",
  ]);
});

test.each([
  ["ground pepper", "Produce"], ["butter chicken", "Dairy"], ["cream sauce", "Dairy"],
])("display ordering does not reclassify %s", (name, category) => {
  expect(guessGroceryCategory(name)).toBe(category);
});

test("preserves existing precedence for ambiguous source category labels", () => {
  expect(normalizeGroceryCategory("Dairy / Pantry & Dry Goods", "cream sauce")).toBe("Dairy");
});
