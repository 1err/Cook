import { describe, expect, test } from "vitest";
import { presentIngredient } from "./ingredientPresentation";

describe("source-first ingredient presentation", () => {
  test.each([
    ["排骨", "一斤排骨，块要切的小一点", "500g", "一斤", ["块要切的小一点"], []],
    ["螺丝椒", "薄皮螺丝椒7根，大约8两", "400g", "7根", ["薄皮"], ["大约8两"]],
    ["姜", "切片", "10g", "10g", ["切片"], []],
    ["大蒜", "4粒，切片", "25g", "4粒", ["切片"], []],
    ["小米辣", "适口量，斜着切成圈", "40g", "适口量", ["斜着切成圈"], []],
    ["豆豉", "一勺半", "20g", "一勺半", [], []],
    ["清水", "两碗热水", "600ml", "两碗", ["热水"], []],
    ["生抽", "两勺", "20g", "两勺", [], []],
    ["蚝油", "一满勺", "20g", "一满勺", [], []],
    ["鸡精", "满满一茶勺", "3g", "满满一茶勺", [], []],
  ])("keeps the main source amount and preparation for %s", (name, quantity, metric, amount, preparation, alternatives) => {
    const result = presentIngredient({ name: name as string, quantity: quantity as string, metric_quantity: metric as string });
    expect(result.amount).toBe(amount);
    expect(result.preparation).toEqual(preparation);
    expect(result.alternatives).toEqual(alternatives);
    expect(result.metricAmount).toBe(amount === metric ? null : metric);
    expect(result.originalQuantity).toBe(quantity);
  });

  test("keeps stated counts ahead of optional estimated grams", () => {
    expect(presentIngredient({ name: "Garlic", quantity: "4 cloves, thinly sliced", metric_quantity: "approx. 25 g" })).toMatchObject({
      amount: "4 cloves", metricAmount: "approx. 25 g", preparation: ["thinly sliced"],
    });
  });

  test("retains approximation when metric is the only available amount", () => {
    expect(presentIngredient({ name: "Ginger", quantity: "", metric_quantity: "约10克", notes: "切片" })).toMatchObject({
      amount: "约10克", metricAmount: null, preparation: ["切片"],
    });
  });

  test("separates explicitly written equivalents without calculating a conversion", () => {
    expect(presentIngredient({ name: "Milk", quantity: "1/2 cup (120 mL)" })).toMatchObject({
      amount: "1/2 cup", metricAmount: "120 mL", alternatives: [], preparation: [],
    });
    expect(presentIngredient({ name: "Milk", quantity: "1/2 cup" }).metricAmount).toBeNull();
  });

  test("recognizes a stated metric equivalent without a space before its unit", () => {
    expect(presentIngredient({ name: "Milk", quantity: "1/2 cup (120mL)" })).toMatchObject({
      amount: "1/2 cup", metricAmount: "120mL", alternatives: [], preparation: [],
    });
  });

  test("keeps capitalized preparation separate when an existing metric amount is available", () => {
    expect(presentIngredient({ name: "Ginger", quantity: "Sliced", metric_quantity: "10g" })).toMatchObject({
      amount: "10g", metricAmount: null, preparation: ["Sliced"],
    });
  });

  test.each(["1 1/2 cups", "2–3 tbsp", "about 200–250 g", "半勺", "2 tbsp + 1 tsp"])("preserves fractions, ranges, qualifiers, and combined amounts: %s", quantity => {
    expect(presentIngredient({ name: "Sauce", quantity }).amount).toBe(quantity);
  });

  test("keeps package size accessible without replacing a can count", () => {
    expect(presentIngredient({ name: "Tomatoes", quantity: "2 (14 oz) cans, drained" })).toMatchObject({
      amount: "2 cans", alternatives: ["14 oz"], preparation: ["drained"],
    });
  });

  test("deduplicates visible preparation while leaving saved fields intact", () => {
    const ingredient = Object.freeze({ name: "Garlic", quantity: "  2 cloves, minced  ", metric_quantity: "10 g", notes: "minced" });
    expect(presentIngredient(ingredient)).toEqual({
      amount: "2 cloves", preparation: ["minced"], alternatives: [], metricAmount: "10 g", originalQuantity: "  2 cloves, minced  ",
    });
    expect(ingredient.quantity).toBe("  2 cloves, minced  ");
    expect(ingredient.notes).toBe("minced");
  });

  test.each(["to taste", "as needed", "a little", "适量", "少许", "适口量"])("does not replace a useful vague amount with grams: %s", quantity => {
    expect(presentIngredient({ name: "Salt", quantity, metric_quantity: "3 g" })).toMatchObject({ amount: quantity, metricAmount: "3 g" });
  });

  test("does not hide an additional use as an interchangeable amount", () => {
    expect(presentIngredient({ name: "Oil", quantity: "2 tbsp, plus 1 tsp for finishing" })).toMatchObject({
      amount: "2 tbsp", preparation: ["plus 1 tsp for finishing"], alternatives: [],
    });
  });

  test("retains unrecognized wording rather than guessing an amount", () => {
    expect(presentIngredient({ name: "Broth", quantity: "enough to cover the vegetables", notes: "Keep warm." })).toMatchObject({
      amount: "enough to cover the vegetables", preparation: ["Keep warm."], metricAmount: null,
    });
  });

  test("does not duplicate a metric amount already shown as the main amount", () => {
    expect(presentIngredient({ name: "Tofu", quantity: "400 g", metric_quantity: "400g" })).toMatchObject({ amount: "400 g", metricAmount: null });
  });

  test("leaves a missing amount empty for the caller to localize", () => {
    expect(presentIngredient({ name: "Tofu", quantity: "", notes: null })).toEqual({
      amount: "", preparation: [], alternatives: [], metricAmount: null, originalQuantity: "",
    });
  });
});
