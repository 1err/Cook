import { describe, expect, it } from "vitest";
import { buildInstacartItems, isSafeInstacartUrl } from "./instacart";

describe("Instacart export", () => {
  it("exports original quantities without requiring a smart list or store matches", () => {
    expect(buildInstacartItems({ originalItems: [{ name: " Rice ", total_quantity: "2 cups + 50 g" }] }))
      .toEqual([{ name: "Rice", quantity: "2 cups + 50 g" }]);
  });
  it("exports only visible unchecked smart items and never falls back when all are removed", () => {
    const input = {
      originalItems: [{ name: "Old list", total_quantity: "1" }],
      purchaseItems: [{ name: "Rice", suggested_purchase: "1 bag" }, { name: "Eggs", suggested_purchase: "6" }],
      hidden: new Set([0]), checked: new Set([1]),
    };
    expect(buildInstacartItems(input)).toEqual([]);
    expect(buildInstacartItems({ ...input, checked: new Set() })).toEqual([{ name: "Eggs", quantity: "6" }]);
    expect(input.purchaseItems[0].name).toBe("Rice");
  });
  it("drops empty names without silently limiting or merging quantities", () => {
    expect(buildInstacartItems({ originalItems: [
      { name: " ", total_quantity: "1" }, { name: "Rice", total_quantity: "1 cup" }, { name: "Rice", total_quantity: "50 g" },
    ] })).toEqual([{ name: "Rice", quantity: "1 cup" }, { name: "Rice", quantity: "50 g" }]);
  });
});

describe("Instacart link validation", () => {
  it.each(["https://www.instacart.com/store/recipes/123?affiliate=x", "https://instacart.com/store/shopping_lists/123"])("accepts official result %s", (url) => {
    expect(isSafeInstacartUrl(url)).toBe(true);
  });
  it.each(["http://www.instacart.com/store/recipes/1", "https://instacart.com.evil.test/1", "https://evil.test/instacart.com", "https://user@www.instacart.com/1", "https://www.instacart.com:8443/1", "javascript:alert(1)", "https://www.instacart.com/", "https://www.instacart.com\\@evil.test/1", " https://www.instacart.com/store/1", "https://www.instacart.com/store/\n1"])("rejects unsafe or malformed %s", (url) => {
    expect(isSafeInstacartUrl(url)).toBe(false);
  });
});
