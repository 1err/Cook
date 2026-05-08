import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Recipe } from "@cooking/shared";
import { useApiClient } from "../../lib/api";
import { EmptyState } from "../../components";
import { colors } from "../../theme";
import type { LibraryStackParamList } from "../../navigation/types";
import { DraftRecipeEditor } from "../import/DraftRecipeEditor";

type Props = NativeStackScreenProps<LibraryStackParamList, "RecipeEdit">;

export function RecipeEditScreen({ navigation, route }: Props) {
  const apiClient = useApiClient();
  const recipeId = route.params?.recipeId;
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Edit recipe" });
  }, [navigation]);

  useEffect(() => {
    if (!recipeId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiClient.recipes.get(recipeId);
        if (!cancelled) setDraft(data);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load recipe");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiClient, recipeId]);

  const handleSave = useCallback(async () => {
    if (!draft || !recipeId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const cleanedIngredients = draft.ingredients.filter((i) => i.name.trim().length > 0);
      await apiClient.recipes.update(recipeId, {
        title: draft.title,
        thumbnail_url: draft.thumbnail_url,
        ingredients: cleanedIngredients,
        library_tags: draft.library_tags,
      });
      navigation.goBack();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save changes");
    } finally {
      setSaving(false);
    }
  }, [apiClient, draft, navigation, recipeId]);

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

  return (
    <DraftRecipeEditor
      draft={draft}
      onChange={setDraft}
      saving={saving}
      error={saveError}
      onSave={handleSave}
      saveLabel="Save changes"
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});
