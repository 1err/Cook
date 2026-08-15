import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyMealPlanSlots } from "@cooking/shared";
import { I18nProvider } from "../../lib/i18n";
import { PlannerWeekBoard } from "./PlannerWeekBoard";

test("renders all seven days and 21 accessible meal slots", () => {
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
  expect(screen.getAllByTestId("planner-day-column")).toHaveLength(7);
  expect(screen.getAllByTestId("planner-meal-slot")).toHaveLength(21);
});
