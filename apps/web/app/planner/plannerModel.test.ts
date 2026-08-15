import { describe, expect, test } from "vitest";
import { emptyMealPlanSlots } from "@cooking/shared";
import {
  MAX_VISIBLE_SLOT_RECIPES,
  addRecipeToSlots,
  removeRecipeFromSlots,
  splitSlotRecipeIds,
} from "./plannerModel";

describe("plannerModel", () => {
  test("shows two recipes and reports the remaining overflow", () => {
    expect(MAX_VISIBLE_SLOT_RECIPES).toBe(2);
    expect(splitSlotRecipeIds(["r1", "r2", "r3", "r4"])).toEqual({
      visible: ["r1", "r2"],
      overflow: ["r3", "r4"],
    });
  });

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
