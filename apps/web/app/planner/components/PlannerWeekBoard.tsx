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
  onManage: (date: string, slot: MealType) => void;
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
  mutationsDisabled = false,
  onChoose,
  onManage,
  onOpen,
  onRemove,
  onDragOver,
  onDragLeave,
  onDrop,
}: PlannerWeekBoardProps) {
  const t = useT();

  return (
    <div className="planner-week-grid" role="region" aria-label={t("recipe.mealPlanner")}>
      {dates.map((date, dayIndex) => (
        <section
          key={date}
          data-testid="planner-day-card"
          className={`planner-day-card${date === today ? " is-today" : ""}`}
          aria-labelledby={`planner-day-${date}`}
        >
          <header className="planner-day-card__header">
            <div>
              <p className="planner-day-card__eyebrow">{DAY_SHORT[dayIndex]}</p>
              <h2
                id={`planner-day-${date}`}
                aria-label={`${DAY_SHORT[dayIndex]} ${dayOfMonth(date)}`}
              >
                {dayOfMonth(date)}
              </h2>
            </div>
            {date === today ? <span className="planner-day-card__today" aria-hidden="true" /> : null}
          </header>

          <div className="planner-day-card__meals">
            {MEAL_PLAN_SLOTS.map((slot) => (
              <div className="planner-day-card__meal" key={slot}>
                <PlannerMealSlot
                  date={date}
                  slot={slot}
                  recipeIds={(planByDate[date] ?? emptyMealPlanSlots())[slot]}
                  recipesById={recipesById}
                  isDragOver={draggingSlot?.date === date && draggingSlot.slot === slot}
                  mutationsDisabled={mutationsDisabled}
                  onChoose={() => onChoose(date, slot)}
                  onManage={() => onManage(date, slot)}
                  onOpen={onOpen}
                  onRemove={(recipeId) => onRemove(date, slot, recipeId)}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
