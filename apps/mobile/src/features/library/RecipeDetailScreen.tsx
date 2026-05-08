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
import { type Recipe, formatIngredientQuantity } from "@cooking/shared";
import { useApiClient } from "../../lib/api";
import { IconButton } from "../../components";
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
          else if (index === destructiveButtonIndex) {
            Alert.alert("Delete recipe?", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => void handleDelete() },
            ]);
          }
        },
      );
    } else {
      const buttons = [
        { text: "Edit", onPress: () => navigation.navigate("RecipeEdit", { recipeId: recipe.id }) },
        ...(canManage ? [{ text: catalogLabel, onPress: () => void handleToggleCatalog() }] : []),
        { text: "Delete", style: "destructive" as const, onPress: () => void handleDelete() },
        { text: "Cancel", style: "cancel" as const },
      ];
      Alert.alert(recipe.title, undefined, buttons);
    }
  }, [canManage, handleDelete, handleToggleCatalog, navigation, recipe]);

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
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || "Recipe not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {recipe.thumbnail_url ? (
        <Image source={{ uri: recipe.thumbnail_url }} style={styles.hero} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.hero, styles.heroPlaceholder]}>
          <Ionicons name="restaurant" size={56} color={colors.onPrimaryFixed} />
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title}>{recipe.title}</Text>
        <Text style={styles.metaPill}>
          {recipe.ingredients.length} {recipe.ingredients.length === 1 ? "ingredient" : "ingredients"}
        </Text>

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  content: { paddingBottom: spacing["3xl"] },
  hero: { width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.primaryFixed },
  heroPlaceholder: { alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.title1, color: colors.onSurface },
  metaPill: {
    ...typography.footnote,
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryFixed,
    color: colors.onPrimaryFixed,
    borderRadius: radii.full,
    fontWeight: "600",
  },
  sectionTitle: { ...typography.title3, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  ingredient: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.xs },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 9,
    marginRight: spacing.md,
  },
  ingredientText: { flex: 1 },
  ingredientName: { ...typography.body, color: colors.onSurface },
  ingredientQty: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
  subtle: { ...typography.subhead, color: colors.onSurfaceVariant },
  error: { ...typography.body, color: colors.error },
});
