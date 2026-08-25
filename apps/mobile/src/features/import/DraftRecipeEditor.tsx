import React from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import type { IngredientItem, Recipe, RecipeStep, RecipeTagSlug } from "@cooking/shared";
import { Button, TextField } from "../../components";
import { useApiClient } from "../../lib/api";
import { colors, radii, spacing, typography } from "../../theme";
import { ImagePickerButton } from "./ImagePickerButton";
import { IngredientList } from "./IngredientList";
import { StepListEditor } from "./StepListEditor";
import { StringListEditor } from "./StringListEditor";
import { TagPicker } from "./TagPicker";
import { TotalTimeField } from "./TotalTimeField";
import { pickAndUploadImage, useImageUpload } from "./useImageUpload";
import { resolveImageUrl } from "../../lib/imageUrl";

export type DraftRecipeEditorProps = {
  draft: Recipe;
  onChange: (next: Recipe) => void;
  saving: boolean;
  error: string | null;
  onSave: () => void | Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  allowImageEditing?: boolean;
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
  allowImageEditing = true,
}: DraftRecipeEditorProps) {
  const upload = useImageUpload(draft.thumbnail_url);
  const apiClient = useApiClient();

  // Per-step image picker. Delegates to the shared uploader: returns the
  // final URL, null on cancel/permission-denied, throws on upload failure
  // (StepListEditor catches and surfaces the error).
  const pickStepImage = React.useCallback(
    () => pickAndUploadImage(apiClient),
    [apiClient],
  );

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
      {allowImageEditing ? (
        <>
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
        </>
      ) : resolveImageUrl(draft.thumbnail_url) ? (
        <Image
          source={{ uri: resolveImageUrl(draft.thumbnail_url)! }}
          style={styles.reviewCover}
          contentFit="cover"
        />
      ) : null}

      <TextField
        label="Title"
        placeholder="What's this recipe called?"
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        autoCapitalize="words"
      />

      <View style={styles.field}>
        <Text style={styles.sectionLabel}>Description</Text>
        <TextInput
          multiline
          // Client-side cap only — the backend does not enforce a description
          // length limit (it only trims/normalizes; see models.py).
          maxLength={500}
          placeholder="Optional short description"
          style={styles.descriptionInput}
          value={draft.description ?? ""}
          onChangeText={(description) => onChange({ ...draft, description })}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.sectionLabel}>Total time</Text>
        <TotalTimeField
          minutes={draft.total_time_minutes ?? null}
          onChange={(total_time_minutes) => onChange({ ...draft, total_time_minutes })}
          suffix="min"
        />
      </View>

      <Text style={styles.sectionLabel}>Ingredients</Text>
      <IngredientList
        value={draft.ingredients}
        onChange={(ingredients: IngredientItem[]) => onChange({ ...draft, ingredients })}
      />

      <StepListEditor
        steps={draft.steps ?? []}
        onChange={(steps: RecipeStep[]) => onChange({ ...draft, steps })}
        pickImage={pickStepImage}
        allowImages={allowImageEditing}
      />
      <StringListEditor
        label="Tips"
        addLabel="Add tip"
        placeholder="Add a chef's note"
        values={draft.tips ?? []}
        onChange={(tips: string[]) => onChange({ ...draft, tips })}
      />
      <StringListEditor
        label="Equipment"
        addLabel="Add equipment"
        placeholder="Add a pan or tool"
        values={draft.equipment ?? []}
        onChange={(equipment: string[]) => onChange({ ...draft, equipment })}
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
  reviewCover: { width: "100%", aspectRatio: 16 / 9, borderRadius: radii.lg, marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.headline,
    color: colors.onSurface,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  field: { marginTop: spacing.md },
  descriptionInput: {
    ...typography.body,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    minHeight: 60,
  },
  error: { ...typography.subhead, color: colors.error, marginBottom: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
