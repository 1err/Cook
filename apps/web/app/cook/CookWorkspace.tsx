"use client";

import { useState } from "react";
import { getCookingRecommendations, isCookingSessionComplete } from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { DishRail } from "./DishRail";
import { FocusedCookingStep } from "./FocusedCookingStep";
import type { CookingSessionController } from "./useCookingSession";
import { AddDishDialog } from "./AddDishDialog";

export function CookWorkspace({ controller }: { controller: CookingSessionController }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const session = controller.session;
  if (!session) return null;
  const focusedDish = session.dishes.find((dish) => dish.id === controller.selectedDishId) ?? session.dishes[0];
  const recommendation = getCookingRecommendations(session)[0];

  return (
    <section className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>{t("cook.active.eyebrow")}</p>
          <h1>{t("cook.active.title")}</h1>
        </div>
        {recommendation ? (
          <aside className={styles.recommendation}>
            <span>{t("cook.recommendations.title")}</span>
            <strong>{t(recommendation.message_key, recommendation.message_params)}</strong>
          </aside>
        ) : null}
      </header>

      <DishRail
        dishes={session.dishes}
        focusedDishId={focusedDish?.id ?? null}
        onFocus={controller.focusDish}
      />

      {controller.actionError ? <p className={styles.error} role="alert">{controller.actionError}</p> : null}
      {focusedDish ? (
        <FocusedCookingStep
          dish={focusedDish}
          onAction={(stepId, action, extensionSeconds) => {
            if (extensionSeconds === undefined) {
              void controller.applyAction(focusedDish.id, stepId, action);
            } else {
              void controller.applyAction(focusedDish.id, stepId, action, extensionSeconds);
            }
          }}
        />
      ) : null}
      <footer className={styles.sessionControls}>
        <Button disabled={controller.sessionBusy} onClick={() => setAdding(true)} variant="secondary">
          {t("cook.control.addDish")}
        </Button>
        {focusedDish ? (
          <Button
            disabled={controller.sessionBusy}
            onClick={() => {
              if (window.confirm(t("cook.confirm.removeDish", { dish: focusedDish.title }))) {
                void controller.removeDish(focusedDish.id);
              }
            }}
            variant="ghost"
          >
            {t("cook.control.removeDish", { dish: focusedDish.title })}
          </Button>
        ) : null}
        <Button
          disabled={controller.sessionBusy || !isCookingSessionComplete(session)}
          onClick={() => void controller.finishSession()}
        >
          {t("cook.control.finish")}
        </Button>
        <Button
          disabled={controller.sessionBusy}
          onClick={() => {
            if (window.confirm(t("cook.confirm.discard"))) void controller.discardSession();
          }}
          variant="destructive"
        >
          {t("cook.control.discard")}
        </Button>
      </footer>
      {adding ? (
        <AddDishDialog
          existingRecipeIds={session.dishes.map((dish) => dish.recipe_id)}
          onAdd={controller.addDishes}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <p aria-live="polite" className={styles.liveRegion} />
    </section>
  );
}
