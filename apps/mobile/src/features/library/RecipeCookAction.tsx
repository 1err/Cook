import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CookingSession, Recipe } from "@cooking/shared";
import { Button } from "../../components";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { colors, spacing, typography } from "../../theme";

export function RecipeCookAction({
  recipe,
  onEditTutorial,
  onOpenCook,
}: {
  recipe: Recipe;
  onEditTutorial: () => void;
  onOpenCook: (dishId?: string) => void;
}) {
  const apiClient = useApiClient();
  const t = useT();
  const hasSteps = Boolean(recipe.steps?.length);
  const [session, setSession] = useState<CookingSession | null>(null);
  const [loading, setLoading] = useState(hasSteps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknownError, setUnknownError] = useState(false);

  useEffect(() => {
    if (!hasSteps) return;
    let cancelled = false;
    apiClient.cooking.active()
      .then((active) => {
        if (!cancelled) setSession(active);
      })
      .catch((caught) => {
        if (!cancelled) {
          if (caught instanceof Error) setError(caught.message);
          else setUnknownError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, hasSteps, recipe.id]);

  if (!hasSteps) {
    return <Button fullWidth onPress={onEditTutorial} title={t("cook.recipe.editTutorial")} variant="secondary" />;
  }

  const existingDish = session?.dishes.find((dish) => dish.recipe_id === recipe.id);
  async function begin() {
    if (existingDish) {
      onOpenCook(existingDish.id);
      return;
    }
    setBusy(true);
    setError(null);
    setUnknownError(false);
    try {
      if (session) await apiClient.cooking.addDishes(session.id, [recipe.id]);
      else await apiClient.cooking.create([recipe.id]);
      onOpenCook(undefined);
    } catch (caught) {
      if (caught instanceof Error) setError(caught.message);
      else setUnknownError(true);
    } finally {
      setBusy(false);
    }
  }

  const title = existingDish
    ? t("cook.recipe.open")
    : session ? t("cook.recipe.add") : t("cook.recipe.start");
  return (
    <View style={styles.wrap}>
      <Button disabled={loading} fullWidth loading={busy} onPress={() => void begin()} title={loading ? t("common.loading") : title} />
      {error || unknownError ? <Text accessibilityRole="alert" style={styles.error}>{error ?? t("cook.recipe.error")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.lg },
  error: { ...typography.footnote, color: colors.error, textAlign: "center" },
});
