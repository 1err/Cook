import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { useRecipePage } from "../../lib/useRecipePage";
import { Button, EmptyState, TextField } from "../../components";
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
  const t = useT();
  const apiClient = useApiClient();
  const { userId } = route.params;
  const [search, setSearch] = useState("");
  const page = useRecipePage(userId, {q: search});
  const friendRecipes = page.items;
  const loading = page.loading && !friendRecipes.length;
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [savedSourceIds, setSavedSourceIds] = useState(new Set<string>());

  const handleCopy = useCallback(
    async (recipeId: string) => {
      setCopyingId(recipeId);
      try {
        await apiClient.users.copyFriendRecipe(userId, recipeId);
        setSavedSourceIds(prev => new Set(prev).add(recipeId));
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
      ListHeaderComponent={<View><TextField placeholder="Search recipes" value={search} onChangeText={setSearch} />{page.error ? <Text accessibilityRole="alert">{page.error}</Text> : null}</View>}
      ListFooterComponent={page.next ? <Button title={t("common.loadMoreRecipes")} disabled={page.loading} onPress={() => void page.more()} /> : null}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={
        friendRecipes.length === 0 ? styles.emptyContent : styles.listContent
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        loading ? <ActivityIndicator color={colors.primary} /> : <EmptyState
          icon="restaurant-outline"
          title={search.trim() ? "No matching recipes" : "This library is empty"}
          description="No recipes here yet."
        />
      }
      renderItem={({ item }) => {
        const owned = item.already_saved || savedSourceIds.has(item.id);
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
