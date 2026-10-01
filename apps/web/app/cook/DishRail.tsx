"use client";

import {
  getEffectiveStepState,
  type CookingDish,
} from "@cooking/shared";
import { getActiveCookingTimer, getCookingStepPosition, getDisplayedCookingStep } from "./cookingStepPosition";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";

export function DishRail({
  dishes,
  focusedDishId,
  onFocus,
  viewedSteps = {},
}: {
  dishes: CookingDish[];
  viewedSteps?: Record<string, string>;
  focusedDishId: string | null;
  onFocus: (dishId: string) => void;
}) {
  const t = useT();
  return (
    <nav aria-label={t("cook.dishes.title")} className={styles.dishRail}>
      {dishes.map((dish) => {
        const step = getDisplayedCookingStep(dish, viewedSteps[dish.id]);
        const progress = getCookingStepPosition(dish, step?.id);
        const timer = getActiveCookingTimer(dish);
        const timerState = timer ? getEffectiveStepState(timer) : null;
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
            <span>{timerState === "needs_attention" ? t("cook.attention.needsAttention") : timerState === "timer_running" ? t("cook.dish.timerRunning") : timerState === "timer_paused" ? t("cook.timer.paused") : step ? t("cook.step.number", { current: dish.steps.findIndex(item => item.id === step.id) + 1, total: dish.steps.length }) : t("cook.navigation.noSteps")}</span>
            <span aria-hidden="true" className={styles.progressTrack}>
              <span style={{ inlineSize: `${progress}%` }} />
            </span>
          </button>
        );
      })}
    </nav>
  );
}
