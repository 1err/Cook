import { describe, expect, it } from "vitest";
import { shoppingRefineInputs } from "./shoppingRefineInputs";

describe("shoppingRefineInputs", () => {
  it("sends each recipe contribution once instead of already combined display quantities", () => {
    expect(shoppingRefineInputs([
      { name: "盐", total_quantity: "13 g; 5–10 g", source_items: [
        { name: "食用盐", quantity: "6 g" },
        { name: "盐", quantity: "7 g" },
        { name: "盐", quantity: "5–10 g" },
      ] },
      { name: "大蒜", total_quantity: "2 瓣", source_items: [
        { name: "大蒜", quantity: "1 瓣" }, { name: "大蒜", quantity: "1 瓣" },
      ] },
      { name: "胡萝卜", total_quantity: "200 g" },
    ])).toEqual([
      { name: "食用盐", quantity: "6 g" }, { name: "盐", quantity: "7 g" },
      { name: "盐", quantity: "5–10 g" },
      { name: "大蒜", quantity: "1 瓣" }, { name: "大蒜", quantity: "1 瓣" },
      { name: "胡萝卜", quantity: "200 g" },
    ]);
  });

  it("keeps legacy or empty source rows usable without silently losing quantities", () => {
    expect(shoppingRefineInputs([
      { name: "salt", total_quantity: "1 tsp", source_items: [] },
      { name: "pepper", total_quantity: "", source_items: null },
    ])).toEqual([{ name: "salt", quantity: "1 tsp" }, { name: "pepper", quantity: "" }]);
  });

  it("rejects a malformed source rather than dropping it from the compilation", () => {
    expect(() => shoppingRefineInputs([{
      name: "salt", total_quantity: "10 g", source_items: [{ name: "", quantity: "5 g" }],
    }])).toThrow();
  });
});
