import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { RecipeTagSlug } from "@cooking/shared";
import { TextField } from "../../components";
import { colors, spacing, typography } from "../../theme";
import { TagPicker } from "./TagPicker";

type TranscriptInputFormProps = {
  transcript: string;
  onTranscriptChange: (next: string) => void;
  notes: string;
  onNotesChange: (next: string) => void;
  title: string;
  onTitleChange: (next: string) => void;
  libraryTags: RecipeTagSlug[];
  onTagsChange: (next: RecipeTagSlug[]) => void;
};

export function TranscriptInputForm({
  transcript,
  onTranscriptChange,
  notes,
  onNotesChange,
  title,
  onTitleChange,
  libraryTags,
  onTagsChange,
}: TranscriptInputFormProps) {
  return (
    <View>
      <TextField
        label="Transcript"
        placeholder="Paste the recipe steps or transcript here…"
        value={transcript}
        onChangeText={onTranscriptChange}
        multiline
        numberOfLines={8}
        style={styles.transcript}
      />
      <TextField
        label="Notes (optional)"
        placeholder="Anything you want to remember?"
        value={notes}
        onChangeText={onNotesChange}
        multiline
        numberOfLines={4}
        style={styles.notes}
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
  transcript: { minHeight: 160, textAlignVertical: "top" },
  notes: { minHeight: 80, textAlignVertical: "top" },
  sectionLabel: {
    ...typography.headline,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
});
