import { describe, expect, it } from "vitest";
import type { Recipe } from "../types";
import {
  buildPlannedMealRows,
  formatMealOccurrence,
  formatPlannedMealSchedule,
} from "./plannedMeals";

const recipe = (id: string, title: string): Recipe => ({
  id,
  title,
  thumbnail_url: `https://example.com/${id}.jpg`,
  ingredients: [],
});

describe("planned meal presentation", () => {
  it("deduplicates recipe rows while retaining and ordering every meal occurrence", () => {
    const rows = buildPlannedMealRows(
      [
        { date: "2026-08-12", breakfast: [], lunch: ["tofu"], dinner: ["rice"] },
        { date: "2026-08-10", breakfast: ["rice"], lunch: [], dinner: ["tofu"] },
        { date: "2026-08-16", breakfast: [], lunch: [], dinner: ["rice"] },
      ],
      {
        rice: recipe("rice", "Ginger rice bowl"),
        tofu: recipe("tofu", "Crispy tofu"),
      },
      "2026-08-10",
    );

    expect(rows.map(({ recipeId }) => recipeId)).toEqual(["rice", "tofu"]);
    expect(rows[0].occurrences.map(formatMealOccurrence)).toEqual([
      "Mon breakfast",
      "Wed dinner",
      "Sun dinner",
    ]);
    expect(rows[1].occurrences.map(formatMealOccurrence)).toEqual([
      "Mon dinner",
      "Wed lunch",
    ]);
    expect(rows.flatMap(({ occurrences }) => occurrences)).toHaveLength(5);
  });

  it("summarizes repeated meals without hiding their full occurrence list", () => {
    const rows = buildPlannedMealRows(
      [
        { date: "2026-08-10", breakfast: ["rice"], lunch: [], dinner: [] },
        { date: "2026-08-12", breakfast: [], lunch: [], dinner: ["rice"] },
        { date: "2026-08-16", breakfast: [], lunch: [], dinner: ["rice"] },
      ],
      { rice: recipe("rice", "Ginger rice bowl") },
      "2026-08-10",
    );

    expect(formatPlannedMealSchedule(rows[0])).toBe("3 meals · Mon breakfast · +2 more");
    expect(rows[0].occurrences.map(formatMealOccurrence).join(", ")).toBe(
      "Mon breakfast, Wed dinner, Sun dinner",
    );
  });

  it("ignores out-of-range plans and missing recipes", () => {
    expect(buildPlannedMealRows(
      [
        { date: "2026-08-10", breakfast: ["missing"], lunch: [], dinner: [] },
        { date: "2026-08-17", breakfast: ["rice"], lunch: [], dinner: [] },
      ],
      { rice: recipe("rice", "Ginger rice bowl") },
      "2026-08-10",
    )).toEqual([]);
  });
});
