"use client";

import {
  getCurrentCookingStep,
  getDishProgress,
  getEffectiveStepState,
  type CookingDish,
} from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";

function dishStatus(dish: CookingDish, t: ReturnType<typeof useT>): string {
  const step = getCurrentCookingStep(dish);
  if (!step) return t("cook.dish.done");
  const state = getEffectiveStepState(step);
  if (state === "needs_attention") return t("cook.attention.needsAttention");
  if (state === "timer_running") return t("cook.dish.timerRunning");
  if (state === "timer_paused") return t("cook.timer.paused");
  return t("cook.step.number", { current: step.position + 1, total: dish.steps.length });
}

export function DishRail({
  dishes,
  focusedDishId,
  onFocus,
}: {
  dishes: CookingDish[];
  focusedDishId: string | null;
  onFocus: (dishId: string) => void;
}) {
  const t = useT();
  return (
    <nav aria-label={t("cook.dishes.title")} className={styles.dishRail}>
      {dishes.map((dish) => {
        const progress = getDishProgress(dish);
        return (
          <button
            aria-current={focusedDishId === dish.id ? "true" : undefined}
            aria-label={t("cook.dish.focus", { dish: dish.title })}
            className={styles.dishCard}
            data-testid="dish-rail-item"
            key={dish.id}
            onClick={() => onFocus(dish.id)}
            type="button"
          >
            <span className={styles.dishCardTop}>
              <strong>{dish.title}</strong>
              <span>{progress}%</span>
            </span>
            <span>{dishStatus(dish, t)}</span>
            <span aria-hidden="true" className={styles.progressTrack}>
              <span style={{ inlineSize: `${progress}%` }} />
            </span>
          </button>
        );
      })}
    </nav>
  );
}
