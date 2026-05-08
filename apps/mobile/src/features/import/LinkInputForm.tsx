import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { RecipeTagSlug } from "@cooking/shared";
import { TextField } from "../../components";
import { colors, spacing, typography } from "../../theme";
import { TagPicker } from "./TagPicker";

type LinkInputFormProps = {
  url: string;
  onUrlChange: (next: string) => void;
  notes: string;
  onNotesChange: (next: string) => void;
  title: string;
  onTitleChange: (next: string) => void;
  libraryTags: RecipeTagSlug[];
  onTagsChange: (next: RecipeTagSlug[]) => void;
};

export function LinkInputForm({
  url,
  onUrlChange,
  notes,
  onNotesChange,
  title,
  onTitleChange,
  libraryTags,
  onTagsChange,
}: LinkInputFormProps) {
  return (
    <View>
      <TextField
        label="YouTube URL"
        placeholder="https://youtube.com/watch?v=…"
        value={url}
        onChangeText={onUrlChange}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        leadingIcon="link"
      />
      <TextField
        label="Notes (optional)"
        placeholder="Anything you want to remember?"
        value={notes}
        onChangeText={onNotesChange}
        multiline
        numberOfLines={4}
        style={styles.multiline}
      />
      <TextField
        label="Title (optional)"
        placeholder="Override the auto-generated title"
        value={title}
        onChangeText={onTitleChange}
        autoCapitalize="words"
      />
      <Text style={styles.sectionLabel}>Tags (optional)</Text>
      <TagPicker value={libraryTags} onChange={onTagsChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 80, textAlignVertical: "top" },
  sectionLabel: {
    ...typography.headline,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
});
