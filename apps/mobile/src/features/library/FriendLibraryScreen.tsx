import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
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
  NativeStackScreenProps<LibraryStackParamList, "FriendLibrary">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Library">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function FriendLibraryScreen({ route }: Props) {
  const apiClient = useApiClient();
  const { userId } = route.params;
  const [friendRecipes, setFriendRecipes] = useState<Recipe[]>([]);
  const [myRecipes, setMyRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    try {
      const [theirs, mine] = await Promise.all([
        apiClient.users.libraryRecipes(userId),
        apiClient.recipes.list(),
      ]);
      setFriendRecipes(theirs);
      setMyRecipes(mine);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      // 404 is uniform "library not found" (private or no longer exists). Treat
      // any other error the same way for now — single empty state, no error UI.
      void message;
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [apiClient, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    myRecipes.forEach((r) => {
      ids.add(r.id);
      if (r.catalog_source_recipe_id) ids.add(r.catalog_source_recipe_id);
    });
    return ids;
  }, [myRecipes]);

  const handleCopy = useCallback(
    async (recipeId: string) => {
      setCopyingId(recipeId);
      try {
        const copy = await apiClient.users.copyFriendRecipe(userId, recipeId);
        setMyRecipes((prev) => (prev.some((r) => r.id === copy.id) ? prev : [copy, ...prev]));
        haptics.success();
      } catch (e) {
        haptics.error();
        const message = e instanceof Error ? e.message : "";
        if (/not found|404/i.test(message)) {
          setUnavailable(true);
        }
      } finally {
        setCopyingId(null);
      }
    },
    [apiClient, userId],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (unavailable) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="lock-closed-outline"
          title="Library is no longer public"
          description="The owner may have turned off sharing. Try again later."
        />
      </View>
    );
  }

  return (
    <FlatList
      data={friendRecipes}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={
        friendRecipes.length === 0 ? styles.emptyContent : styles.listContent
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        <EmptyState
          icon="restaurant-outline"
          title="This library is empty"
          description="No recipes here yet."
        />
      }
      renderItem={({ item }) => {
        const owned = savedSourceIds.has(item.id);
        const url = resolveImageUrl(item.thumbnail_url);
        return (
          <View style={styles.card}>
            {url ? (
              <Image
                source={{ uri: url }}
                style={styles.thumb}
                contentFit="cover"
                transition={150}
              />
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
              <View style={styles.action}>
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

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  listContent: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  emptyContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  separator: { height: spacing.sm },
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
  thumb: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.primaryFixed },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, marginHorizontal: spacing.md },
  cardTitle: { ...typography.headline, color: colors.onSurface },
  action: { marginTop: spacing.sm, alignSelf: "flex-start" },
});
