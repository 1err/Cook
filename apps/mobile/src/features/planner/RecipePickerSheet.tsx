import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  type MealType,
  RECIPE_TAG_GROUPS,
  type Recipe,
  TAG_LABELS,
} from "@cooking/shared";
import { EmptyState, TextField } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import { useRecipePickerData, type TagFilter } from "./useRecipePickerData";

const SLOT_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dayIdx = dt.getDay();
  const mondayFirst = dayIdx === 0 ? 6 : dayIdx - 1;
  return `${WEEKDAYS[mondayFirst]} ${MONTHS[m - 1]} ${d}`;
}

export type RecipePickerTarget = { date: string; slot: MealType };

export type RecipePickerSheetHandle = {
  present: (target: RecipePickerTarget) => void;
  dismiss: () => void;
};

type RecipePickerSheetProps = {
  recipes: Recipe[];
  onPick: (target: RecipePickerTarget, recipeId: string) => void;
  onImportRecipe: () => void;
};

export const RecipePickerSheet = forwardRef<RecipePickerSheetHandle, RecipePickerSheetProps>(
  function RecipePickerSheet({ recipes, onPick, onImportRecipe }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    const [target, setTarget] = useState<RecipePickerTarget | null>(null);
    const { search, setSearch, tagFilter, setTagFilter, filtered } = useRecipePickerData(recipes);

    useImperativeHandle(ref, () => ({
      present: (next) => {
        setTarget(next);
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }));

    const snapPoints = useMemo(() => ["55%", "92%"], []);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.4} />
      ),
      [],
    );

    const handlePick = useCallback(
      (recipeId: string) => {
        if (!target) return;
        onPick(target, recipeId);
        sheetRef.current?.dismiss();
      },
      [onPick, target],
    );

    const tagChips = useMemo(() => {
      const chips: { id: TagFilter; label: string }[] = [{ id: "all", label: "All" }];
      for (const group of RECIPE_TAG_GROUPS) {
        for (const tag of group.tags) {
          chips.push({ id: tag.id, label: TAG_LABELS[tag.id] });
        }
      }
      return chips;
    }, []);

    const headerSubtitle = target
      ? `${SLOT_LABELS[target.slot]} · ${formatDateLabel(target.date)}`
      : "";

    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
      >
        <BottomSheetView style={styles.header}>
          <Text style={styles.headerTitle}>Add a recipe</Text>
          {target ? <Text style={styles.headerSub}>{headerSubtitle}</Text> : null}
        </BottomSheetView>
        <BottomSheetView style={styles.searchRow}>
          <TextField
            placeholder="Search your library"
            value={search}
            onChangeText={setSearch}
            leadingIcon="search"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </BottomSheetView>
        <BottomSheetView style={styles.chipsRow}>
          <BottomSheetFlatList
            horizontal
            data={tagChips}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
            renderItem={({ item }) => {
              const active = item.id === tagFilter;
              return (
                <Pressable
                  onPress={() => setTagFilter(item.id)}
                  style={({ pressed }) => [
                    styles.tagChip,
                    active && styles.tagChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.tagChipLabel, active && styles.tagChipLabelActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
          />
        </BottomSheetView>

        {recipes.length === 0 ? (
          <BottomSheetView style={styles.emptyWrap}>
            <EmptyState
              icon="restaurant-outline"
              title="No recipes yet"
              description="Import your first recipe, then come back here to plan your week."
              actionLabel="Import a recipe"
              onAction={() => {
                sheetRef.current?.dismiss();
                onImportRecipe();
              }}
            />
          </BottomSheetView>
        ) : (
          <BottomSheetFlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <EmptyState title="No matches" description="Try a different search term or filter." />
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handlePick(item.id)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                {item.thumbnail_url ? (
                  <Image source={{ uri: item.thumbnail_url }} style={styles.rowThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.rowThumb, styles.rowThumbPlaceholder]}>
                    <Ionicons name="restaurant" size={18} color={colors.onPrimaryFixed} />
                  </View>
                )}
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowSub}>
                    {item.ingredients.length}{" "}
                    {item.ingredients.length === 1 ? "ingredient" : "ingredients"}
                  </Text>
                </View>
                <Ionicons name="add-circle" size={26} color={colors.primary} />
              </Pressable>
            )}
          />
        )}
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: colors.surface },
  handle: { backgroundColor: colors.border },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.title2,
    color: colors.onSurface,
  },
  headerSub: {
    ...typography.subhead,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  searchRow: {
    paddingHorizontal: spacing.lg,
  },
  chipsRow: {
    paddingBottom: spacing.sm,
  },
  chipsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  tagChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tagChipActive: {
    backgroundColor: colors.primaryFixed,
    borderColor: colors.primary,
  },
  tagChipLabel: {
    ...typography.subhead,
    color: colors.onSurfaceVariant,
  },
  tagChipLabelActive: {
    color: colors.onPrimaryFixed,
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing["3xl"],
  },
  separator: { height: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  rowThumb: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.primaryFixed,
    marginRight: spacing.md,
  },
  rowThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.headline, color: colors.onSurface },
  rowSub: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
  emptyWrap: { paddingVertical: spacing.xl },
  pressed: { opacity: 0.85 },
});
