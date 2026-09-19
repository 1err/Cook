import React, { useCallback, useEffect, useRef, useState } from "react";
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
  NativeStackScreenProps<LibraryStackParamList, "LibraryList">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Library">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

type LibraryView = "mine" | "catalog";

export function LibraryListScreen({ navigation }: Props) {
  const t = useT();
  const apiClient = useApiClient();
  const [view, setView] = useState<LibraryView>("mine");
  const [search, setSearch] = useState("");
  const page = useRecipePage(view, {q: search});
  const [savedPublicIds, setSavedPublicIds] = useState(new Map<string, number>());
  const copyVersion = useRef(0);
  const pendingCopies = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const loading = page.loading && !page.items.length;
  const refreshing = page.loading;
  const load = useCallback(async () => {
    const beforeRefresh = copyVersion.current;
    await page.refresh();
    // The refreshed page owns saved status for copies completed before it began.
    // Keep later copy completions: this response may predate their server write.
    setSavedPublicIds(previous => new Map([...previous].filter(([, version]) => version > beforeRefresh)));
  }, [page.refresh]);
  useEffect(() => { setSavedPublicIds(new Map()); }, [page.refresh]);
  useEffect(() => navigation.addListener("focus", () => void load()), [navigation, load]);

  const handleCopy = useCallback(
    async (recipeId: string) => {
      if (pendingCopies.current.has(recipeId)) return;
      pendingCopies.current.add(recipeId);
      setCopyingId(recipeId);
      setError(null);
      try {
        await apiClient.recipes.copyCatalog(recipeId);
        const version = ++copyVersion.current;
        setSavedPublicIds(prev => new Map(prev).set(recipeId, version));
        haptics.success();
      } catch (e) {
        haptics.error();
        setError(e instanceof Error ? e.message : "Couldn't add recipe");
      } finally {
        pendingCopies.current.delete(recipeId);
        setCopyingId(null);
      }
    },
    [apiClient],
  );



  const data = page.items;
  const visibleError = error || page.error;

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={data.length === 0 ? styles.emptyContent : styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={colors.primary} />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListFooterComponent={page.next ? <Button title={t("common.loadMoreRecipes")} disabled={page.loading} onPress={() => void page.more()} /> : null}
      ListHeaderComponent={
        <View>
        <TextField placeholder="Search recipes" value={search} onChangeText={setSearch} />
        <View style={styles.segmentRow}>
          <SegmentPill label="My Library" active={view === "mine"} onPress={() => setView("mine")} />
          <SegmentPill label="Public Library" active={view === "catalog"} onPress={() => setView("catalog")} />
        </View>
        {visibleError ? <Text accessibilityRole="alert">{visibleError}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        loading ? <ActivityIndicator color={colors.primary} /> : visibleError ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Couldn't load recipes"
            description={visibleError}
            actionLabel="Try again"
            onAction={() => void load()}
          />
        ) : search.trim() ? (
          <EmptyState title="No matching recipes" description="Try a different search." />
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
        const owned = item.already_saved || savedPublicIds.has(item.id);
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
