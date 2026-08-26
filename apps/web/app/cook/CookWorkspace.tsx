"use client";

import { useEffect, useMemo, useState } from "react";
import { getCookingRecommendations, getCurrentCookingStep, isCookingSessionComplete, type CookingAction } from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { DishRail } from "./DishRail";
import { FocusedCookingStep } from "./FocusedCookingStep";
import type { CookingSessionController } from "./useCookingSession";
import { AddDishDialog } from "./AddDishDialog";
import { useCookingAlerts } from "./useCookingAlerts";
import { useScreenWake } from "./useScreenWake";

export function CookWorkspace({ controller }: { controller: CookingSessionController }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [undoTarget, setUndoTarget] = useState<{ dishId: string; stepId: string } | null>(null);
  const session = controller.session;
  const alertCopy = useMemo(() => ({
    unsupported: t("cook.alerts.unsupported"),
    permissionOff: t("cook.alerts.permissionOff"),
    timerTitle: t("cook.alerts.timerTitle"),
    timerBody: (dish: string) => t("cook.alerts.timerBody", { dish }),
  }), [t]);
  const alerts = useCookingAlerts(
    session,
    controller.deviceId,
    controller.preferences,
    controller.updatePreferences,
    alertCopy,
  );
  const wake = useScreenWake(controller.preferences.keep_awake, Boolean(session));
  useEffect(() => {
    if (!undoTarget) return;
    const timeout = window.setTimeout(() => setUndoTarget(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [undoTarget]);
  if (!session) return null;
  const focusedDish = session.dishes.find((dish) => dish.id === controller.selectedDishId) ?? session.dishes[0];
  const recommendation = getCookingRecommendations(session)[0];
  const focusedStep = focusedDish ? getCurrentCookingStep(focusedDish) : null;
  const canTakeOverAlerts = Boolean(
    focusedDish &&
    focusedStep &&
    focusedStep.notification_owner_device_id &&
    focusedStep.notification_owner_device_id !== controller.deviceId &&
    ["timer_running", "timer_paused", "needs_attention"].includes(focusedStep.state),
  );

  function applyStepAction(
    dishId: string,
    stepId: string,
    action: CookingAction,
    extensionSeconds?: number,
  ) {
    if (action === "complete" || action === "skip") setUndoTarget({ dishId, stepId });
    if (action === "reopen") setUndoTarget(null);
    if (extensionSeconds === undefined) void controller.applyAction(dishId, stepId, action);
    else void controller.applyAction(dishId, stepId, action, extensionSeconds);
  }

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

      {controller.notice ? (
        <p className={styles.notice} role="status">
          {t(controller.notice)}
          {controller.pendingCount ? ` ${t("cook.offline.pending", { count: controller.pendingCount })}` : ""}
        </p>
      ) : null}
      {controller.actionError ? <p className={styles.error} role="alert">{controller.actionError}</p> : null}
      {undoTarget ? (
        <aside className={styles.undoNotice} role="status">
          <span>{t("cook.undo.available")}</span>
          <Button onClick={() => applyStepAction(undoTarget.dishId, undoTarget.stepId, "reopen")} variant="secondary">
            {t("cook.action.undo")}
          </Button>
        </aside>
      ) : null}
      {focusedDish ? (
        <FocusedCookingStep
          dish={focusedDish}
          onAction={(stepId, action, extensionSeconds) => {
            if (extensionSeconds === undefined) {
              applyStepAction(focusedDish.id, stepId, action);
            } else {
              applyStepAction(focusedDish.id, stepId, action, extensionSeconds);
            }
          }}
        />
      ) : null}
      {canTakeOverAlerts && focusedDish && focusedStep ? (
        <aside className={styles.takeover}>
          <span>{t("cook.alerts.otherDevice")}</span>
          <Button
            onClick={() => void controller.applyAction(focusedDish.id, focusedStep.id, "take_alert_ownership")}
            variant="secondary"
          >
            {t("cook.alerts.takeOver")}
          </Button>
        </aside>
      ) : null}
      <footer className={styles.sessionControls}>
        <label className={styles.preferenceControl}>
          <input checked={alerts.enabled} onChange={(event) => void alerts.setAlertsEnabled(event.target.checked)} type="checkbox" />
          <span>{t("cook.alerts.enable")}</span>
        </label>
        <label className={styles.preferenceControl}>
          <input
            checked={controller.preferences.sound}
            onChange={(event) => controller.updatePreferences({ sound: event.target.checked })}
            type="checkbox"
          />
          <span>{t("cook.alerts.sound")}</span>
        </label>
        <label className={styles.preferenceControl}>
          <input
            checked={controller.preferences.vibration}
            onChange={(event) => controller.updatePreferences({ vibration: event.target.checked })}
            type="checkbox"
          />
          <span>{t("cook.alerts.vibration")}</span>
        </label>
        <label className={styles.preferenceControl}>
          <input
            checked={controller.preferences.keep_awake}
            onChange={(event) => controller.updatePreferences({ keep_awake: event.target.checked })}
            type="checkbox"
          />
          <span>{t("cook.wake.enable")}</span>
        </label>
        {alerts.limitation ? <p className={styles.limitation}>{alerts.limitation}</p> : null}
        <p className={styles.limitation}>{t("cook.alerts.browserOpen")}</p>
        {wake.unsupported && controller.preferences.keep_awake ? <p className={styles.limitation}>{t("cook.wake.unsupported")}</p> : null}
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
