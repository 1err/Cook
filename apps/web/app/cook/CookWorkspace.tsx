"use client";

import { useMemo, useState } from "react";
import { getCookingRecommendations, getCurrentCookingStep, getEffectiveStepState, isCookingSessionComplete, type CookingAction } from "@cooking/shared";
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
  const [view, setView] = useState<"focused" | "all">("focused");
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
  if (!session) return null;
  const focusedDish = session.dishes.find((dish) => dish.id === controller.selectedDishId) ?? session.dishes[0];
  const recommendation = getCookingRecommendations(session)[0];
  const visibleDishes = view === "all" ? session.dishes : focusedDish ? [focusedDish] : [];
  const runningTimers = session.dishes.reduce((count, dish) => count + dish.steps.filter((step) => getEffectiveStepState(step) === "timer_running").length, 0);

  function applyStepAction(
    dishId: string,
    stepId: string,
    action: CookingAction,
    extensionSeconds?: number,
  ) {
    return extensionSeconds === undefined
      ? controller.applyAction(dishId, stepId, action)
      : controller.applyAction(dishId, stepId, action, extensionSeconds);
  }

  return (
    <section className={`${styles.workspace}${view === "all" ? ` ${styles.allDishesWorkspace}` : ""}`}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>{t("cook.active.eyebrow")}</p>
          <h1>{t("cook.active.title")}</h1>
          {view === "all" ? <p className={styles.sessionSummary}>
            {t(session.dishes.length === 1 ? "cook.session.oneDish" : "cook.session.dishes", { count: session.dishes.length })}
            {runningTimers ? ` · ${t(runningTimers === 1 ? "cook.session.oneTimer" : "cook.session.timers", { count: runningTimers })}` : ""}
          </p> : null}
        </div>
        {recommendation ? (
          <aside className={styles.recommendation}>
            <span>{t("cook.recommendations.title")}</span>
            <strong>{t(recommendation.message_key, recommendation.message_params)}</strong>
          </aside>
        ) : null}
      </header>

      <div className={styles.viewToolbar}>
        <div aria-label={t("cook.view.label")} className={styles.viewSwitch} role="group">
          <button aria-pressed={view === "focused"} onClick={() => setView("focused")} type="button">
            {t("cook.view.focused")}
          </button>
          <button aria-pressed={view === "all"} onClick={() => setView("all")} type="button">
            {t("cook.view.allDishes")}
          </button>
        </div>
        {view === "all" ? <p className={styles.viewHint}>{t("cook.view.hint")}</p> : null}
      </div>

      {view === "focused" ? (
        <DishRail
          dishes={session.dishes}
          focusedDishId={focusedDish?.id ?? null}
          onFocus={controller.focusDish}
        />
      ) : null}

      {controller.notice ? (
        <p className={styles.notice} role="status">
          {t(controller.notice)}
          {controller.pendingCount ? ` ${t("cook.offline.pending", { count: controller.pendingCount })}` : ""}
        </p>
      ) : null}
      {controller.actionError ? <p className={styles.error} role="alert">{controller.actionError}</p> : null}
      <div className={styles.stepList}>
        {visibleDishes.map((dish) => {
          const step = getCurrentCookingStep(dish);
          const canTakeOverAlerts = Boolean(
            step?.notification_owner_device_id &&
            step.notification_owner_device_id !== controller.deviceId &&
            ["timer_running", "timer_paused", "needs_attention"].includes(step.state),
          );
          return (
            <FocusedCookingStep
              dish={dish}
              key={dish.id}
              layout={view === "all" ? "stacked" : "focused"}
              onAction={(stepId, action, extensionSeconds) => applyStepAction(dish.id, stepId, action, extensionSeconds)}
              onFocus={view === "all" ? () => {
                controller.focusDish(dish.id);
                setView("focused");
              } : undefined}
              showAlertTakeover={canTakeOverAlerts}
            />
          );
        })}
      </div>
      <footer className={styles.sessionControls}>
        <details className={styles.preferencePanel}>
          <summary>{t("cook.preferences")}</summary>
          <div className={styles.preferenceGrid}>
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
          </div>
        </details>
        <div className={styles.sessionActions}>
          <Button disabled={controller.sessionBusy} onClick={() => setAdding(true)} variant="secondary">
            {t("cook.control.addDish")}
          </Button>
          {view === "focused" && focusedDish ? (
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
            variant={view === "all" ? "ghost" : "destructive"}
          >
            {t("cook.control.discard")}
          </Button>
        </div>
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
