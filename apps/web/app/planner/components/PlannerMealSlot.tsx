"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MEAL_PLAN_SLOTS, type MealType, type Recipe } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { MAX_VISIBLE_SLOT_RECIPES, splitSlotRecipeIds } from "../plannerModel";

export type PlannerMealSlotProps = {
  date: string;
  slot: MealType;
  recipeIds: string[];
  recipesById: Record<string, Recipe | undefined>;
  isDragOver: boolean;
  onChoose: () => void;
  onOpen: (recipeId: string) => void;
  onRemove: (recipeId: string) => void;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
};

function useDialogKeyboard(
  overflowOpen: boolean,
  closeOverflow: () => void,
  overflowTriggerRef: React.RefObject<HTMLButtonElement>,
  dialogRef: React.RefObject<HTMLDivElement>,
) {
  useEffect(() => {
    if (!overflowOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverflow();
        queueMicrotask(() => overflowTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeOverflow, dialogRef, overflowOpen, overflowTriggerRef]);
}

function slotTitle(slot: MealType) {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function RecipeTile({ recipe, onOpen }: { recipe: Recipe; onOpen: () => void }) {
  const t = useT();

  return (
    <button type="button" className="planner-meal-card w-full h-full" onClick={onOpen} aria-label={t("planner.openRecipe", { title: recipe.title })}>
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
  onChoose,
  onOpen,
  onRemove,
  onDragOver,
  onDragLeave,
  onDrop,
}: PlannerMealSlotProps) {
  const t = useT();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);
  const { visible, overflow } = splitSlotRecipeIds(recipeIds);
  const visibleRecipes = visible.slice(0, MAX_VISIBLE_SLOT_RECIPES).map((recipeId) => ({ recipeId, recipe: recipesById[recipeId] })).filter(
    (entry): entry is { recipeId: string; recipe: Recipe } => Boolean(entry.recipe),
  );
  const dialogRecipes = recipeIds.map((recipeId) => ({ recipeId, recipe: recipesById[recipeId] })).filter(
    (entry): entry is { recipeId: string; recipe: Recipe } => Boolean(entry.recipe),
  );

  useDialogKeyboard(overflowOpen, closeOverflow, overflowTriggerRef, dialogRef);

  return (
    <div
      data-testid="planner-meal-slot"
      data-date={date}
      data-slot-index={String(MEAL_PLAN_SLOTS.indexOf(slot))}
      className={`planner-drop-target flex-1${isDragOver ? " is-drag-over" : ""}${recipeIds.length ? " planner-drop-target--filled" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {recipeIds.length ? (
        <div className="planner-slot-recipes">
          {visibleRecipes.map(({ recipeId, recipe }) => (
            <div key={recipeId} className="planner-slot-recipe">
              <RecipeTile recipe={recipe} onOpen={() => onOpen(recipeId)} />
            </div>
          ))}
          {overflow.length ? (
            <button
              ref={overflowTriggerRef}
              type="button"
              className="planner-slot-action font-headline"
              onClick={() => setOverflowOpen(true)}
              aria-label={t(overflow.length === 1 ? "planner.showMoreRecipes" : "planner.showMoreRecipesPlural", {
                count: overflow.length,
                slot,
                date,
              })}
            >
              +{overflow.length} more
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="planner-slot-empty-trigger"
          onClick={onChoose}
          aria-label={t("planner.chooseRecipeForMealSlot")}
        >
          <span className="planner-slot-plus" aria-hidden="true">
            <span className="material-symbols-outlined text-2xl opacity-40">add</span>
          </span>
          <span className="planner-slot-empty-trigger__label planner-slot-action--mobile font-headline">{t("planner.chooseRecipe")}</span>
        </button>
      )}

      {overflowOpen ? (
        <div ref={dialogRef} className="planner-mobile-picker" role="dialog" aria-modal="true" aria-label={t("planner.slotRecipes", { slot: slotTitle(slot), date })}>
          <button type="button" className="planner-mobile-picker__backdrop" aria-label={t("planner.closeSlotRecipes")} onClick={closeOverflow} />
          <div className="planner-mobile-picker__sheet" onClick={(event) => event.stopPropagation()}>
            <div className="planner-mobile-picker__head">
              <h2 className="planner-mobile-picker__title font-headline">{t("planner.slotRecipes", { slot: slotTitle(slot), date })}</h2>
              <button type="button" className="planner-mobile-picker__close" onClick={closeOverflow} aria-label={t("planner.closeSlotRecipes")}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="planner-mobile-picker__list">
              {dialogRecipes.map(({ recipeId, recipe }) => (
                <div key={recipeId} className="planner-slot-recipe">
                  <RecipeTile recipe={recipe} onOpen={() => onOpen(recipeId)} />
                  <button
                    type="button"
                    className="planner-meal-card__clear"
                    onClick={() => onRemove(recipeId)}
                    aria-label={t("planner.removeRecipeFromSlot", { title: recipe.title, slot, date })}
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
