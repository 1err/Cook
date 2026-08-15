"use client";

import { emptyMealPlanSlots, MEAL_PLAN_SLOTS, type MealPlanSlots, type MealType, type Recipe } from "@cooking/shared";
import { PlannerMealSlot } from "./PlannerMealSlot";

const COL_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type PlannerWeekBoardProps = {
  dates: string[];
  today: string;
  planByDate: Record<string, MealPlanSlots | undefined>;
  recipesById: Record<string, Recipe | undefined>;
  draggingSlot: { date: string; slot: MealType } | null;
  onChoose: (date: string, slot: MealType) => void;
  onOpen: (recipeId: string) => void;
  onRemove: (date: string, slot: MealType, recipeId: string) => void;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
};

function dayOfMonth(date: string): number {
  return Number(date.split("-")[2]);
}

export function PlannerWeekBoard({
  dates,
  today,
  planByDate,
  recipesById,
  draggingSlot,
  onChoose,
  onOpen,
  onRemove,
  onDragOver,
  onDragLeave,
  onDrop,
}: PlannerWeekBoardProps) {
  return (
    <div className="planner-editorial__grid">
      {dates.map((date, dayIndex) => (
        <section key={date} data-testid="planner-day-column" className="planner-editorial__day-column flex flex-col gap-4 min-w-0">
          <header className={`planner-editorial__day-head${date === today ? " is-today" : ""}`}>
            <p className="dow font-headline">{COL_SHORT[dayIndex]}</p>
            <p className="dom">{dayOfMonth(date)}</p>
          </header>
          <div className="planner-editorial__day-body">
            {MEAL_PLAN_SLOTS.map((slot) => (
              <PlannerMealSlot
                key={slot}
                date={date}
                slot={slot}
                recipeIds={(planByDate[date] ?? emptyMealPlanSlots())[slot]}
                recipesById={recipesById}
                isDragOver={draggingSlot?.date === date && draggingSlot.slot === slot}
                onChoose={() => onChoose(date, slot)}
                onOpen={onOpen}
                onRemove={(recipeId) => onRemove(date, slot, recipeId)}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
