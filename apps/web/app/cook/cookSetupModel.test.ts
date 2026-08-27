import { expect, test } from "vitest";
import type { MealPlanDay } from "@cooking/shared";
import { getPlannedSelection } from "./cookSetupModel";

const plans: MealPlanDay[] = [
  {
    date: "2026-08-27",
    breakfast: ["oats"],
    lunch: ["tofu", "rice"],
    dinner: ["rice", "soup", "rice"],
  },
];

test("returns the selected meal in stable order without duplicate recipe ids", () => {
  expect(getPlannedSelection(plans, "2026-08-27", "dinner")).toEqual(["rice", "soup"]);
});

test("returns an empty selection for an unsaved date", () => {
  expect(getPlannedSelection(plans, "2026-08-28", "lunch")).toEqual([]);
});
