import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getEffectiveStepState, type CookingDish, type CookingStep } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";
import { formatCookingTime, getRemainingSeconds } from "./cookingTime";

type TimerItem = { dish: CookingDish; step: CookingStep };

export function TimerTray({ dishes }: { dishes: CookingDish[] }) {
  const t = useT();
  const [nowMs, setNowMs] = useState(Date.now());
  const timers: TimerItem[] = dishes.flatMap((dish) =>
    dish.steps
      .filter((step) => ["timer_running", "timer_paused", "needs_attention"].includes(getEffectiveStepState(step, nowMs)))
      .map((step) => ({ dish, step })),
  );
  const hasRunningTimer = timers.some(({ step }) => step.state === "timer_running");
  useEffect(() => {
    if (!hasRunningTimer) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [hasRunningTimer]);
  if (!timers.length) return null;

  return (
    <View style={styles.tray}>
      <Text style={styles.heading}>{t("cook.timer.tray")}</Text>
      <ScrollView contentContainerStyle={styles.row} horizontal showsHorizontalScrollIndicator={false}>
        {timers.map(({ dish, step }) => {
          const state = getEffectiveStepState(step, nowMs);
          const seconds = step.state === "timer_paused" ? step.paused_remaining_seconds ?? 0 : getRemainingSeconds(step.timer_ends_at, nowMs);
          const time = state === "needs_attention" ? t("cook.attention.needsAttention") : formatCookingTime(seconds);
          return (
            <View accessible accessibilityLabel={t("cook.timer.dishLabel", { dish: dish.title, time })} key={step.id} style={styles.timer}>
              <Text numberOfLines={1} style={styles.title}>{dish.title}</Text>
              <Text style={[styles.time, state === "needs_attention" && styles.attention]}>{time}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: { paddingTop: spacing.sm, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  heading: { ...typography.caption, color: colors.mutedInk, fontWeight: "700", paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  timer: { minWidth: 132, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.subtleSurface },
  title: { ...typography.subhead, color: colors.ink },
  time: { ...typography.headline, color: colors.terracotta, fontVariant: ["tabular-nums"] },
  attention: { color: colors.error },
});
