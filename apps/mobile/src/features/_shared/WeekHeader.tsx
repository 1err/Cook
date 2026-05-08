import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatWeekPlannerKicker, formatWeekRangeDisplay } from "@cooking/shared";
import { IconButton } from "../../components";
import { colors, spacing, typography } from "../../theme";

type WeekHeaderProps = {
  start: string;
  end: string;
  isCurrentWeek: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Override the default kicker (`formatWeekPlannerKicker(start, end)`). */
  kicker?: string;
};

export function WeekHeader({
  start,
  end,
  isCurrentWeek,
  onPrev,
  onNext,
  onToday,
  kicker,
}: WeekHeaderProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>{kicker ?? formatWeekPlannerKicker(start, end)}</Text>
      <View style={styles.row}>
        <IconButton icon="chevron-back" accessibilityLabel="Previous week" onPress={onPrev} />
        <Text style={styles.title}>{formatWeekRangeDisplay(start, end)}</Text>
        <IconButton icon="chevron-forward" accessibilityLabel="Next week" onPress={onNext} />
      </View>
      {isCurrentWeek ? (
        <Text style={styles.todayHint}>This week</Text>
      ) : (
        <Text style={styles.todayLink} onPress={onToday} accessibilityRole="button">
          Jump to this week
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },
  kicker: {
    ...typography.footnote,
    color: colors.primary,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  title: {
    ...typography.title2,
    color: colors.onSurface,
    minWidth: 200,
    textAlign: "center",
  },
  todayHint: {
    ...typography.caption,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xs,
  },
  todayLink: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
});
