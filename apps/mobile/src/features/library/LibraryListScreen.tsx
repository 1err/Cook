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
import type { Recipe, RecipeSummary } from "@cooking/shared";
import { useAuth } from "../../lib/auth";
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

export function LibraryListScreen(props: Props) {
  const { user } = useAuth();
  return <LibraryListContent key={user?.id ?? "signed-out"} {...props} />;
}

function LibraryListContent({ navigation }: Props) {
  const t = useT();
  const apiClient = useApiClient();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [catalogVisited, setCatalogVisited] = useState(false);
  const [view, setView] = useState<LibraryView>("mine");
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [menuRecipes, setMenuRecipes] = useState<Recipe[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const menuLoadVersion = useRef(0);
  const beginSelection = async () => {
    const version = ++menuLoadVersion.current;
    setMenuLoading(true); setError(null);
    try {
      // Normal browsing stays paginated. An explicit menu action loads the full
      // owned library so Select all includes recipes beyond the visible page.
      const rows = await apiClient.recipes.list();
      if (!mounted.current || version !== menuLoadVersion.current) return;
      setMenuRecipes(rows); setSelecting(true);
    } catch {
      if (mounted.current && version === menuLoadVersion.current) setError(t("menu.selection.loadFailed"));
    } finally {
      if (mounted.current && version === menuLoadVersion.current) setMenuLoading(false);
    }
  };
  const minePage = useRecipePage("mine", { q: search });
  const catalogPage = useRecipePage("catalog", { q: search }, catalogVisited);
  const page = view === "mine" ? minePage : catalogPage;
  const [savedPublicIds, setSavedPublicIds] = useState(new Map<string, number>());
  const copyVersion = useRef(0);
  const pendingCopies = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const loading = page.loading && !page.items.length;
  const refreshing = page.loading;
  const load = useCallback(async () => {
    const beforeRefresh = copyVersion.current;
    const refreshed = await page.refresh();
    if (!mounted.current || !refreshed || view !== "catalog") return;
    // The refreshed page owns saved status for copies completed before it began.
    // Keep later copy completions: this response may predate their server write.
    setSavedPublicIds(previous => new Map([...previous].filter(([, version]) => version > beforeRefresh)));
  }, [page.refresh, view]);
  useEffect(() => { setSavedPublicIds(new Map()); }, [apiClient]);
  useEffect(() => navigation.addListener("focus", () => void load()), [navigation, load]);

  const handleCopy = useCallback(
    async (recipeId: string) => {
      if (pendingCopies.current.has(recipeId)) return;
      pendingCopies.current.add(recipeId);
      setCopyingId(recipeId);
      setError(null);
      try {
        await apiClient.recipes.copyCatalog(recipeId);
        if (!mounted.current) return;
        const version = ++copyVersion.current;
        setSavedPublicIds(prev => new Map(prev).set(recipeId, version));
        void minePage.refresh();
        haptics.success();
      } catch (e) {
        if (!mounted.current) return;
        haptics.error();
        setError(e instanceof Error ? e.message : "Couldn't add recipe");
      } finally {
        pendingCopies.current.delete(recipeId);
        if (mounted.current) setCopyingId(null);
      }
    },
    [apiClient, minePage.refresh],
  );



  const menuSelecting = selecting && view === "mine";
  const data = menuSelecting ? menuRecipes.filter(recipe => recipe.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : page.items;
  const visibleError = error || page.error;

  return (
    <FlatList<Recipe | RecipeSummary>
      data={data}
      numColumns={2}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={data.length === 0 ? styles.emptyContent : styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={colors.primary} />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListFooterComponent={!menuSelecting && page.next ? <Button title={t("common.loadMoreRecipes")} disabled={page.loading} onPress={() => void page.more()} /> : null}
      columnWrapperStyle={styles.columns}
      ListHeaderComponent={
        <View>
        <TextField placeholder="Search recipes" value={search} onChangeText={setSearch} />
        <View style={styles.segmentRow}>
          <SegmentPill label="My Library" active={view === "mine"} onPress={() => setView("mine")} />
          <SegmentPill label="Public Library" active={view === "catalog"} onPress={() => { setCatalogVisited(true); setView("catalog"); }} />
        </View>
        {view === "mine" && (selecting ? <View style={styles.menuControls}>
          <Text style={styles.menuCount} accessibilityLiveRegion="polite">{t("menu.selection.count", { count: selected.length })}</Text>
          <View style={styles.menuRow}>
            <Button title={t("menu.selection.selectAll")} variant="secondary" disabled={!menuRecipes.length} onPress={() => setSelected(menuRecipes.map(recipe => recipe.id))} />
            <Button title={t("menu.selection.clear")} variant="ghost" onPress={() => setSelected([])} />
          </View>
          <Button title={t("menu.selection.continue")} disabled={!selected.length} onPress={() => navigation.navigate("MenuMaker", { recipeIds: selected })} />
          <Button title={t("menu.close")} variant="ghost" onPress={() => { setSelecting(false); setSelected([]); }} />
        </View> : <View style={styles.menuControls}>
          <Button title={t("menu.make")} variant="secondary" loading={menuLoading} onPress={() => void beginSelection()} />
        </View>)}
        {visibleError ? <Text accessibilityRole="alert">{visibleError}</Text> : null}
        {page.error ? <Button title={t("library.retry")} disabled={page.loading} onPress={() => void load()} /> : null}
        </View>
      }
      ListEmptyComponent={
        loading ? <ActivityIndicator color={colors.primary} /> : visibleError ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Couldn't load recipes"
            description={visibleError}
          />
        ) : search.trim() ? (
          <EmptyState title="No matching recipes" description="Try a different search." />
        ) : view === "mine" ? (
          <EmptyState
            icon="restaurant-outline"
            title="No recipes yet"
            description={t("library.addRecipeDescription")}
            actionLabel={t("library.addRecipe")}
            onAction={() => navigation.navigate("ImportModal")}
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
              accessibilityRole={menuSelecting ? "checkbox" : "button"}
              accessibilityState={menuSelecting ? { checked: selected.includes(item.id) } : undefined}
              accessibilityLabel={menuSelecting ? t("menu.selection.selectDish", { name: item.title }) : item.title}
              onPress={() => menuSelecting ? setSelected(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id]) : navigation.navigate("RecipeDetail", { recipeId: item.id })}
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
                {menuSelecting && <Ionicons name={selected.includes(item.id) ? "checkbox" : "square-outline"} size={24} color={colors.primary} />}
              </View>
            </Pressable>
          );
        }
        const owned = ("already_saved" in item && item.already_saved) || savedPublicIds.has(item.id);
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
                  size="sm"
                  fullWidth
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
  menuControls: { marginBottom: spacing.md, gap: spacing.sm },
  menuRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  menuCount: { ...typography.footnote, color: colors.mutedInk },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  listContent: { paddingTop: spacing.md, paddingBottom: spacing["2xl"], paddingHorizontal: spacing.lg },
  emptyContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  columns: { justifyContent: "space-between" },
  separator: { height: spacing.md },
  segmentRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  segmentActive: { borderBottomColor: colors.terracotta },
  segmentPressed: { opacity: 0.85 },
  segmentLabel: { ...typography.headline, color: colors.onSurfaceVariant },
  segmentLabelActive: { color: colors.terracotta },
  card: {
    width: "48%",
    overflow: "hidden",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardPressed: { opacity: 0.92 },
  thumb: { width: "100%", aspectRatio: 1, backgroundColor: colors.primaryFixed },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  cardBody: { padding: spacing.md, gap: spacing.xs },
  cardTitle: { ...typography.title3, color: colors.onSurface, lineHeight: 25 },
  publicAction: { marginTop: spacing.sm },
});
