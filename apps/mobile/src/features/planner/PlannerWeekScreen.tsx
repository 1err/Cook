import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { emptyMealPlanSlots, type MealType, type Recipe } from "@cooking/shared";
import { Button, EmptyState } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type {
  MainTabsParamList,
  PlannerStackParamList,
  RootStackParamList,
} from "../../navigation/types";
import { WeekHeader } from "../_shared/WeekHeader";
import { usePlannerWeek } from "./usePlannerWeek";
import { DayCard } from "./DayCard";
import { RecipePickerSheet, type RecipePickerSheetHandle } from "./RecipePickerSheet";

type Props = CompositeScreenProps<
  NativeStackScreenProps<PlannerStackParamList, "PlannerWeek">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Planner">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function PlannerWeekScreen({ navigation, route }: Props) {
  const weekStart = route.params?.weekStart;
  const { state, refresh, addRecipeToSlot, removeRecipeFromSlot, prev, next, today } =
    usePlannerWeek(weekStart);
  const sheetRef = useRef<RecipePickerSheetHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const recipeById = useMemo(() => {
    const map: Record<string, Recipe> = {};
    if (state.status === "ready" || state.status === "refreshing") {
      for (const r of state.data.recipes) map[r.id] = r;
    }
    return map;
  }, [state]);

  const setWeek = useCallback(
    (target: string) => {
      navigation.setParams({ weekStart: target });
    },
    [navigation],
  );

  const handleAddPress = useCallback((date: string, slot: MealType) => {
    sheetRef.current?.present({ date, slot });
  }, []);

  const handleOpenRecipe = useCallback(
    (recipeId: string) => {
      navigation.navigate("Library", { screen: "RecipeDetail", params: { recipeId } });
    },
    [navigation],
  );

  const handleRemoveRecipe = useCallback(
    (date: string, slot: MealType, recipeId: string) => {
      void removeRecipeFromSlot(date, slot, recipeId);
    },
    [removeRecipeFromSlot],
  );

  const handlePick = useCallback(
    (target: { date: string; slot: MealType }, recipeId: string) => {
      void addRecipeToSlot(target.date, target.slot, recipeId);
    },
    [addRecipeToSlot],
  );

  const handleImportRecipe = useCallback(() => {
    navigation.getParent()?.navigate("ImportModal");
  }, [navigation]);

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load planner"
          description={state.error}
          actionLabel="Try again"
          onAction={() => void refresh()}
        />
      </View>
    );
  }

  const { recipes, planByDate, bounds } = state.data;
  const isCurrentWeek = bounds.weekParam === today;

  const header = (
    <View>
      <WeekHeader
        start={bounds.start}
        end={bounds.end}
        isCurrentWeek={isCurrentWeek}
        onPrev={() => setWeek(prev)}
        onNext={() => setWeek(next)}
        onToday={() => setWeek(today)}
      />
      {recipes.length === 0 ? (
        <View style={styles.emptyLibraryHint}>
          <Text style={styles.emptyLibraryText}>
            Your library is empty — import a recipe to start planning.
          </Text>
          <Button title="Import a recipe" onPress={handleImportRecipe} variant="secondary" />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.flex}>
      <FlatList
        data={bounds.dates}
        keyExtractor={(date) => date}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        renderItem={({ item: date }) => (
          <DayCard
            date={date}
            isToday={date === today}
            slots={planByDate[date] ?? emptyMealPlanSlots()}
            recipeById={recipeById}
            onAddPress={(slot) => handleAddPress(date, slot)}
            onOpenRecipe={handleOpenRecipe}
            onRemoveRecipe={(slot, recipeId) => handleRemoveRecipe(date, slot, recipeId)}
          />
        )}
      />
      <RecipePickerSheet
        ref={sheetRef}
        recipes={recipes}
        onPick={handlePick}
        onImportRecipe={handleImportRecipe}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  listContent: {
    paddingBottom: spacing["2xl"],
  },
  emptyLibraryHint: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    gap: spacing.md,
  },
  emptyLibraryText: {
    ...typography.subhead,
    color: colors.onSurfaceVariant,
    textAlign: "center",
  },
});
