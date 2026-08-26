import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError } from "@cooking/api-client";
import type { CookingSession, MealPlanDay, MealType, Recipe } from "@cooking/shared";
import { Button, Screen, SegmentedControl, TextField } from "../../components";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];
const todayIso = () => new Date().toISOString().slice(0, 10);

export function CookSetup({
  onSessionCreated,
  onEditTutorial,
}: {
  onSessionCreated: (session: CookingSession) => void;
  onEditTutorial?: (recipeId: string) => void;
}) {
  const apiClient = useApiClient();
  const t = useT();
  const [mode, setMode] = useState<"planned" | "manual">("planned");
  const [date, setDate] = useState(todayIso);
  const [meal, setMeal] = useState<MealType>("dinner");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [plans, setPlans] = useState<MealPlanDay[]>([]);
  const [manualSelection, setManualSelection] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([apiClient.recipes.list(), apiClient.mealPlan.list(date, date)])
      .then(([nextRecipes, nextPlans]) => {
        if (!cancelled) {
          setRecipes(nextRecipes);
          setPlans(nextPlans);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("cook.error.title"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, date, t]);

  const plannedSelection = useMemo(() => {
    const plan = plans.find((item) => item.date === date);
    return [...new Set(plan?.[meal] ?? [])];
  }, [date, meal, plans]);
  const selected = mode === "planned" ? plannedSelection : manualSelection;
  const query = search.trim().toLocaleLowerCase();
  const visibleRecipes = recipes.filter((recipe) =>
    query ? recipe.title.toLocaleLowerCase().includes(query) : true,
  );

  function toggle(recipeId: string) {
    setManualSelection((current) =>
      current.includes(recipeId) ? current.filter((id) => id !== recipeId) : [...current, recipeId],
    );
  }

  async function start() {
    if (!selected.length) return;
    setBusy(true);
    setError(null);
    try {
      onSessionCreated(await apiClient.cooking.create(selected));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "active_session_exists") {
        Alert.alert(t("cook.conflict.title"), t("cook.conflict.message"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("cook.conflict.discard"),
            style: "destructive",
            onPress: () => void (async () => {
              const active = await apiClient.cooking.active();
              if (active) await apiClient.cooking.discard(active.id);
              onSessionCreated(await apiClient.cooking.create(selected));
            })(),
          },
          {
            text: t("cook.conflict.resume"),
            onPress: () => void apiClient.cooking.active().then((active) => {
              if (active) onSessionCreated(active);
            }),
          },
        ]);
      } else {
        setError(caught instanceof Error ? caught.message : t("cook.error.title"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <Text style={styles.title}>{t("cook.empty.title")}</Text>
      <Text style={styles.description}>{t("cook.empty.description")}</Text>
      <SegmentedControl
        label={t("cook.empty.title")}
        onChange={setMode}
        options={[
          { value: "planned", label: t("cook.setup.plannedMeal") },
          { value: "manual", label: t("cook.setup.chooseRecipes") },
        ]}
        value={mode}
      />

      {loading ? <Text accessibilityRole="text">{t("common.loading")}</Text> : mode === "planned" ? (
        <View style={styles.panel}>
          <TextField accessibilityLabel={t("cook.setup.plannedMeal")} label={t("cook.setup.plannedMeal")} onChangeText={setDate} value={date} />
          <SegmentedControl
            label={t("cook.setup.plannedMeal")}
            onChange={setMeal}
            options={MEALS.map((value) => ({ value, label: t(`cook.setup.${value}`) }))}
            value={meal}
          />
          {plannedSelection.length ? plannedSelection.map((recipeId) => (
            <Text key={recipeId} style={styles.recipeTitle}>{recipes.find((recipe) => recipe.id === recipeId)?.title ?? recipeId}</Text>
          )) : <Text style={styles.muted}>{t("cook.setup.noPlannedRecipes")}</Text>}
        </View>
      ) : (
        <View style={styles.panel}>
          <TextField accessibilityLabel={t("common.search")} label={t("common.search")} onChangeText={setSearch} value={search} />
          {visibleRecipes.map((recipe) => recipe.steps?.length ? (
            <Pressable
              accessibilityLabel={recipe.title}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: manualSelection.includes(recipe.id) }}
              key={recipe.id}
              onPress={() => toggle(recipe.id)}
              style={styles.choice}
            >
              <View style={[styles.checkbox, manualSelection.includes(recipe.id) && styles.checkboxSelected]} />
              <Text style={styles.recipeTitle}>{recipe.title}</Text>
            </Pressable>
          ) : (
            <View key={recipe.id} style={styles.choice}>
              <Text style={[styles.recipeTitle, styles.grow]}>{recipe.title}</Text>
              <Pressable
                accessibilityLabel={`${t("cook.setup.editTutorial")} ${recipe.title}`}
                accessibilityRole="button"
                onPress={() => onEditTutorial?.(recipe.id)}
                style={styles.editButton}
              >
                <Text style={styles.editText}>{t("cook.setup.editTutorial")}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button
        disabled={!selected.length}
        fullWidth
        loading={busy}
        onPress={() => void start()}
        title={t("cook.setup.startCount", { count: selected.length })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing["3xl"] },
  title: { ...typography.title1, color: colors.ink, textAlign: "center" },
  description: { ...typography.body, color: colors.mutedInk, textAlign: "center" },
  panel: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface },
  choice: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.divider },
  checkboxSelected: { borderColor: colors.terracotta, backgroundColor: colors.terracotta },
  recipeTitle: { ...typography.body, color: colors.ink },
  grow: { flex: 1 },
  muted: { ...typography.subhead, color: colors.mutedInk },
  editButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  editText: { ...typography.subhead, color: colors.terracotta, fontWeight: "700" },
  error: { ...typography.body, color: colors.error },
});
