import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { getCookingRecommendations, getCurrentCookingStep, isCookingSessionComplete, type CookingAction } from "@cooking/shared";
import { Button } from "../../components";
import { useT } from "../../lib/i18n";
import { colors, spacing, typography } from "../../theme";
import { DishSwitcher } from "./DishSwitcher";
import { FocusedCookingStep } from "./FocusedCookingStep";
import { TimerTray } from "./TimerTray";
import type { MobileCookingSessionController } from "./useCookingSession";
import { AddDishModal } from "./AddDishModal";
import { useCookingAlerts } from "./useCookingAlerts";
import { useScreenWake } from "./useScreenWake";

export function CookWorkspace({ controller }: { controller: MobileCookingSessionController }) {
  const t = useT();
  const isFocused = useIsFocused();
  const [adding, setAdding] = useState(false);
  const [undoTarget, setUndoTarget] = useState<{ dishId: string; stepId: string } | null>(null);
  const session = controller.session;
  const alertCopy = useMemo(() => ({
    permissionOff: t("cook.alerts.mobilePermissionOff"),
    title: t("cook.alerts.timerTitle"),
    body: (dish: string) => t("cook.alerts.timerBody", { dish }),
  }), [t]);
  const alerts = useCookingAlerts(
    session,
    controller.preferences,
    controller.updatePreferences,
    alertCopy,
  );
  useScreenWake(controller.preferences.keep_awake, Boolean(session) && isFocused);
  useEffect(() => {
    if (!undoTarget) return;
    const timeout = setTimeout(() => setUndoTarget(null), 10_000);
    return () => clearTimeout(timeout);
  }, [undoTarget]);
  if (!session) return null;
  const focusedDish = session.dishes.find((dish) => dish.id === controller.selectedDishId) ?? session.dishes[0];
  const recommendation = getCookingRecommendations(session)[0];
  const focusedStep = focusedDish ? getCurrentCookingStep(focusedDish) : null;
  const canTakeOverAlerts = Boolean(
    focusedDish &&
    focusedStep &&
    alerts.deviceId &&
    focusedStep.notification_owner_device_id &&
    focusedStep.notification_owner_device_id !== alerts.deviceId &&
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
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("cook.active.title")}</Text>
        {recommendation ? (
          <View style={styles.recommendation}>
            <Text style={styles.recommendationLabel}>{t("cook.recommendations.title")}</Text>
            <Text style={styles.recommendationText}>{t(recommendation.message_key, recommendation.message_params)}</Text>
          </View>
        ) : null}
        <DishSwitcher dishes={session.dishes} onSelect={controller.focusDish} selectedDishId={focusedDish?.id ?? null} />
        {controller.actionError ? <Text accessibilityRole="alert" style={styles.error}>{controller.actionError}</Text> : null}
        {controller.notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {t(controller.notice)}{controller.pendingCount ? ` ${t("cook.offline.pending", { count: controller.pendingCount })}` : ""}
          </Text>
        ) : null}
        {undoTarget ? (
          <View style={styles.undoNotice}>
            <Text accessibilityLiveRegion="polite" style={styles.limitation}>{t("cook.undo.available")}</Text>
            <Button
              onPress={() => applyStepAction(undoTarget.dishId, undoTarget.stepId, "reopen")}
              title={t("cook.action.undo")}
              variant="secondary"
            />
          </View>
        ) : null}
        {focusedDish ? (
          <FocusedCookingStep
            dish={focusedDish}
            onAction={(stepId, action, extensionSeconds) => {
              if (extensionSeconds === undefined) applyStepAction(focusedDish.id, stepId, action);
              else applyStepAction(focusedDish.id, stepId, action, extensionSeconds);
            }}
          />
        ) : null}
        {canTakeOverAlerts && focusedDish && focusedStep ? (
          <View style={styles.takeover}>
            <Text style={styles.limitation}>{t("cook.alerts.otherDevice")}</Text>
            <Button
              onPress={() => void controller.applyAction(focusedDish.id, focusedStep.id, "take_alert_ownership")}
              title={t("cook.alerts.takeOver")}
              variant="secondary"
            />
          </View>
        ) : null}
        <View style={styles.controls}>
          <View style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>{t("cook.alerts.enable")}</Text>
            <Switch
              accessibilityLabel={t("cook.alerts.enable")}
              onValueChange={(value) => void alerts.setAlertsEnabled(value)}
              value={alerts.enabled}
            />
          </View>
          {alerts.limitation ? <Text style={styles.limitation}>{alerts.limitation}</Text> : null}
          <View style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>{t("cook.alerts.sound")}</Text>
            <Switch
              accessibilityLabel={t("cook.alerts.sound")}
              onValueChange={(sound) => controller.updatePreferences({ sound })}
              value={controller.preferences.sound}
            />
          </View>
          <View style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>{t("cook.alerts.vibration")}</Text>
            <Switch
              accessibilityLabel={t("cook.alerts.vibration")}
              onValueChange={(vibration) => controller.updatePreferences({ vibration })}
              value={controller.preferences.vibration}
            />
          </View>
          <View style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>{t("cook.wake.enable")}</Text>
            <Switch
              accessibilityLabel={t("cook.wake.enable")}
              onValueChange={(keep_awake) => controller.updatePreferences({ keep_awake })}
              value={controller.preferences.keep_awake}
            />
          </View>
          <Button disabled={controller.sessionBusy} title={t("cook.control.addDish")} onPress={() => setAdding(true)} variant="secondary" />
          {focusedDish ? (
            <Button
              disabled={controller.sessionBusy}
              title={t("cook.control.removeDish", { dish: focusedDish.title })}
              onPress={() => Alert.alert(
                t("cook.control.removeDish", { dish: focusedDish.title }),
                t("cook.confirm.removeDish", { dish: focusedDish.title }),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("common.delete"), style: "destructive", onPress: () => void controller.removeDish(focusedDish.id) },
                ],
              )}
              variant="ghost"
            />
          ) : null}
          <Button disabled={controller.sessionBusy || !isCookingSessionComplete(session)} title={t("cook.control.finish")} onPress={() => void controller.finishSession()} />
          <Button
            disabled={controller.sessionBusy}
            title={t("cook.control.discard")}
            onPress={() => Alert.alert(t("cook.control.discard"), t("cook.confirm.discard"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("cook.control.discard"), style: "destructive", onPress: () => void controller.discardSession() },
            ])}
            variant="destructive"
          />
        </View>
      </ScrollView>
      <TimerTray dishes={session.dishes} />
      <AddDishModal
        existingRecipeIds={session.dishes.map((dish) => dish.recipe_id)}
        onAdd={controller.addDishes}
        onClose={() => setAdding(false)}
        visible={adding}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.lg, paddingBottom: spacing["2xl"] },
  title: { ...typography.title1, color: colors.ink, paddingHorizontal: spacing.lg },
  recommendation: { gap: spacing.xs, margin: spacing.lg, padding: spacing.lg, backgroundColor: colors.successContainer, borderRadius: 16 },
  recommendationLabel: { ...typography.caption, color: colors.sage, fontWeight: "700" },
  recommendationText: { ...typography.headline, color: colors.ink },
  error: { ...typography.body, color: colors.error, marginHorizontal: spacing.lg },
  notice: { ...typography.subhead, color: colors.sage, marginHorizontal: spacing.lg, padding: spacing.md, backgroundColor: colors.successContainer, borderRadius: 12 },
  controls: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  preferenceRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  preferenceLabel: { ...typography.body, color: colors.ink, flex: 1 },
  limitation: { ...typography.subhead, color: colors.mutedInk },
  takeover: { gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  undoNotice: { gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md },
});
