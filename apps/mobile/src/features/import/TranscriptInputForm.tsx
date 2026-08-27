import React from "react";
import { StyleSheet, View } from "react-native";
import type { RecipeTagSlug } from "@cooking/shared";
import { TextField } from "../../components";
import { OptionalImportDetails } from "./OptionalImportDetails";

type TranscriptInputFormProps = {
  transcript: string;
  onTranscriptChange: (next: string) => void;
  notes: string;
  onNotesChange: (next: string) => void;
  title: string;
  onTitleChange: (next: string) => void;
  libraryTags: RecipeTagSlug[];
  onTagsChange: (next: RecipeTagSlug[]) => void;
  disabled?: boolean;
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
  disabled = false,
}: TranscriptInputFormProps) {
  return (
    <View>
      <TextField
        label="Transcript"
        placeholder="Paste the recipe steps or transcript here…"
        value={transcript}
        onChangeText={onTranscriptChange}
        editable={!disabled}
        multiline
        numberOfLines={8}
        style={styles.transcript}
      />
      <OptionalImportDetails
        notes={notes}
        onNotesChange={onNotesChange}
        title={title}
        onTitleChange={onTitleChange}
        libraryTags={libraryTags}
        onTagsChange={onTagsChange}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  transcript: { minHeight: 160, textAlignVertical: "top" },
});
