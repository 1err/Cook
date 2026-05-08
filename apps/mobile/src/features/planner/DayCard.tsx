import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { MEAL_PLAN_SLOTS, type MealPlanSlots, type MealType, type Recipe } from "@cooking/shared";
import { Card } from "../../components";
import { colors, spacing, typography } from "../../theme";
import { SlotRow } from "./SlotRow";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDayHeader(date: string): { weekday: string; sub: string } {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dayIdx = dt.getDay();
  // Map JS Sun=0..Sat=6 to Mon-first index.
  const mondayFirst = dayIdx === 0 ? 6 : dayIdx - 1;
  return { weekday: WEEKDAYS[mondayFirst], sub: `${MONTHS[m - 1]} ${d}` };
}

type DayCardProps = {
  date: string;
  isToday: boolean;
  slots: MealPlanSlots;
  recipeById: Record<string, Recipe>;
  onAddPress: (slot: MealType) => void;
  onOpenRecipe: (recipeId: string) => void;
  onRemoveRecipe: (slot: MealType, recipeId: string) => void;
};

export function DayCard({
  date,
  isToday,
  slots,
  recipeById,
  onAddPress,
  onOpenRecipe,
  onRemoveRecipe,
}: DayCardProps) {
  const { weekday, sub } = formatDayHeader(date);
  return (
    <Card style={[styles.card, isToday && styles.todayCard] as any} elevated>
      <View style={styles.header}>
        <Text style={[styles.weekday, isToday && styles.todayText]}>{weekday}</Text>
        <Text style={[styles.sub, isToday && styles.todayText]}>{sub}</Text>
        {isToday ? <Text style={styles.todayPill}>Today</Text> : null}
      </View>
      <View style={styles.slotList}>
        {MEAL_PLAN_SLOTS.map((slot) => (
          <SlotRow
            key={slot}
            slot={slot}
            recipeIds={slots[slot]}
            recipeById={recipeById}
            onAddPress={() => onAddPress(slot)}
            onOpenRecipe={onOpenRecipe}
            onRemoveRecipe={(recipeId) => onRemoveRecipe(slot, recipeId)}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
  },
  todayCard: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  weekday: {
    ...typography.headline,
    color: colors.onSurface,
  },
  sub: {
    ...typography.subhead,
    color: colors.onSurfaceVariant,
  },
  todayText: {
    color: colors.primary,
  },
  todayPill: {
    ...typography.caption,
    color: colors.onPrimary,
    fontWeight: "700",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
    marginLeft: "auto",
  },
  slotList: {
    gap: spacing.xs,
  },
});
