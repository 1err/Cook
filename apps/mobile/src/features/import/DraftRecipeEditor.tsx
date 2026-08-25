import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import type { IngredientItem, Recipe, RecipeStep, RecipeTagSlug } from "@cooking/shared";
import { Button, TextField } from "../../components";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";
import { ImagePickerButton } from "./ImagePickerButton";
import { IngredientList } from "./IngredientList";
import { StepListEditor } from "./StepListEditor";
import { StringListEditor } from "./StringListEditor";
import { TagPicker } from "./TagPicker";
import { TotalTimeField } from "./TotalTimeField";
import { useImageUpload } from "./useImageUpload";
import { resolveImageUrl } from "../../lib/imageUrl";

export type DraftRecipeEditorProps = {
  draft: Recipe;
  onChange: (next: Recipe) => void;
  saving: boolean;
  estimating?: boolean;
  canEstimate?: boolean;
  error: string | null;
  onSave: () => void | Promise<void>;
  onEstimate?: () => void | Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  allowImageEditing?: boolean;
  focus?: "recipe" | "tutorial";
};

export function DraftRecipeEditor({
  draft,
  onChange,
  saving,
  estimating = false,
  canEstimate = false,
  error,
  onSave,
  onEstimate,
  onCancel,
  saveLabel,
  cancelLabel,
  allowImageEditing = true,
  focus = "recipe",
}: DraftRecipeEditorProps) {
  const t = useT();
  const upload = useImageUpload(draft.thumbnail_url);
  const [tutorialValid, setTutorialValid] = useState(true);
  const tutorialOnly = focus === "tutorial";
  const busy = saving || estimating;
  const resolvedSaveLabel = saveLabel ?? (tutorialOnly ? t("recipe.tutorial.save") : "Save recipe");
  const resolvedCancelLabel = cancelLabel ?? (tutorialOnly ? t("recipe.tutorial.cancel") : "Back");

  React.useEffect(() => {
    if (upload.thumbnailUrl !== draft.thumbnail_url) {
      onChange({ ...draft, thumbnail_url: upload.thumbnailUrl ?? null });
    }
    // Sync only the uploader's value; adding draft/onChange here would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.thumbnailUrl]);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {tutorialOnly ? (
        <View style={styles.tutorialHeader}>
          <Text style={styles.tutorialRecipeTitle}>{draft.title}</Text>
          <Text style={styles.tutorialTitle}>{t("recipe.tutorial.edit")}</Text>
        </View>
      ) : (
        <>
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
        </>
      )}

      <StepListEditor
        disabled={busy}
        steps={draft.steps ?? []}
        onChange={(steps: RecipeStep[]) => onChange({ ...draft, steps })}
        onValidityChange={setTutorialValid}
      />

      {!tutorialOnly ? (
        <>
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
        </>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {tutorialOnly && onEstimate ? (
          <Button
            title={estimating
              ? t("recipe.tutorial.editor.estimating")
              : t("recipe.tutorial.editor.estimate")}
            onPress={onEstimate}
            variant="secondary"
            loading={estimating}
            disabled={busy || !canEstimate}
            fullWidth
            size="lg"
          />
        ) : null}
        <Button
          title={resolvedSaveLabel}
          onPress={onSave}
          loading={saving}
          disabled={busy || !tutorialValid}
          fullWidth
          size="lg"
        />
        {onCancel ? (
          <Button
            title={resolvedCancelLabel}
            onPress={onCancel}
            variant="ghost"
            disabled={busy}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  reviewCover: { width: "100%", aspectRatio: 16 / 9, borderRadius: radii.lg, marginBottom: spacing.lg },
  tutorialHeader: { marginBottom: spacing.md },
  tutorialRecipeTitle: { ...typography.subhead, color: colors.mutedInk, marginBottom: spacing.xs },
  tutorialTitle: { ...typography.recipeTitle, color: colors.ink },
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
