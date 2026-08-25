import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyMealPlanSlots } from "@cooking/shared";
import { I18nProvider } from "../../lib/i18n";
import { PlannerWeekBoard } from "./PlannerWeekBoard";

test("renders seven day rows beneath three meal columns", () => {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-08-${String(10 + index).padStart(2, "0")}`);
  const planByDate = Object.fromEntries(dates.map((date) => [date, emptyMealPlanSlots()]));
  render(
    <I18nProvider>
      <PlannerWeekBoard
        dates={dates}
        today="2026-08-10"
        planByDate={planByDate}
        recipesById={{}}
        draggingSlot={null}
        onChoose={vi.fn()}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
      />
    </I18nProvider>,
  );
  expect(screen.getByText("Mon")).toBeVisible();
  expect(screen.getByText("Sun")).toBeVisible();
  expect(screen.getAllByTestId("planner-day-row")).toHaveLength(7);
  expect(screen.getAllByTestId("planner-meal-slot")).toHaveLength(21);
  expect(screen.getByRole("columnheader", { name: "Breakfast" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Lunch" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Dinner" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-10" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Choose a recipe for dinner on 2026-08-16" }),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: /Choose a recipe for/ })).toHaveLength(21);
});
