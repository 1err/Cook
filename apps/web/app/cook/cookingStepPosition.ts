import { getCurrentCookingStep, getEffectiveStepState, type CookingDish } from "@cooking/shared";

export function getActiveCookingTimer(dish: CookingDish) {
  const step = dish.steps.find(item => ["timer_running", "timer_paused", "needs_attention"].includes(getEffectiveStepState(item)));
  return step ? { ...step, state: getEffectiveStepState(step) } : null;
}

export function getDisplayedCookingStep(dish: CookingDish, viewedStepId?: string | null) {
  return dish.steps.find(item => item.id === viewedStepId) ?? getActiveCookingTimer(dish) ?? getCurrentCookingStep(dish) ?? dish.steps[0] ?? null;
}

export function getCookingStepPosition(dish: CookingDish, stepId?: string | null): number {
  const step = getDisplayedCookingStep(dish, stepId);
  const index = dish.steps.findIndex(item => item.id === step?.id);
  return index < 0 ? 0 : Math.round(((index + 1) / dish.steps.length) * 100);
}
