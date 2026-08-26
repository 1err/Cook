import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  getCurrentCookingStep,
  getDishProgress,
  getEffectiveStepState,
  type CookingAction,
  type CookingDish,
} from "@cooking/shared";
import { Button, RecipeStepIllustration } from "../../components";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";
import { CookingTimerRing } from "./CookingTimerRing";

export function FocusedCookingStep({
  dish,
  onAction,
}: {
  dish: CookingDish;
  onAction: (stepId: string, action: CookingAction, extensionSeconds?: number) => void;
}) {
  const t = useT();
  const step = getCurrentCookingStep(dish);
  if (!step) {
    const last = [...dish.steps].reverse().find((item) => item.state === "completed" || item.state === "skipped");
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{dish.title}</Text>
        <Text style={styles.body}>{t("cook.dish.complete")}</Text>
        {last ? <Button title={t("cook.action.reopen")} onPress={() => onAction(last.id, "reopen")} variant="secondary" /> : null}
      </View>
    );
  }
  const state = getEffectiveStepState(step);
  const timerActive = ["timer_running", "timer_paused", "needs_attention"].includes(state);
  const badge = state === "needs_attention"
    ? t("cook.attention.needsAttention")
    : step.attention_type === "passive" ? t("cook.attention.passive") : t("cook.attention.handsOn");

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{t("cook.step.number", { current: step.position + 1, total: dish.steps.length })}</Text>
      <Text style={styles.title}>{dish.title}</Text>
      <Text style={[styles.badge, state === "needs_attention" && styles.attention]}>{badge}</Text>
      <RecipeStepIllustration actionType={step.action_type} size={116} title={step.text} />
      <Text style={styles.instruction}>{step.text}</Text>
      {timerActive ? <CookingTimerRing step={{ ...step, state }} /> : null}
      <View style={styles.actions}>
        {step.attention_type === "passive" && state === "ready" ? <Button title={t("cook.action.startTimer")} onPress={() => onAction(step.id, "start_timer")} /> : null}
        {state === "timer_running" ? <Button title={t("cook.action.pause")} onPress={() => onAction(step.id, "pause_timer")} variant="secondary" /> : null}
        {state === "timer_paused" ? <Button title={t("cook.action.resume")} onPress={() => onAction(step.id, "resume_timer")} variant="secondary" /> : null}
        {timerActive ? <Button title={t("cook.action.extend")} onPress={() => onAction(step.id, "extend_timer", 60)} variant="secondary" /> : null}
        <Button title={t("cook.action.complete")} onPress={() => onAction(step.id, "complete")} />
        <Button title={t("cook.action.skip")} onPress={() => onAction(step.id, "skip")} variant="ghost" />
      </View>
      <Text style={styles.progress}>{t("cook.progress", { progress: getDishProgress(dish) })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, margin: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface },
  kicker: { ...typography.caption, color: colors.terracotta, fontWeight: "700" },
  title: { ...typography.title1, color: colors.ink },
  badge: { ...typography.footnote, color: colors.sage, fontWeight: "700", alignSelf: "flex-start" },
  attention: { color: colors.error },
  instruction: { ...typography.title3, color: colors.ink, lineHeight: 30 },
  body: { ...typography.body, color: colors.mutedInk },
  actions: { gap: spacing.sm },
  progress: { ...typography.footnote, color: colors.mutedInk, fontWeight: "700" },
});
