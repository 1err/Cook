import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getWeekBounds,
  type MealPlanDay,
  MEAL_PLAN_SLOTS,
  type MealType,
  type Recipe,
} from "@cooking/shared";
import { Card } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";

const PREVIEW_ROWS = 4;
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

type PlanRow = {
  recipeId: string;
  title: string;
  slot: MealType;
  dayShort: string;
  date: string;
};

function buildPlannedMealRows(
  plans: MealPlanDay[],
  recipeById: Record<string, Recipe>,
  weekStart: string,
): PlanRow[] {
  const { dates } = getWeekBounds(weekStart);
  const dowByDate = new Map(dates.map((d, i) => [d, DOW_SHORT[i]]));
  const rows: PlanRow[] = [];
  for (const p of plans) {
    const dayShort = dowByDate.get(p.date) ?? "";
    if (!dayShort) continue;
    for (const slot of MEAL_PLAN_SLOTS) {
      for (const rid of p[slot] ?? []) {
        if (!rid?.trim()) continue;
        const title = recipeById[rid]?.title?.trim();
        if (!title) continue;
        rows.push({ recipeId: rid, title, slot, dayShort, date: p.date });
      }
    }
  }
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return MEAL_PLAN_SLOTS.indexOf(a.slot) - MEAL_PLAN_SLOTS.indexOf(b.slot);
  });
  return rows;
}

type PlannedMealsPreviewProps = {
  weekStart: string;
  mealPlans: MealPlanDay[];
  recipeById: Record<string, Recipe>;
  onOpenRecipe: (recipeId: string) => void;
};

export function PlannedMealsPreview({
  weekStart,
  mealPlans,
  recipeById,
  onOpenRecipe,
}: PlannedMealsPreviewProps) {
  const rows = useMemo(
    () => buildPlannedMealRows(mealPlans, recipeById, weekStart),
    [mealPlans, recipeById, weekStart],
  );
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, PREVIEW_ROWS);
  const moreCount = Math.max(0, rows.length - PREVIEW_ROWS);

  if (rows.length === 0) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Planned this week</Text>
      <View style={styles.list}>
        {visibleRows.map((row) => (
          <Pressable
            key={`${row.date}-${row.slot}-${row.recipeId}`}
            onPress={() => onOpenRecipe(row.recipeId)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {row.title}
              </Text>
              <View style={styles.chips}>
                <View style={[styles.chip, slotChipStyle(row.slot)]}>
                  <Text style={styles.chipText}>{SLOT_LABELS[row.slot]}</Text>
                </View>
                <View style={[styles.chip, styles.dayChip]}>
                  <Text style={styles.chipText}>{row.dayShort}</Text>
                </View>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        ))}
      </View>
      {moreCount > 0 && !expanded ? (
        <Pressable onPress={() => setExpanded(true)} style={styles.moreBtn}>
          <Text style={styles.moreBtnText}>+ {moreCount} more</Text>
        </Pressable>
      ) : null}
      {expanded && rows.length > PREVIEW_ROWS ? (
        <Pressable onPress={() => setExpanded(false)} style={styles.moreBtn}>
          <Text style={styles.moreBtnText}>Show fewer</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function slotChipStyle(slot: MealType) {
  switch (slot) {
    case "breakfast":
      return { backgroundColor: colors.primaryFixed };
    case "lunch":
      return { backgroundColor: colors.surfaceContainerHigh };
    case "dinner":
      return { backgroundColor: colors.successContainer };
  }
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.headline,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.headline, color: colors.onSurface },
  chips: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  dayChip: { backgroundColor: colors.surfaceContainer },
  chipText: { ...typography.caption, color: colors.onSurfaceVariant, fontWeight: "600" },
  moreBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  moreBtnText: { ...typography.subhead, color: colors.primary, fontWeight: "600" },
  pressed: { opacity: 0.85 },
});
