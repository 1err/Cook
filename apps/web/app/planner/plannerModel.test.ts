import { describe, expect, test } from "vitest";
import { emptyMealPlanSlots } from "@cooking/shared";
import {
  addRecipeToSlots,
  removeRecipeFromSlots,
} from "./plannerModel";

describe("plannerModel", () => {
  test("adds immutably and ignores a duplicate recipe", () => {
    const original = { ...emptyMealPlanSlots(), lunch: ["r1"] };
    const added = addRecipeToSlots(original, "lunch", "r2");
    expect(added.lunch).toEqual(["r1", "r2"]);
    expect(original.lunch).toEqual(["r1"]);
    expect(addRecipeToSlots(added, "lunch", "r2")).toBe(added);
  });

  test("removes only the requested recipe", () => {
    const original = { ...emptyMealPlanSlots(), dinner: ["r1", "r2"] };
    expect(removeRecipeFromSlots(original, "dinner", "r1").dinner).toEqual(["r2"]);
  });
});
