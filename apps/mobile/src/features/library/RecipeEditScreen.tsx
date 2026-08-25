import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Recipe, RecipeStep } from "@cooking/shared";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { EmptyState } from "../../components";
import { colors } from "../../theme";
import type { LibraryStackParamList } from "../../navigation/types";
import { DraftRecipeEditor } from "../import/DraftRecipeEditor";

type Props = NativeStackScreenProps<LibraryStackParamList, "RecipeEdit">;

function copySteps(steps: RecipeStep[] | undefined): RecipeStep[] {
  return Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
}

function copyRecipe(recipe: Recipe): Recipe {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })),
    library_tags: recipe.library_tags ? [...recipe.library_tags] : undefined,
    steps: copySteps(recipe.steps),
    tips: recipe.tips ? [...recipe.tips] : undefined,
    equipment: recipe.equipment ? [...recipe.equipment] : undefined,
  };
}

export function RecipeEditScreen({ navigation, route }: Props) {
  const apiClient = useApiClient();
  const t = useT();
  const recipeId = route.params?.recipeId;
  const focus = route.params?.focus ?? "recipe";
  const tutorialOnly = focus === "tutorial";
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: tutorialOnly ? t("recipe.tutorial.edit") : "Edit recipe",
    });
  }, [navigation, t, tutorialOnly]);

  useEffect(() => {
    if (!recipeId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiClient.recipes.get(recipeId);
        if (!cancelled) setDraft(copyRecipe(data));
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load recipe");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiClient, recipeId]);

  const handleEstimate = useCallback(async () => {
    if (!draft || !recipeId || estimating || saving) return;
    const submittedSteps = copySteps(draft.steps);
    if (!submittedSteps.some((step) => step.duration_source === "fallback")) return;
    setSaveError(null);
    setEstimateError(null);
    setEstimating(true);
    try {
      const response = await apiClient.recipes.estimateTutorial(recipeId, submittedSteps);
      if (!Array.isArray(response.steps)) throw new Error("Invalid tutorial estimate");
      setDraft((current) => current
        ? { ...current, steps: copySteps(response.steps) }
        : current);
    } catch {
      setEstimateError(t("recipe.tutorial.editor.estimateError"));
    } finally {
      setEstimating(false);
    }
  }, [apiClient, draft, estimating, recipeId, saving, t]);

  const handleSave = useCallback(async () => {
    if (!draft || !recipeId || estimating || saving) return;
    const submittedDraft = copyRecipe(draft);
    setEstimateError(null);
    setSaving(true);
    setSaveError(null);
    try {
      if (tutorialOnly) {
        await apiClient.recipes.update(recipeId, {
          steps: copySteps(submittedDraft.steps),
        });
      } else {
        const cleanedIngredients = submittedDraft.ingredients.filter(
          (ingredient) => ingredient.name.trim().length > 0,
        );
        await apiClient.recipes.update(recipeId, {
          title: submittedDraft.title,
          thumbnail_url: submittedDraft.thumbnail_url,
          ingredients: cleanedIngredients,
          library_tags: submittedDraft.library_tags,
          description: submittedDraft.description,
          total_time_minutes: submittedDraft.total_time_minutes,
          steps: submittedDraft.steps,
          tips: submittedDraft.tips,
          equipment: submittedDraft.equipment,
        });
      }
      navigation.goBack();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn't save changes");
    } finally {
      setSaving(false);
    }
  }, [apiClient, draft, estimating, navigation, recipeId, saving, tutorialOnly]);

  if (!recipeId) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="alert-circle-outline"
          title="No recipe to edit"
          description="Open a recipe from your library, then tap Edit."
          actionLabel="Back"
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (loadError || !draft) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load recipe"
          description={loadError ?? "The recipe wasn't found."}
          actionLabel="Back"
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  const canEstimate = (draft.steps ?? []).some(
    (step) => step.duration_source === "fallback",
  );

  return (
    <DraftRecipeEditor
      allowImageEditing={!tutorialOnly}
      canEstimate={canEstimate}
      draft={draft}
      error={estimateError ?? saveError}
      estimating={estimating}
      focus={focus}
      onCancel={tutorialOnly ? () => navigation.goBack() : undefined}
      onChange={setDraft}
      onEstimate={tutorialOnly ? handleEstimate : undefined}
      onSave={handleSave}
      saveLabel={tutorialOnly ? undefined : "Save changes"}
      saving={saving}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
