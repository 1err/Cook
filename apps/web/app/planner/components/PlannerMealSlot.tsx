"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { MEAL_PLAN_SLOTS, type MealType, type Recipe } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { PLANNER_MEAL_LABEL_KEYS } from "../plannerMessages";

export type PlannerMealSlotProps = {
  date: string;
  slot: MealType;
  recipeIds: string[];
  recipesById: Record<string, Recipe | undefined>;
  isDragOver: boolean;
  mutationsDisabled?: boolean;
  onChoose: () => void;
  onOpen: (recipeId: string) => void;
  onRemove: (recipeId: string) => void;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
};

function RecipeTile({
  recipe,
  slotLabel,
  date,
  onOpen,
}: {
  recipe: Recipe;
  slotLabel: string;
  date: string;
  onOpen: () => void;
}) {
  const t = useT();

  return (
    <button
      type="button"
      className="planner-meal-card w-full h-full"
      onClick={onOpen}
      aria-label={t("planner.openRecipe", { title: recipe.title, slot: slotLabel, date })}
    >
      {recipe.thumbnail_url ? (
        <img src={recipe.thumbnail_url} alt="" className="planner-meal-card__img" />
      ) : (
        <div
          className="planner-meal-card__img"
          style={{ background: "linear-gradient(145deg, var(--primary-fixed), var(--surface-container-high))" }}
        />
      )}
      <div className="planner-meal-card__body">
        <p className="planner-meal-card__title font-headline">{recipe.title}</p>
      </div>
    </button>
  );
}

export function PlannerMealSlot({
  date,
  slot,
  recipeIds,
  recipesById,
  isDragOver,
  mutationsDisabled = false,
  onChoose,
  onOpen,
  onRemove,
  onDragOver,
  onDragLeave,
  onDrop,
}: PlannerMealSlotProps) {
  const t = useT();
  const slotLabel = t(PLANNER_MEAL_LABEL_KEYS[slot]);
  const slotHeading = `${slotLabel.charAt(0).toLocaleUpperCase()}${slotLabel.slice(1)}`;
  const slotRecipes = recipeIds
    .map((recipeId) => ({ recipeId, recipe: recipesById[recipeId] }))
    .filter(
      (entry): entry is { recipeId: string; recipe: Recipe } => Boolean(entry.recipe),
    );
  const pendingRemoveFocusRef = useRef<{ recipeId: string; index: number } | null>(null);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const addRecipeRef = useRef<HTMLButtonElement>(null);
  const overflowCueId = useId();
  const slotRecipeFingerprint = slotRecipes.map(({ recipeId }) => recipeId).join("\u0000");
  const overflowCount = Math.max(0, slotRecipes.length - 3);
  const overflowMessage = overflowCount
    ? t(
        overflowCount === 1
          ? "planner.scrollForMoreRecipe"
          : "planner.scrollForMoreRecipes",
        { count: overflowCount },
      )
    : "";
  const overflowVisualMessage = overflowCount
    ? t("planner.moreRecipeCue", { count: overflowCount })
    : "";

  useLayoutEffect(() => {
    const pending = pendingRemoveFocusRef.current;
    if (!pending || slotRecipes.some(({ recipeId }) => recipeId === pending.recipeId)) return;

    const nextRecipe = slotRecipes[pending.index] ?? slotRecipes[pending.index - 1];
    const target = nextRecipe
      ? removeButtonRefs.current.get(nextRecipe.recipeId)
      : addRecipeRef.current;
    target?.focus();
    pendingRemoveFocusRef.current = null;
  }, [slotRecipeFingerprint, slotRecipes]);

  return (
    <div
      data-testid="planner-meal-slot"
      data-date={date}
      data-slot-index={String(MEAL_PLAN_SLOTS.indexOf(slot))}
      aria-disabled={mutationsDisabled || undefined}
      className={`planner-drop-target flex-1${isDragOver ? " is-drag-over" : ""}${recipeIds.length ? " planner-drop-target--filled" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className={`planner-slot-meal-label ${slot}`}>{slotLabel}</span>
      {recipeIds.length ? (
        <div className="planner-slot-recipes">
          <div
            className="planner-slot-recipes__scroll"
            role="region"
            aria-label={t("planner.slotRecipes", { slot: slotHeading, date })}
            aria-describedby={overflowCount ? overflowCueId : undefined}
            tabIndex={slotRecipes.length > 3 ? 0 : undefined}
          >
            {slotRecipes.map(({ recipeId, recipe }, index) => (
              <div key={recipeId} className="planner-slot-recipe">
                <RecipeTile
                  recipe={recipe}
                  slotLabel={slotLabel}
                  date={date}
                  onOpen={() => onOpen(recipeId)}
                />
                <button
                  ref={(button) => {
                    if (button) removeButtonRefs.current.set(recipeId, button);
                    else removeButtonRefs.current.delete(recipeId);
                  }}
                  type="button"
                  className="planner-meal-card__clear"
                  onClick={() => {
                    pendingRemoveFocusRef.current = { recipeId, index };
                    onRemove(recipeId);
                  }}
                  disabled={mutationsDisabled}
                  aria-label={t("planner.removeRecipeFromSlot", {
                    title: recipe.title,
                    slot: slotLabel,
                    date,
                  })}
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            ))}
          </div>
          {overflowCount ? (
            <p className="planner-slot-overflow-cue font-headline">
              <span className="planner-slot-overflow-cue__icon" aria-hidden="true">
                ↓
              </span>
              <span>{overflowVisualMessage}</span>
              <span id={overflowCueId} hidden>
                {overflowMessage}
              </span>
            </p>
          ) : null}
          <button
            ref={addRecipeRef}
            type="button"
            className="planner-slot-action font-headline"
            onClick={onChoose}
            disabled={mutationsDisabled}
            aria-label={t("planner.addAnotherRecipeForSlot", { slot: slotLabel, date })}
          >
            {t("planner.addAnotherRecipe")}
          </button>
        </div>
      ) : (
        <button
          ref={addRecipeRef}
          type="button"
          className="planner-slot-empty-trigger"
          onClick={onChoose}
          disabled={mutationsDisabled}
          aria-label={t("planner.chooseRecipeForSlot", { slot: slotLabel, date })}
        >
          <span className="planner-slot-plus" aria-hidden="true">
            <span className="material-symbols-outlined text-2xl opacity-40">add</span>
          </span>
          <span className="planner-slot-empty-trigger__label planner-slot-action--mobile font-headline">{t("planner.chooseRecipe")}</span>
        </button>
      )}
    </div>
  );
}
