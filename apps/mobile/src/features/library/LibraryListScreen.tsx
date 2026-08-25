import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { Recipe } from "@cooking/shared";
import { useApiClient } from "../../lib/api";
import { Button, EmptyState } from "../../components";
import { haptics } from "../../lib/haptics";
import { resolveImageUrl } from "../../lib/imageUrl";
import { colors, radii, spacing, typography } from "../../theme";
import type {
  LibraryStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";
import { RecipeListMeta } from "./RecipeListMeta";

type Props = CompositeScreenProps<
  NativeStackScreenProps<LibraryStackParamList, "LibraryList">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Library">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

type LibraryView = "mine" | "catalog";

export function LibraryListScreen({ navigation }: Props) {
  const apiClient = useApiClient();
  const [view, setView] = useState<LibraryView>("mine");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [publicRecipes, setPublicRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [mine, pub] = await Promise.all([
          apiClient.recipes.list(),
          apiClient.recipes.catalog(),
        ]);
        setRecipes(mine);
        setPublicRecipes(pub);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load recipes");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiClient],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  // Refetch own library when returning to the screen so newly imported / catalog-copied recipes appear.
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      apiClient.recipes
        .list()
        .then(setRecipes)
        .catch(() => undefined);
    });
    return unsubscribe;
  }, [navigation, apiClient]);

  const savedPublicIds = useMemo(() => {
    const ids = new Set<string>();
    recipes.forEach((recipe) => {
      ids.add(recipe.id);
      if (recipe.catalog_source_recipe_id) ids.add(recipe.catalog_source_recipe_id);
    });
    return ids;
  }, [recipes]);

  const handleCopy = useCallback(
    async (recipeId: string) => {
      setCopyingId(recipeId);
      setError(null);
      try {
        const copy = await apiClient.recipes.copyCatalog(recipeId);
        // Optimistic local insert, then a server-confirmed refetch so we never
        // show a stale list (e.g., if a previous focus listener raced this).
        setRecipes((prev) => (prev.some((row) => row.id === copy.id) ? prev : [copy, ...prev]));
        haptics.success();
        try {
          const fresh = await apiClient.recipes.list();
          setRecipes(fresh);
        } catch {
          // Refetch is best-effort; the optimistic insert above keeps the UI consistent.
        }
      } catch (e) {
        haptics.error();
        setError(e instanceof Error ? e.message : "Couldn't add recipe");
      } finally {
        setCopyingId(null);
      }
    },
    [apiClient],
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const data = view === "mine" ? recipes : publicRecipes;

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={data.length === 0 ? styles.emptyContent : styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={colors.primary} />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.segmentRow}>
          <SegmentPill label="My Library" active={view === "mine"} onPress={() => setView("mine")} />
          <SegmentPill label="Public Library" active={view === "catalog"} onPress={() => setView("catalog")} />
        </View>
      }
      ListEmptyComponent={
        error ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Couldn't load recipes"
            description={error}
            actionLabel="Try again"
            onAction={() => void load("initial")}
          />
        ) : view === "mine" ? (
          <EmptyState
            icon="restaurant-outline"
            title="No recipes yet"
            description="Tap + to import your first recipe from a YouTube video or pasted transcript."
          />
        ) : (
          <EmptyState
            icon="globe-outline"
            title="No public recipes yet"
            description="Public recipes shared by the community will appear here."
          />
        )
      }
      renderItem={({ item }) => {
        if (view === "mine") {
          return (
            <Pressable
              onPress={() => navigation.navigate("RecipeDetail", { recipeId: item.id })}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              {resolveImageUrl(item.thumbnail_url) ? (
                <Image source={{ uri: resolveImageUrl(item.thumbnail_url) }} style={styles.thumb} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Ionicons name="restaurant" size={28} color={colors.onPrimaryFixed} />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <RecipeListMeta recipe={item} />
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
            </Pressable>
          );
        }
        const owned = savedPublicIds.has(item.id);
        return (
          <View style={styles.card}>
            {item.thumbnail_url ? (
              <Image source={{ uri: item.thumbnail_url }} style={styles.thumb} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="restaurant" size={28} color={colors.onPrimaryFixed} />
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <RecipeListMeta recipe={item} />
              <View style={styles.publicAction}>
                <Button
                  title={owned ? "In your library" : "Add to library"}
                  onPress={() => void handleCopy(item.id)}
                  variant={owned ? "secondary" : "primary"}
                  loading={copyingId === item.id}
                  disabled={owned}
                />
              </View>
            </View>
          </View>
        );
      }}
    />
  );
}

function SegmentPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.segment,
        active && styles.segmentActive,
        pressed && !active && styles.segmentPressed,
      ]}
    >
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  listContent: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  emptyContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  separator: { height: spacing.sm },
  segmentRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: 4,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radii.sm,
  },
  segmentActive: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.divider },
  segmentPressed: { opacity: 0.85 },
  segmentLabel: { ...typography.headline, color: colors.onSurfaceVariant },
  segmentLabelActive: { color: colors.onSurface },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  cardPressed: { opacity: 0.92 },
  thumb: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.primaryFixed },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, marginHorizontal: spacing.md },
  cardTitle: { ...typography.headline, color: colors.onSurface },
  publicAction: { marginTop: spacing.sm, alignSelf: "flex-start" },
});
