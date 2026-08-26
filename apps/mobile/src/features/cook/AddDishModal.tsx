import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Recipe } from "@cooking/shared";
import { Button } from "../../components";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";

export function AddDishModal({
  existingRecipeIds,
  onAdd,
  onClose,
  visible,
}: {
  existingRecipeIds: string[];
  onAdd: (recipeIds: string[]) => Promise<void>;
  onClose: () => void;
  visible: boolean;
}) {
  const apiClient = useApiClient();
  const t = useT();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    apiClient.recipes.list()
      .then((items) => {
        if (!cancelled) setRecipes(items);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, visible]);

  const choices = useMemo(
    () => recipes.filter((recipe) => recipe.steps?.length && !existingRecipeIds.includes(recipe.id)),
    [existingRecipeIds, recipes],
  );

  async function submit() {
    if (!selected.length) return;
    setBusy(true);
    await onAdd(selected);
    setBusy(false);
    setSelected([]);
    onClose();
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.sheet}>
          <Text style={styles.title}>{t("cook.add.title")}</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {loading ? <Text style={styles.muted}>{t("common.loading")}</Text> : choices.map((recipe) => {
              const checked = selected.includes(recipe.id);
              return (
                <Pressable
                  accessibilityLabel={recipe.title}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  key={recipe.id}
                  onPress={() => setSelected((current) =>
                    checked ? current.filter((id) => id !== recipe.id) : [...current, recipe.id]
                  )}
                  style={styles.choice}
                >
                  <View style={[styles.checkbox, checked && styles.checked]} />
                  <Text style={styles.recipe}>{recipe.title}</Text>
                </Pressable>
              );
            })}
            {!loading && !choices.length ? <Text style={styles.muted}>{t("cook.add.empty")}</Text> : null}
          </ScrollView>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Button disabled={busy} onPress={onClose} title={t("common.cancel")} variant="secondary" />
            <Button disabled={!selected.length} loading={busy} onPress={() => void submit()} title={t("cook.add.confirm")} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(47,38,33,0.42)" },
  sheet: { maxHeight: "82%", gap: spacing.lg, padding: spacing.xl, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, backgroundColor: colors.surface },
  title: { ...typography.title2, color: colors.ink },
  list: { gap: spacing.sm },
  choice: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderColor: colors.divider, borderRadius: 6 },
  checked: { borderColor: colors.terracotta, backgroundColor: colors.terracotta },
  recipe: { ...typography.body, color: colors.ink },
  muted: { ...typography.body, color: colors.mutedInk },
  error: { ...typography.body, color: colors.error },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
