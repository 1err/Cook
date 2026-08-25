"use client";

import { emptyMealPlanSlots, MEAL_PLAN_SLOTS, type MealPlanSlots, type MealType, type Recipe } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { PLANNER_MEAL_LABEL_KEYS } from "../plannerMessages";
import { PlannerMealSlot } from "./PlannerMealSlot";

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type PlannerWeekBoardProps = {
  dates: string[];
  today: string;
  planByDate: Record<string, MealPlanSlots | undefined>;
  recipesById: Record<string, Recipe | undefined>;
  draggingSlot: { date: string; slot: MealType } | null;
  mutationsDisabled?: boolean;
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

function capitalize(value: string) {
  return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
}

export function PlannerWeekBoard({
  dates,
  today,
  planByDate,
  recipesById,
  draggingSlot,
  mutationsDisabled = false,
  onChoose,
  onOpen,
  onRemove,
  onDragOver,
  onDragLeave,
  onDrop,
}: PlannerWeekBoardProps) {
  const t = useT();

  return (
    <div className="planner-matrix" role="table" aria-label="Weekly meal plan">
      <div className="planner-matrix__header" role="row">
        <span role="columnheader">Day</span>
        {MEAL_PLAN_SLOTS.map((slot) => (
          <span key={slot} role="columnheader">{capitalize(t(PLANNER_MEAL_LABEL_KEYS[slot]))}</span>
        ))}
      </div>

      {dates.map((date, dayIndex) => (
        <section
          key={date}
          data-testid="planner-day-row"
          className={`planner-matrix__row${date === today ? " is-today" : ""}`}
          role="row"
        >
          <header className="planner-matrix__day" role="rowheader">
            <strong>{DAY_SHORT[dayIndex]}</strong>
            <span>{dayOfMonth(date)}</span>
          </header>
          {MEAL_PLAN_SLOTS.map((slot) => (
            <div className="planner-matrix__cell" role="cell" key={slot}>
              <PlannerMealSlot
                date={date}
                slot={slot}
                recipeIds={(planByDate[date] ?? emptyMealPlanSlots())[slot]}
                recipesById={recipesById}
                isDragOver={draggingSlot?.date === date && draggingSlot.slot === slot}
                mutationsDisabled={mutationsDisabled}
                onChoose={() => onChoose(date, slot)}
                onOpen={onOpen}
                onRemove={(recipeId) => onRemove(date, slot, recipeId)}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
