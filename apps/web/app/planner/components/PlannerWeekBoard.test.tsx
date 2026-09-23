import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyMealPlanSlots } from "@cooking/shared";
import { I18nProvider } from "../../lib/i18n";
import { PlannerWeekBoard } from "./PlannerWeekBoard";

test("renders seven day cards with three meal sections each", () => {
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
        onManage={vi.fn()}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
      />
    </I18nProvider>,
  );
  expect(screen.getByRole("heading", { name: "Mon 10" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Sun 16" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Meal planner" })).toBeVisible();
  expect(screen.getAllByTestId("planner-day-card")).toHaveLength(7);
  expect(screen.getAllByTestId("planner-meal-slot")).toHaveLength(21);
  expect(screen.getAllByRole("heading", { name: "Breakfast" })).toHaveLength(7);
  expect(screen.getAllByRole("heading", { name: "Lunch" })).toHaveLength(7);
  expect(screen.getAllByRole("heading", { name: "Dinner" })).toHaveLength(7);
  expect(
    screen.getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-10" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Choose a recipe for dinner on 2026-08-16" }),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: /Choose a recipe for/ })).toHaveLength(21);
});
