import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { IngredientItem, Recipe, RecipeTagSlug } from "@cooking/shared";
import { Button, TextField } from "../../components";
import { colors, spacing, typography } from "../../theme";
import { ImagePickerButton } from "./ImagePickerButton";
import { IngredientList } from "./IngredientList";
import { TagPicker } from "./TagPicker";
import { useImageUpload } from "./useImageUpload";

export type DraftRecipeEditorProps = {
  draft: Recipe;
  onChange: (next: Recipe) => void;
  saving: boolean;
  error: string | null;
  onSave: () => void | Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
};

export function DraftRecipeEditor({
  draft,
  onChange,
  saving,
  error,
  onSave,
  onCancel,
  saveLabel = "Save recipe",
  cancelLabel = "Back",
}: DraftRecipeEditorProps) {
  const upload = useImageUpload(draft.thumbnail_url);

  // Sync upload state into the draft.
  React.useEffect(() => {
    if (upload.thumbnailUrl !== draft.thumbnail_url) {
      onChange({ ...draft, thumbnail_url: upload.thumbnailUrl ?? null });
    }
    // We intentionally only react to upload.thumbnailUrl, not draft.* — otherwise we'd loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.thumbnailUrl]);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ImagePickerButton
        thumbnailUrl={upload.thumbnailUrl}
        isUploading={upload.isUploading}
        error={upload.error}
        onPick={() => void upload.pickAndUpload()}
        onClear={() => upload.clear()}
      />

      <TextField
        label="Or paste an image URL"
        placeholder="https://…"
        value={draft.thumbnail_url ?? ""}
        onChangeText={(thumbnail_url) => {
          onChange({ ...draft, thumbnail_url });
          upload.setThumbnailUrl(thumbnail_url || null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <TextField
        label="Title"
        placeholder="What's this recipe called?"
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        autoCapitalize="words"
      />

      <Text style={styles.sectionLabel}>Ingredients</Text>
      <IngredientList
        value={draft.ingredients}
        onChange={(ingredients: IngredientItem[]) => onChange({ ...draft, ingredients })}
      />

      <Text style={styles.sectionLabel}>Tags</Text>
      <TagPicker
        value={draft.library_tags ?? []}
        onChange={(library_tags: RecipeTagSlug[]) => onChange({ ...draft, library_tags })}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button title={saveLabel} onPress={onSave} loading={saving} disabled={saving} fullWidth size="lg" />
        {onCancel ? (
          <Button title={cancelLabel} onPress={onCancel} variant="ghost" disabled={saving} />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  sectionLabel: {
    ...typography.headline,
    color: colors.onSurface,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  error: { ...typography.subhead, color: colors.error, marginBottom: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
