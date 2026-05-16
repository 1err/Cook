import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { type Recipe, formatIngredientQuantity, formatStepDuration } from "@cooking/shared";
import { useApiClient } from "../../lib/api";
import { EmptyState, IconButton } from "../../components";
import { resolveImageUrl } from "../../lib/imageUrl";
import { colors, radii, spacing, typography } from "../../theme";
import { haptics } from "../../lib/haptics";
import type {
  LibraryStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<LibraryStackParamList, "RecipeDetail">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Library">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

// FastAPI errors come through as raw JSON like {"detail":"Recipe not found"};
// pull out the human message so the user doesn't see braces and quotes.
function extractApiMessage(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // not JSON, fall through
  }
  return raw;
}

export function RecipeDetailScreen({ navigation, route }: Props) {
  const apiClient = useApiClient();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const row = await apiClient.recipes.get(route.params.recipeId);
        if (!cancelled) setRecipe(row);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load recipe");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiClient, route.params.recipeId]);

  useEffect(() => {
    let cancelled = false;
    apiClient.recipes
      .editorStatus()
      .then((res) => {
        if (!cancelled) setCanManage(res.can_manage);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const handleToggleCatalog = useCallback(async () => {
    if (!recipe) return;
    const next = !recipe.is_public_catalog;
    try {
      const updated = await apiClient.recipes.setCatalogVisibility(recipe.id, next);
      setRecipe(updated);
      haptics.success();
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't update", e instanceof Error ? e.message : "Please try again.");
    }
  }, [apiClient, recipe]);

  const handleDelete = useCallback(async () => {
    if (!recipe) return;
    try {
      await apiClient.recipes.remove(recipe.id);
      haptics.success();
      navigation.goBack();
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't delete", e instanceof Error ? e.message : "Please try again.");
    }
  }, [apiClient, navigation, recipe]);

  const confirmDelete = useCallback(() => {
    if (!recipe) return;
    const message = recipe.is_public_catalog
      ? "This recipe is in the Public Library. Deleting will also remove it from the catalog. Other users' copies are unaffected. This cannot be undone."
      : "This cannot be undone.";
    Alert.alert("Delete recipe?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void handleDelete() },
    ]);
  }, [handleDelete, recipe]);

  const presentActions = useCallback(() => {
    if (!recipe) return;
    const catalogLabel = recipe.is_public_catalog ? "Remove from public library" : "Add to public library";
    if (Platform.OS === "ios") {
      const options = canManage
        ? ["Cancel", "Edit recipe", catalogLabel, "Delete recipe"]
        : ["Cancel", "Edit recipe", "Delete recipe"];
      const destructiveButtonIndex = options.length - 1;
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0, destructiveButtonIndex },
        (index) => {
          if (index === 1) navigation.navigate("RecipeEdit", { recipeId: recipe.id });
          else if (canManage && index === 2) void handleToggleCatalog();
          else if (index === destructiveButtonIndex) confirmDelete();
        },
      );
    } else {
      const buttons = [
        { text: "Edit", onPress: () => navigation.navigate("RecipeEdit", { recipeId: recipe.id }) },
        ...(canManage ? [{ text: catalogLabel, onPress: () => void handleToggleCatalog() }] : []),
        { text: "Delete", style: "destructive" as const, onPress: confirmDelete },
        { text: "Cancel", style: "cancel" as const },
      ];
      Alert.alert(recipe.title, undefined, buttons);
    }
  }, [canManage, confirmDelete, handleToggleCatalog, navigation, recipe]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: recipe?.title ?? "Recipe",
      headerRight: recipe
        ? () => (
            <IconButton
              icon="ellipsis-horizontal"
              accessibilityLabel="Recipe actions"
              onPress={presentActions}
            />
          )
        : undefined,
    });
  }, [navigation, presentActions, recipe]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !recipe) {
    const cleanMessage = extractApiMessage(error ?? "");
    const notFound = !error || /not found|unavailable/i.test(cleanMessage);
    return (
      <View style={styles.center}>
        <EmptyState
          icon={notFound ? "trash-outline" : "alert-circle-outline"}
          title={notFound ? "Recipe unavailable" : "Couldn't load recipe"}
          description={
            notFound
              ? "This recipe may have been deleted. If it was on your planner, you can return and remove the chip."
              : cleanMessage
          }
          actionLabel="Back"
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {resolveImageUrl(recipe.thumbnail_url) ? (
        <Image source={{ uri: resolveImageUrl(recipe.thumbnail_url) }} style={styles.hero} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.hero, styles.heroPlaceholder]}>
          <Ionicons name="restaurant" size={56} color={colors.accent} />
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title}>{recipe.title}</Text>

        {recipe.description ? (
          <Text style={styles.description}>{recipe.description}</Text>
        ) : null}

        <View style={styles.metaCard}>
          {typeof recipe.total_time_minutes === "number" ? (
            <View style={styles.totalTimeChip}>
              <Text style={styles.totalTimeText}>⏱ {recipe.total_time_minutes} min</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Ingredients</Text>
            <Text style={styles.metaVal}>{recipe.ingredients.length}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Source</Text>
            <Text style={styles.metaVal}>{recipe.source_url ? "Imported" : "Library"}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ingredients</Text>
          {recipe.ingredients.length === 0 ? (
            <Text style={styles.subtle}>No ingredients listed.</Text>
          ) : (
            <View style={styles.list}>
              {recipe.ingredients.map((ingredient, index) => (
                <View key={`${ingredient.name}-${index}`} style={styles.ingredient}>
                  <View style={styles.bullet} />
                  <View style={styles.ingredientText}>
                    <Text style={styles.ingredientName}>{ingredient.name}</Text>
                    <Text style={styles.ingredientQty}>{formatIngredientQuantity(ingredient)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {(recipe.equipment ?? []).length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Equipment</Text>
            <View style={styles.list}>
              {recipe.equipment!.map((item, index) => (
                <View key={`${item}-${index}`} style={styles.ingredient}>
                  <View style={styles.bullet} />
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {(recipe.steps ?? []).length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Steps</Text>
            {recipe.steps!.map((step, index) => {
              const duration =
                step.duration_seconds && step.duration_seconds > 0
                  ? formatStepDuration(step.duration_seconds)
                  : "";
              return (
                <View key={index} style={styles.step}>
                  <View style={styles.stepHeader}>
                    <Text style={styles.stepIndex}>{index + 1}.</Text>
                    {duration ? (
                      <Text style={styles.stepChip}>⏱ {duration}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.stepText}>{step.text}</Text>
                  {step.image_url ? (
                    <Image
                      source={{ uri: resolveImageUrl(step.image_url) ?? step.image_url }}
                      style={styles.stepImage}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {(recipe.tips ?? []).length > 0 ? (
          <View style={[styles.card, styles.tipsCard]}>
            <Text style={styles.sectionTitle}>Tips</Text>
            <View style={styles.list}>
              {recipe.tips!.map((tip, index) => (
                <View key={`${tip}-${index}`} style={styles.ingredient}>
                  <View style={styles.bullet} />
                  <Text style={styles.bulletText}>{tip}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.recipePaper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.recipePaper },
  content: { paddingBottom: spacing["3xl"] },
  hero: { width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.accentSoft, borderBottomLeftRadius: radii.lg, borderBottomRightRadius: radii.lg },
  heroPlaceholder: { alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.recipeTitle, color: colors.onSurface, textAlign: "center" },
  metaCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.recipeCard,
    borderColor: colors.recipeLine,
    borderWidth: 1,
    borderRadius: radii.lg,
    gap: spacing.sm,
  },
  metaRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md },
  metaLabel: { ...typography.caption, color: colors.onSurfaceVariant, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  metaVal: { ...typography.body, color: colors.onSurface, fontWeight: "700" },
  totalTimeChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    backgroundColor: colors.accentSoft,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
  },
  totalTimeText: { ...typography.footnote, color: colors.accent, fontWeight: "700" },
  card: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.recipeCard,
    borderColor: colors.recipeLine,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  tipsCard: { borderLeftWidth: 4, borderLeftColor: colors.accent, backgroundColor: colors.tipsCallout },
  sectionTitle: { ...typography.title3, color: colors.onSurface, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.onSurfaceVariant, fontStyle: "italic", marginTop: spacing.md, textAlign: "center" },
  step: { marginTop: spacing.md },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepIndex: {
    ...typography.footnote,
    minWidth: 26,
    height: 26,
    lineHeight: 26,
    textAlign: "center",
    color: colors.white,
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    fontWeight: "800",
    overflow: "hidden",
  },
  stepChip: {
    ...typography.caption,
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  stepText: { ...typography.body, color: colors.onSurface, marginTop: spacing.xs },
  stepImage: { width: "100%", height: 220, borderRadius: radii.md, marginTop: spacing.sm },
  list: { gap: spacing.sm },
  ingredient: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.xs },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 9, marginRight: spacing.md },
  ingredientText: { flex: 1 },
  ingredientName: { ...typography.body, color: colors.onSurface },
  ingredientQty: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
  bulletText: { ...typography.body, color: colors.onSurface, flex: 1 },
  subtle: { ...typography.subhead, color: colors.onSurfaceVariant },
  error: { ...typography.body, color: colors.error },
});
